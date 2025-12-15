# 产品需求文档 (PRD): Sora 2 Watermark Tool (Canvas Recorder Edition)

> **文档版本**: v2.0 (Plan B - Lightweight)  
> **核心策略**: Canvas 绘图 + MediaRecorder 录制  
> **优势**: 0MB 额外依赖、秒开、兼容移动端  
> **劣势**: 生成速度受限于播放速率、不支持后台处理

---

## ⚠️ 关键风险与技术限制 (Critical Risks)

采用本方案必须在 UI 和代码层面解决以下“物理定律”级的限制：

1.  **Tab / 锁屏节流灾难 (Background Throttling)**:
    * *原理*: 当用户切换到其他标签页或移动端熄屏时，浏览器会挂起 `requestAnimationFrame`，导致 Canvas 停止更新，但视频继续播放。
    * *后果*: 录出来的视频是黑屏或画面静止的。
    * *对策*: **UI 大字警告“处理时请勿切到后台或锁屏”**。监听 `visibilitychange` 事件，若用户切走，自动暂停/报错并提示重试；可选再提示用户保持屏幕常亮（有余力再做）。
2.  **倍速播放=倍速成片（会变快、变调）**:
    * *原理*: 纯 MediaRecorder 录制倍速播放的视频，产物就是加速且升调的成片，不能“加速处理但保持原速输出”。
    * *对策*: MVP 默认倍速上限 PC ≤3x、移动 ≤2x，并在文案中说明“生成的视频会加速且音调升高”。如需原速成片只能 1x 播放或改用离线转码（不在本 MVP）。
3.  **音频兼容与解锁**:
    * 移动端需要用户手势解锁 AudioContext/播放；倍速下部分浏览器会出现音频不同步或破音。
    * *对策*: 入口提示“点击播放以解锁声音”；录制失败时提示“当前设备可能无法录到声音”，允许静音导出。
4.  **MediaRecorder MP4 支持度低**:
    * 桌面 Chrome/Edge 常只支持 WebM，Safari/iOS 部分版本才支持 MP4，iOS 对 WebM 不可播。
    * *对策*: 在 UI 明示“多数桌面浏览器将导出 WebM（微信可能无法预览）”；生成结果需显示格式并给出分享指引。
5.  **高分辨率/高码率导致掉帧或崩溃**:
    * 4K/长视频在移动端可能内存溢出或严重掉帧。
    * *对策*: 限制输入分辨率/时长（建议 ≤1080p、≤3 分钟），超限时给出风险提示或拒绝处理。
6.  **跨域水印图片会污染 Canvas**:
    * 非同源图片会触发 CORS 污染，导致 MediaRecorder/导出失败。
    * *对策*: 水印资源必须同源或具备 CORS 头；提供固定占位路径以便后续替换。

---

## 1. 项目概述 (Overview)

* **产品名称**: Sora 2 Instant Watermarker
* **技术架构**: 纯原生 Web API (Canvas 2D + MediaRecorder)。无 ffmpeg.wasm，无后端。
* **核心体验**: 
    * **秒开**: 没有任何 loading 条。
    * **智能降级**: 优先生成 MP4，不支持则回退到 WebM。
* **目标**: 针对想要快速给短视频加梗图水印并分享到社交网络的用户。

## 2. 用户流程 (User Flow)

1.  **访问**: 打开页面，立刻就绪（无需等待资源下载）。
2.  **上传**: 选择视频 -> 本地预览播放。
3.  **合成 (核心差异点)**:
    * 用户点击“生成”。
    * 视频**静音**并在后台以**倍速**从头播放。
    * Canvas 实时绘制每一帧 + 水印图片。
    * UI 显示进度环（对应视频播放进度）。
4.  **完成**: 播放结束 -> 生成 Blob -> 自动弹窗下载或显示保存按钮。

## 3. 功能需求 (Functional Requirements)

### 3.1 核心功能
| ID | 功能模块 | 详细描述 | 优先级 | 技术备注 |
| :--- | :--- | :--- | :--- | :--- |
| **F1** | **格式嗅探** | 上传时检测视频编码。 | **P0** | 仅支持浏览器原生能播放的格式 (MP4/WebM/MOV)。不支持 MKV/AVI。 |
| **F2** | **智能录制配置** | **关键逻辑**：优先尝试 H.264 (MP4)，失败则降级 VP9/VP8 (WebM)。 | **P0** | 见技术细节 4.2 代码段。 |
| **F3** | **Canvas 渲染器** | 将 `<video>` 画面绘制到 `<canvas>`，再 `drawImage` 水印图。 | **P0** | 处理视频长宽比；水印占宽度约 20%，位置限制在画面 80% 中心区域随机点，变换/停留时间按 Sora2 官方节奏；水印图片路径预留占位，需同源或具 CORS 头。 |
| **F4** | **倍速录制** | 设置 `video.playbackRate > 1.0` 以缩短等待时间。 | **P1** | 默认上限 PC ≤3x、移动 ≤2x，且成片会加速变调。 |
| **F5** | **防切屏机制** | 录制过程中，若页面变为 `hidden`，自动暂停或提示失败。 | **P1** | 监听 `document.onvisibilitychange`，提示勿切后台/勿锁屏。 |
| **F6** | **失败与格式提示** | 明确告诉用户导出格式与平台限制。 | **P1** | MP4 兼容性受限；WebM 需提示“微信无法预览，发送文件传输助手或保存相册”。 |

### 3.2 UI/UX 规范
* **预览区**: 上传后显示原视频，并覆盖“水印预览层”（HTML 绝对定位）。水印位置限制在画面 80% 中心区域的随机点，变换/停留时间参考 Sora2 官方节奏；水印图片路径留占位，后续替换。
* **处理中状态**:
    * **文案**: "正在生成中... 请保持当前页面在前台，勿锁屏" (高亮警告)。
    * **进度条**: 真实的进度条（基于 `video.currentTime / video.duration`）。
    * **取消按钮**: 允许中途停止。
* **结果页**:
    * **成功提示**: "视频已生成！"
    * **格式提示**: 若生成 WebM，提示 "如微信无法预览，请发送给文件传输助手或保存相册"；若为 MP4，可提示“可直接播放”（若设备支持）。

## 4. 技术实施细节 (Technical Specs)

### 4.1 技术栈
* **Framework**: React / Vue / Vanilla JS (原生JS写这个也很简单)。
* **Hosting**: Vercel (不需要配置特殊的 Cross-Origin Headers，因为没用 SharedArrayBuffer)。

### 4.2 智能格式选择 (The "Smart Fallback" Code)
这是本方案的核心算法，直接复制进代码库：

```javascript
function getSupportedMimeType() {
  const types = [
    // 1. 优先尝试 MP4 (H.264) - iOS 和 新版 Chrome 支持
    'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    'video/mp4; codecs=avc1',
    'video/mp4',
    // 2. 其次尝试 WebM (VP9/VP8) - 安卓和老 Chrome 支持
    'video/webm; codecs=vp9',
    'video/webm; codecs=vp8',
    'video/webm'
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log(`Using MIME type: ${type}`);
      return type;
    }
  }
  throw new Error('No supported MediaRecorder mimeType found.');
}
