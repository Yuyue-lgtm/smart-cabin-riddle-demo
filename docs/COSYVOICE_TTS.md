# 主持人语音播报

## 选用配置

- 服务：阿里云百炼 CosyVoice
- 地域：新加坡（`ap-southeast-1`）
- 模型：`cosyvoice-v3-flash`
- 音色：龙华（`longhua_v3`）
- 服务端接口：`wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference`

新加坡区域使用 CosyVoice WebSocket API。当前账号对 HTTP 合成返回 `current user api does not support http call`，因此不要把 HTTP `SpeechSynthesizer` 或 HTTP SSE 当作该区域的可用入口。服务端通过 WebSocket 接收 MP3 二进制帧，再以 `audio/mpeg` 分块流式代理给浏览器；支持 `MediaSource` 的浏览器边收边播，其他浏览器缓冲完整音频后播放。气泡在语音播放期间保持显示。P0 安全话术不请求语音服务；配置缺失、合成失败或浏览器阻止播放时，文字照常显示。

## 配置密钥

在阿里云百炼新加坡地域创建 API Key，将其写入本地 `.env.local`（该文件被 Git 忽略）：

```dotenv
COSYVOICE_API_KEY=你的新加坡地域百炼APIKey
COSYVOICE_API_BASE_URL=https://dashscope-intl.aliyuncs.com
```

保存后重启本地 Demo 服务。`COSYVOICE_API_BASE_URL` 是区域域名基址，服务端会将其转换为 WebSocket 接入地址；密钥只在服务端使用。服务端 `/api/health` 只返回是否已配置，不返回密钥。`/api/tts` 固定调用已选模型和音色，文本上限 600 字，并限制每个连接来源每分钟 20 次、最多 3 个并发请求。

线上启用时，应将同名变量添加到 ECS 上 Demo 的私有服务环境配置后重启 Demo 服务；不要添加到客户端 JavaScript、公开静态配置、Dify DSL 或 Git。当前代码改动本身不会自动更新线上服务。

## 官方接口参考

- [非实时语音合成 CosyVoice HTTP API](https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api)
- [非实时语音合成指南](https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide)
- [CosyVoice 实时语音合成 WebSocket API](https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api)
- [CosyVoice WebSocket 客户端事件](https://help.aliyun.com/zh/model-studio/cosyvoice-client-events)
- [地域、部署范围与接入域名](https://help.aliyun.com/zh/model-studio/regions)
