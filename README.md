# 智能座舱 AI 猜谜 Demo

当前仓库的 `V1.0` 是一个可部署的静态网页骨架，用于演示：

- 上帝视角输入座舱状态
- 玩家模拟提问
- 事件打断游戏流程
- 调用 Coze/Dify Workflow 做融合决策
- 根据结构化 JSON 返回更新网页表现

当前代码已进入 `V1.4` UI 基础阶段：核心中控屏页面已按 Figma 资源落地，主持人默认、说话、思考、比心和答对状态已接入透明 Sprite Sheet + Canvas 播放，答对状态支持同步音频，游戏准备页支持默认关闭的背景音乐开关，详细实现记录见 [docs/V1_4_UI_IMPLEMENTATION.md](./docs/V1_4_UI_IMPLEMENTATION.md)。

实时主持使用同一个 Dify Chatflow 会话跨题、跨局延续。乘客问答走 Chatflow；重要座舱事件先走情境 Workflow，再由前端接续 Chatflow。请求直接携带最新快照，常规 `sync_state` 会话变量同步已停用。三应用最近记录的发布版本、权限及后续子对话入口见 [DIFY_CURRENT_STATE.md](./docs/DIFY_CURRENT_STATE.md)，具体接入见 [DIFY_CHATFLOW_INTEGRATION.md](./docs/DIFY_CHATFLOW_INTEGRATION.md)。

2026-10-19 本地增量：每局六题，玩家可经输入框请求暂停/继续；新增答对后未推进的前端诊断，修复题号提示启动计时却未立即刷新的问题。新题开始显示“第 N 题”3 秒，之后恢复提示、倒计时和剩余提问次数。诊断说明见 [DIFY_FALLBACK_DIAGNOSTICS.md](./docs/DIFY_FALLBACK_DIAGNOSTICS.md)，复现及验证记录见 [TEST_SCRIPT.md](./docs/TEST_SCRIPT.md)。本次诊断和题号修复未修改 Dify 云端、未部署 Vercel。

V1.1 之后的产品方向已升级为“可分享体验版”：通过时间轴模拟多模态事件，并由 Workflow 驱动 AI 主持人与半自主模拟乘客参与游戏。

最新需求、路线图和接口契约以 [docs/README.md](./docs/README.md) 为准。

## 本地运行

如果只看页面，不接 Workflow，直接打开 `index.html` 即可。

如果需要本地联调 Dify Chatflow，请先在 `.env.local` 中配置服务端 API Key：

```text
DIFY_CHATFLOW_API_KEY=replace_with_your_dify_chatflow_api_key
DIFY_CHATFLOW_APP_ID=74bef8bd-22bd-4e19-91da-5e8d645dd8ed
```

然后启动本地代理服务：

```bash
node dev-server.cjs
```

然后访问：

```text
http://localhost:4173
```

本地页面默认请求：

```text
/api/workflow
```

真实 Token 只会被 `dev-server.cjs` 读取，不会进入前端代码。

本地健康检查地址：

```text
http://localhost:4173/api/health
```

本机服务还支持 `POST /api/client-diagnostic`，将答对后换题的等待原因与工作流记录一起写入忽略目录 `tmp/workflow-diagnostics.ndjson`。页面仅在健康检查返回 `runtime=local` 时发送这些诊断；文件记录局/题、队列来源和计时状态，不记录气泡正文或谜底。更新该服务端接口后需要重启 Node 服务，并刷新页面。端口可通过 `PORT=4187 node dev-server.cjs` 指定，后续体验与日志应使用同一端口。

背景音乐默认关闭，用户打开准备页右上角的声音按钮后才会循环播放；每次重新进入准备页都会从头播放。浏览器会限制无用户手势的自动播放，因此首次播放需要点击页面或声音按钮，背景音乐音量为 `25%`。

前端不再记忆自定义 Workflow 地址，统一固定走同域 `/api/workflow`，避免不同机器因为历史 `localStorage` 残留而请求到不同代理。

## 部署方式

当前推荐使用 Vercel，因为项目已经包含 `/api/workflow` Dify 代理。

部署时需要在 Vercel 环境变量里配置：

```text
DIFY_CHATFLOW_API_KEY=replace_with_your_dify_chatflow_api_key
DIFY_CHATFLOW_APP_ID=74bef8bd-22bd-4e19-91da-5e8d645dd8ed
```

前端页面会请求同域的：

```text
/api/workflow
```

由服务端代理携带 API Key 请求 Dify。不要把 API Key 写入 `client-app.js`、`index.html` 或任何会提交到 Git 的文件。

部署后也可以直接访问：

```text
/api/health
```

用于确认当前公网版本是否已经更新、服务端代理是否已正确配置。

## Workflow 接口

下面是 V1.0 的接口示例。新版 Workflow 契约已扩展 `timeline`、`interaction` 和 `passenger_action`，请以 [docs/WORKFLOW_CONTRACT.md](./docs/WORKFLOW_CONTRACT.md) 为准。

前端固定请求同域 Workflow 代理。默认是：

```text
/api/workflow
```

一般不需要在页面里修改。只有本地调试或换代理服务时，才需要调整服务端环境变量。

### 输入示例

```json
{
  "trigger_type": "chat",
  "plugin_id": "riddle",
  "car": {
    "speed": 80,
    "destination": "迪士尼",
    "environment": "高速路晴天白天"
  },
  "passengers": {
    "relationship": "父母+小孩",
    "selected_seat": "front",
    "selected_seat_label": "副驾",
    "states": {
      "driver": "普通",
      "front": "普通",
      "rear_left": "普通",
      "rear_right": "普通"
    }
  },
  "game": {
    "status": "playing",
    "round_index": 1,
    "total_rounds": 10,
    "question_count": 3,
    "max_questions": 15,
    "current_answer": "米老鼠",
    "current_theme": "迪士尼",
    "hint": "如果目的地是迪士尼，这位老朋友大概率会第一个出来打招呼。"
  },
  "player_seat": "副驾",
  "player_input": "它是动画角色吗？",
  "event": null
}
```

### 输出示例

```json
{
  "ai_reply_text": "是，而且它绝对是目的地里的重量级老朋友。",
  "game_status": "playing",
  "is_correct": false,
  "answer": "米老鼠",
  "ui_change": {
    "cabin_mode": "normal",
    "target_seat": "front",
    "host_emotion": "thinking",
    "animation": "answer",
    "show_answer": false
  }
}
```

### 高优先级事件示例

```json
{
  "trigger_type": "event",
  "event": {
    "type": "hard_brake",
    "seat": "front"
  }
}
```

推荐 Workflow 收到 `hard_brake` 时直接返回暂停态：

```json
{
  "ai_reply_text": "大家坐稳，游戏先暂停 30 秒。主驾专心看路，安全第一。",
  "game_status": "paused",
  "is_correct": false,
  "answer": "安全带",
  "ui_change": {
    "cabin_mode": "safety_pause",
    "target_seat": "all",
    "host_emotion": "serious",
    "animation": "pause",
    "show_answer": false
  }
}
```

## 第一版演示路径

1. 点击“开始模拟”
2. 副驾输入“它是车上的东西吗？”
3. 点击“发送提问”
4. 点击“急刹打断”
5. 等待前端自动恢复游戏
6. 输入当前谜底，例如“答案是安全带”
7. 页面展示猜对、谜底揭晓和答对座位氛围灯

V1.1 之后正式体验以 Workflow 为主路径，Mock 仅作为开发期或异常保护。
