# 智能座舱 AI 猜谜 Demo

第一版是一个可部署的静态网页骨架，用于演示：

- 上帝视角输入座舱状态
- 玩家模拟提问
- 事件打断游戏流程
- 调用 Coze/Dify Workflow 做融合决策
- 根据结构化 JSON 返回更新网页表现

## 本地运行

直接打开 `index.html` 即可。

如果需要用本地服务预览，可以在当前目录启动静态服务：

```bash
python3 -m http.server 4173
```

然后访问：

```text
http://localhost:4173
```

## 部署方式

当前版本不依赖构建工具，可以直接部署到任意静态站点服务：

- Vercel
- Netlify
- GitHub Pages
- 阿里云 OSS 静态网站
- 公司内部静态资源服务器

部署时上传这三个文件即可：

- `index.html`
- `styles.css`
- `app.js`

## Workflow 接口

页面右下角可以填写 Workflow 接口地址。点击“保存”后会写入浏览器本地存储。

网页会以 `POST JSON` 的方式请求接口。

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

1. 点击“AI 开场”
2. 副驾输入“它是车上的东西吗？”
3. 点击“发送提问”
4. 点击“急刹打断”
5. 点击“恢复游戏”
6. 输入当前谜底，例如“答案是安全带”
7. 页面展示猜对和谜底揭晓

如果未配置 Workflow 接口，网页会自动使用本地兜底决策，保证现场演示不断链。
