# Sora 2 Watermark Tool - TODO (aligned with PRD v2.0)

## P0 - 核心交付
- [x] 文件选择与本地预览：原视频播放，叠加水印预览层（绝对定位，水印占宽约20%，落在画面80%中心区域随机点，变换/停留节奏按 Sora2 官方；水印图片路径占位且同源/CORS）。
- [x] 格式嗅探：仅允许浏览器原生可播格式（MP4/WebM/MOV），不支持格式给出错误提示。
- [x] 智能录制配置：实现 `getSupportedMimeType` 逐级尝试 MP4(H.264) -> WebM(VP9/VP8)，失败报错。
- [x] Canvas 渲染管线：`<video>` 绘制到 `<canvas>`，叠加水印帧；处理长宽比与缩放。
- [x] 录制流水线：`MediaRecorder` 基于 canvas captureStream + 选定 mimeType；生成 Blob 触发下载/保存。
- [x] 倍速录制：当前默认 1x（保持原速与音高），如需加速可手动调整播放速率并提示成片会加速变调。
- [x] 防切屏机制：监听 `visibilitychange`，切到后台/锁屏时暂停/报错并提示重试；UI 高亮警告“请保持前台，勿锁屏”。
- [x] 进度反馈：基于 `video.currentTime / video.duration` 的进度条/环；处理中支持取消。
- [x] 音频路径：尝试解锁/混入音频（用户手势解锁提示）；失败时提示可静音导出。
- [x] 结果提示：显示导出格式；若为 WebM 提示“微信不可预览，发送文件传输助手或保存相册”；MP4 时提示可直接播放（若设备支持）。

## P1 - 稳定性与兜底
- [x] 高分辨率/时长限制：建议 ≤1080p、≤3 分钟；超限时提示风险。
- [x] 失败兜底提示：MediaRecorder 不支持/录制失败时的错误文案与重试引导。
- [ ] 常亮提示（可选）：提示用户保持屏幕常亮，必要时引入 WakeLock/NoSleep（非 MVP 必做）。

## 杂项
- [x] 文件命名策略与 Blob 内存释放（URL.revokeObjectURL）。
- [x] 水印资源路径替换钩子（留出配置入口）。 
