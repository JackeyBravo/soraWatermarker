const fileInput = document.getElementById("file-input");
const generateBtn = document.getElementById("generate-btn");
const cancelBtn = document.getElementById("cancel-btn");
const preview = document.getElementById("preview");
const watermarkLayer = document.getElementById("watermark-layer");
const formatBadge = document.getElementById("format-badge");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const durationLabel = document.getElementById("duration-label");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

const WATERMARK_SRC = "/assets/sora-watermark.png"; // 占位路径，需同源或带 CORS
const WATERMARK_SIZE_RATIO = 0.25; // 占较短边约 25%（随画面自适应）
const WATERMARK_REGION_RATIO = 0.8; // 允许落点的中心区域宽高比
const MAX_DIMENSION = 1080;
const MAX_DURATION_SEC = 180; // 3 分钟
const PLAYBACK_RATE = 1.0; // 保持原速与原音高
const SHOW_TIMECODE = false; // 导出时间码

const state = {
  file: null,
  videoUrl: null,
  recorder: null,
  recording: false,
  chunks: [],
  canvas: null,
  ctx: null,
  stream: null,
  audioCtx: null,
  audioDest: null,
  audioSource: null,
  watermarkImg: null,
  watermarkReady: false,
  wmTimer: null,
  wmState: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
  raf: null,
  progressTimer: null,
  resultUrl: null
};

function setStatus(text, tone = "info") {
  statusEl.textContent = text;
  statusEl.style.color =
    tone === "warn" ? "#ffa94d" : tone === "error" ? "#ff6b6b" : "#9aa4b5";
}

function setFormatBadge(text, tone = "neutral") {
  formatBadge.textContent = text;
  formatBadge.className = "badge";
  if (tone === "success") formatBadge.classList.add("success");
  if (tone === "warn") formatBadge.classList.add("warn");
  if (tone === "danger") formatBadge.classList.add("danger");
}

function isPlayable(file) {
  const video = document.createElement("video");
  if (file.type && video.canPlayType(file.type)) return true;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return ["mp4", "webm", "mov"].includes(ext);
}

function revokeVideoUrl() {
  if (state.videoUrl) {
    URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = null;
  }
}

function resetResult() {
  if (state.resultUrl) {
    URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = null;
  }
  resultEl.innerHTML = "<p>尚未生成文件。</p>";
}

function loadWatermarkImage() {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      state.watermarkImg = img;
      state.watermarkReady = true;
      resolve();
    };
    img.onerror = () => {
      console.warn("水印图片加载失败，将使用文本占位");
      state.watermarkReady = false;
      resolve();
    };
    img.src = WATERMARK_SRC;
    img.className = "watermark-img";
    watermarkLayer.innerHTML = "";
    watermarkLayer.appendChild(img);
  });
}

function getSupportedMimeType() {
  const types = [
    'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    "video/mp4; codecs=avc1",
    "video/mp4",
    "video/webm; codecs=vp9",
    "video/webm; codecs=vp8",
    "video/webm"
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log(`Using MIME type: ${type}`);
      return type;
    }
  }
  throw new Error("No supported MediaRecorder mimeType found.");
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function formatTimecode(sec) {
  if (!Number.isFinite(sec)) return "00:00:00.000";
  const h = Math.floor(sec / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.floor((sec % 1) * 1000)
    .toString()
    .padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function buildFileTimestamp() {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function updateProgress() {
  if (!state.file || !preview.duration) return;
  const ratio = preview.currentTime / preview.duration;
  progressFill.style.width = `${Math.min(1, ratio) * 100}%`;
  progressLabel.textContent = state.recording
    ? `生成中 ${(ratio * 100).toFixed(1)}%`
    : "预览中";
  durationLabel.textContent = `${formatTime(preview.currentTime)} / ${formatTime(
    preview.duration
  )}`;
}

function startProgressTimer() {
  stopProgressTimer();
  state.progressTimer = setInterval(updateProgress, 100);
}

function stopProgressTimer() {
  if (state.progressTimer) {
    clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
}

function scheduleWatermarkMove() {
  if (!preview.videoWidth || !preview.videoHeight) return;
  const w = preview.videoWidth;
  const h = preview.videoHeight;
  const baseSize = Math.min(w, h) * WATERMARK_SIZE_RATIO;
  const maxRegionW = w * WATERMARK_REGION_RATIO - baseSize;
  const maxRegionH = h * WATERMARK_REGION_RATIO - baseSize;
  const offsetX = (w - w * WATERMARK_REGION_RATIO) / 2;
  const offsetY = (h - h * WATERMARK_REGION_RATIO) / 2;
  const x = offsetX + Math.random() * maxRegionW;
  const y = offsetY + Math.random() * maxRegionH;
  const scale = 0.9 + Math.random() * 0.2;
  const rotation = (Math.random() - 0.5) * 0.12; // 小角度摆动
  state.wmState = { x, y, w: baseSize * scale, h: baseSize * scale, rotation };

  // 更新预览层
  const wmEl = watermarkLayer.querySelector("img");
  if (wmEl) {
    wmEl.style.width = `${state.wmState.w}px`;
    wmEl.style.left = `${state.wmState.x}px`;
    wmEl.style.top = `${state.wmState.y}px`;
    wmEl.style.transform = `rotate(${rotation}rad)`;
  }

  state.wmTimer = setTimeout(scheduleWatermarkMove, 1400 + Math.random() * 600);
}

function stopWatermark() {
  if (state.wmTimer) {
    clearTimeout(state.wmTimer);
    state.wmTimer = null;
  }
}

async function ensureAudioContext() {
  if (!state.audioCtx) {
    state.audioCtx = new AudioContext();
  }
  if (state.audioCtx.state === "suspended") {
    await state.audioCtx.resume();
  }
}

async function prepareStreams() {
  const canvas = document.createElement("canvas");
  canvas.width = preview.videoWidth;
  canvas.height = preview.videoHeight;
  const ctx = canvas.getContext("2d");
  state.canvas = canvas;
  state.ctx = ctx;

  const canvasStream = canvas.captureStream(30);
  // 优先使用 video.captureStream 的原音轨，避免 AudioContext 某些设备无声
  let audioTracks = [];
  if (preview.captureStream) {
    try {
      const vStream = preview.captureStream();
      audioTracks = vStream.getAudioTracks();
    } catch (e) {
      console.warn("captureStream audio failed, fallback to AudioContext", e);
    }
  }

  // 如果没有音轨，再用 AudioContext 混音
  if (audioTracks.length === 0) {
    await ensureAudioContext();
    if (!state.audioDest) {
      state.audioDest = state.audioCtx.createMediaStreamDestination();
    }
    if (!state.audioSource) {
      state.audioSource = state.audioCtx.createMediaElementSource(preview);
    } else {
      try {
        state.audioSource.disconnect();
      } catch (e) {
        // ignore
      }
    }
    state.audioSource.connect(state.audioDest);
    audioTracks = state.audioDest.stream.getAudioTracks();
  }

  if (audioTracks.length === 0) {
    setStatus("未检测到音频轨道，将生成静音视频。", "warn");
  }

  const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
  state.stream = mixed;
}

function drawFrame() {
  if (!state.recording || !state.ctx || !state.canvas) return;
  state.ctx.drawImage(preview, 0, 0, state.canvas.width, state.canvas.height);
  if (state.watermarkReady && state.watermarkImg) {
    const { x, y, w, h, rotation } = state.wmState;
    if (rotation) {
      state.ctx.save();
      state.ctx.translate(x + w / 2, y + h / 2);
      state.ctx.rotate(rotation);
      state.ctx.drawImage(state.watermarkImg, -w / 2, -h / 2, w, h);
      state.ctx.restore();
    } else {
      state.ctx.drawImage(state.watermarkImg, x, y, w, h);
    }
  } else {
    state.ctx.fillStyle = "rgba(255,255,255,0.8)";
    state.ctx.font = `${Math.floor(state.canvas.width * 0.05)}px sans-serif`;
    state.ctx.fillText("WATERMARK", state.wmState.x, state.wmState.y + state.wmState.h);
  }

  if (SHOW_TIMECODE) {
    const tc = formatTimecode(preview.currentTime);
    const padding = Math.max(8, state.canvas.width * 0.006);
    const fontSize = Math.max(14, state.canvas.width * 0.02);
    state.ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
    const textWidth = state.ctx.measureText(tc).width;
    const boxW = textWidth + padding * 2;
    const boxH = fontSize + padding * 2;
    const x = padding;
    const y = state.canvas.height - boxH - padding;
    state.ctx.fillStyle = "rgba(0,0,0,0.5)";
    state.ctx.fillRect(x, y, boxW, boxH);
    state.ctx.fillStyle = "#f5f7fa";
    state.ctx.fillText(tc, x + padding, y + padding + fontSize * 0.8);
  }

  state.raf = requestAnimationFrame(drawFrame);
}

function stopDrawing() {
  if (state.raf) {
    cancelAnimationFrame(state.raf);
    state.raf = null;
  }
}

function stopStreams() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  stopDrawing();
}

function stopRecording(reason = "完成", isError = false) {
  if (state.recording && state.recorder) {
    try {
      state.recorder.stop();
    } catch (e) {
      console.warn("stop recorder failed", e);
    }
  }
  state.recording = false;
  try {
    preview.pause();
    preview.playbackRate = 1;
  } catch (e) {
    // ignore
  }
  stopStreams();
  stopProgressTimer();
  stopWatermark();
  generateBtn.disabled = !state.file;
  cancelBtn.disabled = true;
  if (reason) {
    setStatus(reason, isError ? "error" : "info");
  }
}

function handleRecorderStop(mimeType) {
  const blob = new Blob(state.chunks, { type: mimeType });
  state.chunks = [];
  if (state.resultUrl) {
    URL.revokeObjectURL(state.resultUrl);
  }
  const url = URL.createObjectURL(blob);
  state.resultUrl = url;
  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  const filename = `sora-watermarked-${buildFileTimestamp()}.${ext}`;
  resultEl.innerHTML = `
    <p>视频已生成！格式：${ext.toUpperCase()}</p>
    <a class="link" download="${filename}" href="${url}">下载 ${filename}</a>
  `;
  setStatus(
    ext === "webm"
      ? "已生成 WebM。如微信无法预览，请发送文件传输助手或保存相册。"
      : "已生成 MP4，可直接播放（若设备支持）。",
    ext === "webm" ? "warn" : "info"
  );
}

async function startRecording() {
  if (!state.file || !preview.duration) {
    setStatus("请先选择可播放的视频文件。", "warn");
    return;
  }
  try {
    await ensureAudioContext();
  } catch (e) {
    console.warn("audio context resume failed", e);
  }

  preview.currentTime = 0;
  preview.playbackRate = PLAYBACK_RATE;
  preview.muted = false;
  preview.volume = 1;

  try {
    await loadWatermarkImage();
  } catch (e) {
    console.warn("watermark load issue", e);
  }
  stopWatermark();
  scheduleWatermarkMove();

  await prepareStreams();
  let mimeType;
  try {
    mimeType = getSupportedMimeType();
  } catch (e) {
    setStatus("当前浏览器不支持 MediaRecorder 需要的格式。", "error");
    return;
  }

  state.chunks = [];
  const recorder = new MediaRecorder(state.stream, { mimeType });
  state.recorder = recorder;
  state.recording = true;
  generateBtn.disabled = true;
  cancelBtn.disabled = false;
  setStatus("正在生成中... 请保持当前页面在前台，勿锁屏。");

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) state.chunks.push(e.data);
  };
  recorder.onstop = () => {
    handleRecorderStop(mimeType);
  };
  recorder.onerror = (e) => {
    console.error("recorder error", e);
    setStatus("录制失败，请重试或更换浏览器。", "error");
  };

  preview.onended = () => {
    stopRecording("录制完成");
  };

  drawFrame();
  startProgressTimer();
  recorder.start(200);
  try {
    await preview.play();
  } catch (e) {
    console.error("video play failed", e);
    stopRecording("视频无法播放，录制已中断。", true);
  }
}

function cancelRecording() {
  if (state.recording) {
    stopRecording("已取消");
  }
}

function handleVisibilityChange() {
  if (document.hidden && state.recording) {
    cancelRecording();
    setStatus("页面进入后台，录制已停止。请保持前台重试。", "warn");
  }
}

function handleFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!isPlayable(file)) {
    setFormatBadge("格式不支持", "danger");
    setStatus("仅支持浏览器可播放的 MP4/WebM/MOV。", "error");
    preview.removeAttribute("src");
    preview.load();
    state.file = null;
    generateBtn.disabled = true;
    resetResult();
    return;
  }

  revokeVideoUrl();
  const url = URL.createObjectURL(file);
  state.videoUrl = url;
  preview.src = url;
  preview.preload = "metadata";
  preview.playsInline = true;
  preview.loop = false;
  preview.muted = false;
  preview.volume = 1;
  state.file = file;
  resetResult();
  generateBtn.disabled = true;
  setStatus("加载中...");
  preview.onloadedmetadata = () => {
    setFormatBadge(file.type || file.name.split(".").pop().toUpperCase(), "success");
    let limitWarn = "";
    if (
      preview.videoWidth > MAX_DIMENSION ||
      preview.videoHeight > MAX_DIMENSION ||
      preview.duration > MAX_DURATION_SEC
    ) {
      limitWarn = "视频分辨率或时长较高，可能掉帧或失败（建议 ≤1080p、≤3 分钟）。";
      setFormatBadge("超限", "warn");
    }
    setStatus(limitWarn || "预览就绪，可开始生成。", limitWarn ? "warn" : "info");
    generateBtn.disabled = false;
    updateProgress();
    scheduleWatermarkMove();
  };
  preview.onerror = () => {
    setStatus("视频加载失败，换一个文件试试。", "error");
    generateBtn.disabled = true;
  };
}

function init() {
  fileInput.addEventListener("change", handleFileChange);
  generateBtn.addEventListener("click", startRecording);
  cancelBtn.addEventListener("click", cancelRecording);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  preview.addEventListener("timeupdate", updateProgress);
  loadWatermarkImage();
}

init();
