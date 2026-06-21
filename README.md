# 智能座舱 AI 猜谜 Demo

当前仓库的 `V1.0` 是一个可部署的静态网页骨架，用于演示：

- 上帝视角输入座舱状态
- 玩家模拟提问
- 事件打断游戏流程
- 调用 Coze/Dify Workflow 做融合决策
- 根据结构化 JSON 返回更新网页表现

V1.1 之后的产品方向已升级为“可分享体验版”：通过时间轴模拟多模态事件，并由 Workflow 驱动 AI 主持人与半自主模拟乘客参与游戏。

最新需求、路线图和接口契约以 [docs/README.md](./docs/README.md) 为准。

## 本地运行

如果只看页面，不接 Workflow，直接打开 `index.html` 即可。

如果需要本地联调 Coze Workflow，请先创建 `.env.local`：

```text
COZE_WORKFLOW_URL=https://your-workflow-domain.coze.site/run
COZE_API_TOKEN=replace_with_your_new_coze_api_token
```

然后启动本地代理服务：

```bash
node server.js
```

然后访问：

```text
http://localhost:4173
```

本地页面默认请求：

```text
/api/workflow
```

真实 Token 只会被 `server.js` 读取，不会进入前端代码。

## 部署方式

当前推荐使用 Vercel，因为项目已经包含 `/api/workflow` 代理。

部署时需要在 Vercel 环境变量里配置：

```text
COZE_WORKFLOW_URL=https://your-workflow-domain.coze.site/run
COZE_API_TOKEN=replace_with_your_new_coze_api_token
```

前端页面会请求同域的：

```text
/api/workflow
```

由服务端代理携带 Token 请求 Coze。不要把 Token 写入 `app.js`、`index.html` 或任何会提交到 Git 的文件。

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
