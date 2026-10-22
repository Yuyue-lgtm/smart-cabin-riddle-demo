# 主持人语音播报

## 选用配置

- 服务：阿里云百炼 CosyVoice
- 地域：新加坡（`ap-southeast-1`）
- 模型：`cosyvoice-v3-flash`
- 音色：龙华（`longhua_v3`）
- 当前语速 / 音高：`rate: 1` / `pitch: 1`（2026-10-21 恢复自然参数，替换先前试听的 `2 / 0.5`，避免明显低沉变声）
- 服务端接口：`wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference`

新加坡区域使用 CosyVoice WebSocket API。当前账号对 HTTP 合成返回 `current user api does not support http call`，因此不要把 HTTP `SpeechSynthesizer` 或 HTTP SSE 当作该区域的可用入口。服务端通过 WebSocket 接收 MP3 二进制帧，再以 `audio/mpeg` 分块流式代理给浏览器；支持 `MediaSource` 的浏览器边收边播，其他浏览器缓冲完整音频后播放。气泡在语音播放期间保持显示。

所有实际显示的主持话术统一走语音入口，包括模型回复和本地的答对揭晓、超时公布答案、整局结算、急刹、临时打断及暂停/恢复提示；不再按 P0 优先级跳过。准备页隐藏的气泡不合成，重复重绘不重复请求；健康配置晚于首次重绘返回时，仍能为当前话术补启动一次。答对/超时换题等待当前合成和播放结束，避免截断。P0 或重置取消旧音频并中止上游 WebSocket；模拟暂停/恢复同步暂停/恢复音频。配置缺失、合成失败或浏览器阻止播放时，文字照常显示。

2026-10-21 起，背景音乐按钮同时控制主持人语音，沿用原按钮样式、位置和默认关闭状态。关闭时立即停止主持播放并取消进行中的合成，清除语音等待状态；静音期间的新话术只显示文字，不请求 `/api/tts`。重新打开后仅播报后续新话术，不补读已显示内容。准备页与游戏页共用同一状态，按钮提示明确说明同时控制背景音乐和主持人语音。

## 配置密钥

在阿里云百炼新加坡地域创建 API Key，将其写入本地 `.env.local`（该文件被 Git 忽略）：

```dotenv
COSYVOICE_API_KEY=你的新加坡地域百炼APIKey
COSYVOICE_API_BASE_URL=https://dashscope-intl.aliyuncs.com
```

保存后重启本地 Demo 服务。`COSYVOICE_API_BASE_URL` 是区域域名基址，服务端会将其转换为 WebSocket 接入地址；密钥只在服务端使用。服务端 `/api/health` 只返回是否已配置，不返回密钥。`/api/tts` 固定调用已选模型和音色，文本上限 600 字，并限制每个连接来源每分钟 20 次、最多 3 个并发请求。

线上已于 2026-10-20 启用，入口为 [cabinplay.xyz](https://cabinplay.xyz/)。同名变量存放在 ECS `/etc/smart-cabin-demo.env`（600 root:root），由 systemd 读取；不要添加到客户端 JavaScript、公开静态配置、Dify DSL 或 Git。后续本地修改不会自动更新线上，需要打包并部署。生产版本、备份和验收见 [生产部署记录](ALIBABA_CLOUD_PRODUCTION.md)。

## 验证

2026-10-21原生Safari实测：首次真实语音请求在Safari已进入`playing`，但8秒无网络分块后被前端`stream_idle_timeout`取消。服务端同一短句记录到11块、28411字节、总26282ms，最大分块间隔15493ms，确认是上游分块停顿超过旧8秒阈值，不是Safari解码失败。将后续网络读取空闲阈值提高到20秒后，再在Safari实测同一虚构短句：`playing → ended`，11块、约7秒、0次waiting/stalled；服务端最大分块间隔657ms。`node --test tests/host-voice.test.cjs`的21项测试通过。此修复仅在本地测试版，未发布到正式网站；上游偶发长间隔可能让声音等待更久，超过20秒仍会失败。

2026-10-21后续WebKit复现：请求`06db16a0-e0c5-44f6-aadb-d9c6ebeaf636`已收到61051字节，最大分块读取间隔1912ms，但暂停状态下仍被`stream_idle_timeout`取消；此前仅以Chrome成功不能代表用户WebKit已恢复。现将8秒计时严格限制为fetch/read网络等待，媒体事件使用可随模拟暂停的15秒独立计时，预缓冲优先读SourceBuffer.buffered，完整Blob也逐块读取以正确更新网络状态。

新增两项回归覆盖“元素尚未暴露缓冲范围”和“暂停中的媒体append不等于断网”，235项Node测试全部通过。额外在实际内嵌WebKit运行相同生产播放函数与本地MP3：387ms开始、4592ms真实ended；暂停约32秒后仍保留音频，点击恢复后playing。仅夹具验证，不把它当成真实长句/所有网络环境均已通过。暂未再进行真实发声验收；本机4175已重启、前端需刷新，正式网站未改。

上述WebKit临时验证页`http://127.0.0.1:54992/`使用`assets/host-yes.mp3`，不是线上Demo的云端合成。用户反馈听到测试音效后，已关闭该页并终止临时服务，后续不得自动恢复该验证页。

2026-10-21无声复现与修复：用户复现请求`36fefbed-3c2b-4ddf-b91c-b4c8790a0a7a`在8009ms时收到0字节，前端8秒计时取消。首包预算现为20秒，后续断流仍为8秒；分开读取流与等待`play()`，播放承诺不再阻塞后续音频下载；MSE事件等待可取消，暂停期间继续收完有限音频但不播放。首播积累约0.8秒缓冲，已完整收到的短句立即播放。

233项Node回归通过。真实Chrome夹具覆盖首包延迟9秒、第一块仅16字节后再提供剩余MP3，正常播放结束。真实阿里云请求`2e261a25-9963-48a2-b4ec-009970b53120`首包9755ms，超出旧8秒预算；新版开始播放并真实ended（总36165ms），无媒体错误，但发生4次waiting。服务端连接耗时7324ms、分块最大间隔5495ms，121051字节共34693ms收完，确认上游交付仍不稳定，不能把完整播完称为无卡顿。早一条短句首包1709ms、总6025ms、最大间隔2778ms，波动显著。

新增服务端`tts_timing`区分连接、task启动、首音频和分块间隔，不记录话术或密钥；前端分别记录`first_audio_timeout`与`stream_idle_timeout`。本机4175已重启加载后端；前端刷新后使用修复。未修改正式网站、音色、语速或Dify；链路波动尚未解决，不通过无限重试掩盖。浏览器验收脚本为`tests/voice-streaming-browser.cjs`，默认只用本地夹具，显式`LIVE_VOICE=1`才消耗真实语音额度。一次真实验收末尾存在“页面状态先完成、诊断请求稍后发出”的断言竞态，日志已核对真实ended，脚本现等待终态诊断请求再断言；不将该次脚本退出1隐去。

2026-10-21卡顿排查：本地近期WebKit真实日志中，请求到开始播放约2.4–5秒，确认存在开口等待；200响应与playing不能证明后续播放无卡顿。新增每句最多3条waiting/stalled记录，包含播放位置、前向缓冲、收到的音频分块数/字节数及最大分块读取间隔，结束/失败时保留累计次数。主动模拟暂停期间不统计缓冲事件，不记录话术或音频。分块读取间隔包含前端处理/等待时间，不能单独认定为网络耗时。18项语音及脱敏日志测试通过，本地4175服务已重启；尚未部署正式版，也未认定断续根因已解决。

2026-10-21 准备页时序更新：先播 wave，期间不显示/合成欢迎话术；wave 完成后新建 `ready_welcome` 话术，展示时开始 TTS 与说话动效，文字展示时长从此时重新计。音频结束或失败时停止说话动效并回到待机，文字保留原展示周期；静音仍只显示文字、不请求合成。开启声音重播 wave 后再欢迎，开始游戏会取消尚未完成的欢迎语音，避免阻挡游戏启动。重置、切页和资源失败回退均隔离旧回调。此规则替代此前准备页一律不合成的行为。

2026-10-21：线上一次真实短句合成返回 HTTP 200，Chrome 播放时间正常推进并结束；尚未复现用户报告的游戏中新话术无声，不能据此断言问题已消除。补充 `host_voice` 浏览器日志（跳过、请求、HTTP 状态、开始/结束、浏览器拦截、媒体错误、取消）及服务端 `tts_finish`，通过 UUID 关联。只记录固定原因码和数值，不记录话术、原始错误文本、完整 UA 或凭证；日志沿用私有 `tmp/workflow-diagnostics.ndjson`，不会作为静态文件开放。

`node --test tests/*.test.cjs` 共 194 项通过。新增测试覆盖本地 P0 话术、重复渲染、健康配置晚到、P0 取消旧音频、答对/超时换题等待，以及 WebSocket 握手前后取消。`tests/host-voice-browser.cjs` 在本地和线上使用有效 MP3 夹具检查四种本地话术的真实媒体播放、暂停/恢复、失败回退和准备页不请求语音；不调用模型。另在线上页面经真实 `/api/tts` 播放本地急刹提示，确认音频开始/结束且无页面异常。

## 官方接口参考

- [非实时语音合成 CosyVoice HTTP API](https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api)
- [非实时语音合成指南](https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide)
- [CosyVoice 实时语音合成 WebSocket API](https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api)
- [CosyVoice WebSocket 客户端事件](https://help.aliyun.com/zh/model-studio/cosyvoice-client-events)
- [地域、部署范围与接入域名](https://help.aliyun.com/zh/model-studio/regions)
