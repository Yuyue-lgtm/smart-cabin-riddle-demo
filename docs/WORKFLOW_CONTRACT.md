# Workflow 接口契约

## 目标

Workflow 接口用于承接网页发来的座舱状态、游戏状态、时间轴事件、用户输入和模拟乘客请求，并返回 AI 主持人话术、模拟乘客动作与网页 UI 执行动作。

核心原则：

```text
Workflow 负责融合决策和表达
网页负责状态展示和动作执行
```

AI 主持人话术、模拟乘客动作和 UI 指令必须分开。网页不应解析自然语言来判断界面如何变化。

## 调用方式

网页以 `POST JSON` 方式请求 Workflow。

```http
POST https://your-workflow-endpoint
Content-Type: application/json
```

正式体验以 Workflow 为主路径。Mock 只作为开发期或异常保护。

## 输入结构

### 顶层结构

```json
{
  "trigger_type": "chat",
  "plugin_id": "riddle",
  "car": {},
  "passengers": {},
  "timeline": {},
  "game": {},
  "interaction": {},
  "player_seat": "副驾",
  "player_input": "它是车上的东西吗？",
  "event": null
}
```

### trigger_type

触发类型。

| 值 | 含义 |
| --- | --- |
| `chat` | 用户提问或猜答案 |
| `event` | 手动事件或时间轴事件 |
| `simulation` | 请求 Workflow 生成模拟乘客动作 |

### plugin_id

当前游戏插件。

V1.x 固定为：

```json
"riddle"
```

后续可能扩展：

- `idiom_chain`
- `guess_song`
- `story_chain`
- `spot_challenge`

## car

车辆与车外环境状态。

```json
{
  "speed": 80,
  "destination": "迪士尼",
  "environment": "高速路晴天白天"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `speed` | number | 是 | 当前车速，单位 km/h |
| `destination` | string | 是 | 当前目的地 |
| `environment` | string | 是 | 当前车外环境 |

## passengers

乘客状态与人设。

```json
{
  "relationship": "父母+小孩",
  "selected_seat": "front",
  "selected_seat_label": "副驾",
  "user_seat": "front",
  "states": {
    "driver": "普通",
    "front": "普通",
    "rear_left": "普通",
    "rear_right": "普通"
  },
  "personas": {
    "rear_right": {
      "name": "后排小朋友",
      "persona": "好奇、兴奋、喜欢动画和食物",
      "style": "短句、直接、偶尔抢答",
      "can_guess": true
    }
  }
}
```

### relationship

乘客关系。

V1.x 支持：

- `年轻朋友`
- `父母+小孩`
- `中老年+儿女`

### selected_seat

当前选中或发言乘客的程序字段。

| 值 | 中文 |
| --- | --- |
| `driver` | 主驾 |
| `front` | 副驾 |
| `rearLeft` | 左后 |
| `rearRight` | 右后 |

### user_seat

真实用户扮演的座位。其他座位可由模拟乘客系统参与。

### states

每个座位当前情绪。

支持：

- `普通`
- `大笑`
- `沉默`
- `睡着`

### personas

模拟乘客人设信息。Workflow 可根据人设决定是否发言、如何发言、是否猜答案。

## timeline

时间轴状态。

```json
{
  "id": "family_highway_disney",
  "name": "高速亲子出行",
  "status": "running",
  "elapsed_seconds": 32,
  "current_event": {
    "type": "driver_tired",
    "priority": "P1",
    "description": "检测到主驾疲惫"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 否 | 当前时间轴 ID |
| `name` | string | 否 | 当前时间轴名称 |
| `status` | string | 否 | `idle` / `running` / `paused` / `finished` |
| `elapsed_seconds` | number | 否 | 时间轴已运行秒数 |
| `current_event` | object | 否 | 当前触发的时间轴事件 |

时间轴事件进入 Workflow 时，`trigger_type` 通常为 `event`。

## game

游戏状态。

```json
{
  "status": "playing",
  "round_index": 1,
  "total_rounds": 10,
  "question_count": 3,
  "max_questions": 15,
  "current_answer": "安全带",
  "current_theme": "高速",
  "hint": "它平时很安静，但关键时刻比主持人还可靠。",
  "asked_questions": [
    "它是车上的东西吗？",
    "它能保护我们吗？"
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | string | 是 | 当前游戏状态 |
| `round_index` | number | 是 | 当前第几题 |
| `total_rounds` | number | 是 | 总题数，V1.x 为 10 |
| `question_count` | number | 是 | 当前题已提问次数 |
| `max_questions` | number | 是 | 当前题最多提问次数，V1.x 为 15 |
| `current_answer` | string | 是 | 当前谜底 |
| `current_theme` | string | 是 | 当前谜底主题 |
| `hint` | string | 是 | 给 Workflow 的题目辅助信息 |
| `asked_questions` | array | 否 | 已经问过的问题，用于避免重复 |

### status

V1.x 支持：

| 值 | 含义 |
| --- | --- |
| `idle` | 待开局 |
| `opening` | 开场中 |
| `playing` | 游戏进行中 |
| `paused` | 游戏暂停 |
| `victory` | 猜对 |
| `failed` | 失败或揭晓 |

## interaction

车内互动状态。

```json
{
  "current_speaker": "front",
  "last_speaker": "rearLeft",
  "user_seat": "front",
  "recent_messages": [
    {
      "role": "passenger",
      "seat": "front",
      "text": "它是车上的东西吗？"
    },
    {
      "role": "host",
      "text": "是，和出行场景关系很近。"
    }
  ],
  "simulation_request": {
    "enabled": true,
    "exclude_seats": ["front", "driver"],
    "reason": "轮到模拟乘客参与"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `current_speaker` | string | 否 | 当前发言座位 |
| `last_speaker` | string | 否 | 上一位发言座位 |
| `user_seat` | string | 否 | 真实用户座位 |
| `recent_messages` | array | 否 | 近期对话记录 |
| `simulation_request` | object | 否 | 是否请求模拟乘客动作 |

## player_input

当 `trigger_type = chat` 时，表示真实用户输入内容。

可能是：

- 是/否问题：`它是活的吗？`
- 猜答案：`答案是安全带`
- 玩笑输入：`是不是后排的锅？`

当 `trigger_type = event` 或 `simulation` 时可以为空字符串。

## event

当 `trigger_type = event` 时，表示手动或时间轴触发事件。

```json
{
  "type": "hard_brake",
  "source": "timeline",
  "seat": "front",
  "value": "高速路雨天白天",
  "priority": "P0"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | string | 是 | 事件类型 |
| `source` | string | 否 | `manual` / `timeline` / `system` |
| `seat` | string | 否 | 事件关联座位 |
| `value` | any | 否 | 事件附加值 |
| `priority` | string | 否 | 事件优先级 |

### V1.x 事件类型

| type | 含义 | 优先级 |
| --- | --- | --- |
| `start_game` | AI 开场 | P3 |
| `hard_brake` | 急刹打断 | P0 |
| `resume_game` | 恢复游戏 | P1 |
| `driver_tired` | 主驾疲惫 | P1 |
| `passenger_sleep` | 有人睡着 | P2 |
| `near_destination` | 快到目的地 | P2 |
| `environment_change` | 车外环境变化 | P2 |
| `speed_change` | 车速变化 | P2 |
| `destination_change` | 目的地变化 | P3 |
| `relationship_change` | 乘客关系变化 | P3 |
| `request_passenger_action` | 请求模拟乘客动作 | P3 |

## 输出结构

Workflow 必须返回结构化 JSON。

```json
{
  "passenger_action": {
    "seat": "rearRight",
    "text": "它是不是车里能保护我们的东西？",
    "mood": "普通",
    "intent": "ask_attribute"
  },
  "ai_reply_text": "是，而且关键时刻很重要。",
  "game_status": "playing",
  "is_correct": false,
  "answer": "安全带",
  "ui_change": {
    "cabin_mode": "normal",
    "target_seat": "rearRight",
    "host_emotion": "thinking",
    "animation": "answer",
    "show_answer": false
  }
}
```

## 输出字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ai_reply_text` | string | 是 | AI 主持人要说的话 |
| `game_status` | string | 是 | 网页需要切换到的游戏状态 |
| `is_correct` | boolean | 是 | 用户或模拟乘客是否猜对 |
| `answer` | string | 是 | 当前谜底 |
| `next_answer` | string | 否 | 下一题谜底，环境变化时可返回 |
| `passenger_action` | object/null | 否 | 模拟乘客动作 |
| `ui_change` | object | 是 | 网页执行动作 |

## passenger_action

第一阶段只支持单个模拟乘客动作，避免流程复杂度过高。

```json
{
  "seat": "rearRight",
  "text": "它是不是车里能保护我们的东西？",
  "mood": "普通",
  "intent": "ask_attribute"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `seat` | string | 是 | 发言座位 |
| `text` | string | 是 | 模拟乘客发言内容 |
| `mood` | string | 否 | 发言后的乘客情绪 |
| `intent` | string | 否 | 发言意图 |

### seat

支持：

- `driver`
- `front`
- `rearLeft`
- `rearRight`

### intent

V1.x 建议支持：

- `ask_category`
- `ask_attribute`
- `ask_scene`
- `guess_answer`

### passenger_action 约束

Workflow 生成模拟乘客动作时必须遵守：

- 游戏暂停时不生成主动提问
- 睡着乘客不主动发言
- 主驾在高速或复杂路况下降低参与
- 不重复问已问过的问题
- 不连续让同一乘客抢话
- 不在太早阶段直接猜中

## ui_change

```json
{
  "cabin_mode": "normal",
  "target_seat": "front",
  "host_emotion": "thinking",
  "animation": "answer",
  "show_answer": false
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cabin_mode` | string | 是 | 座舱表现模式 |
| `target_seat` | string | 否 | 被 cue 或高亮的座位 |
| `host_emotion` | string | 否 | AI 主持人情绪 |
| `animation` | string | 否 | 页面动画类型 |
| `show_answer` | boolean | 是 | 是否展示谜底 |

### cabin_mode

V1.x 支持：

| 值 | 含义 |
| --- | --- |
| `normal` | 普通游戏状态 |
| `safety_pause` | 安全暂停 |
| `driver_focus` | 主驾专注模式 |
| `soft` | 轻声互动模式 |
| `final_round` | 绝杀局 |
| `environment_sync` | 环境融合 |
| `victory` | 胜利氛围 |
| `reveal` | 谜底揭晓 |

## 典型输入输出

### 用户提问

输入：

```json
{
  "trigger_type": "chat",
  "plugin_id": "riddle",
  "player_seat": "副驾",
  "player_input": "它是车上的东西吗？",
  "game": {
    "status": "playing",
    "question_count": 1,
    "current_answer": "安全带",
    "asked_questions": []
  },
  "interaction": {
    "user_seat": "front",
    "current_speaker": "front"
  }
}
```

输出：

```json
{
  "passenger_action": null,
  "ai_reply_text": "是，和出行或驾驶场景关系很近。",
  "game_status": "playing",
  "is_correct": false,
  "answer": "安全带",
  "ui_change": {
    "cabin_mode": "normal",
    "target_seat": "front",
    "host_emotion": "thinking",
    "animation": "answer",
    "show_answer": false
  }
}
```

### 模拟乘客发言

输入：

```json
{
  "trigger_type": "simulation",
  "plugin_id": "riddle",
  "player_input": "",
  "car": {
    "speed": 80,
    "destination": "迪士尼",
    "environment": "高速路晴天白天"
  },
  "passengers": {
    "relationship": "父母+小孩",
    "user_seat": "front",
    "states": {
      "driver": "普通",
      "front": "普通",
      "rear_left": "普通",
      "rear_right": "普通"
    }
  },
  "game": {
    "status": "playing",
    "question_count": 2,
    "current_answer": "安全带",
    "asked_questions": ["它是车上的东西吗？"]
  },
  "interaction": {
    "simulation_request": {
      "enabled": true,
      "exclude_seats": ["front", "driver"],
      "reason": "轮到模拟乘客参与"
    }
  }
}
```

输出：

```json
{
  "passenger_action": {
    "seat": "rearRight",
    "text": "它能保护我们吗？",
    "mood": "普通",
    "intent": "ask_attribute"
  },
  "ai_reply_text": "是，非常接近。这个问题一下把范围缩小了。",
  "game_status": "playing",
  "is_correct": false,
  "answer": "安全带",
  "ui_change": {
    "cabin_mode": "normal",
    "target_seat": "rearRight",
    "host_emotion": "thinking",
    "animation": "answer",
    "show_answer": false
  }
}
```

### 时间轴急刹打断

输入：

```json
{
  "trigger_type": "event",
  "plugin_id": "riddle",
  "event": {
    "type": "hard_brake",
    "source": "timeline",
    "priority": "P0"
  },
  "timeline": {
    "id": "family_highway_disney",
    "name": "高速亲子出行",
    "elapsed_seconds": 45
  },
  "game": {
    "status": "playing",
    "current_answer": "安全带"
  }
}
```

输出：

```json
{
  "passenger_action": null,
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

### 猜对答案

输入：

```json
{
  "trigger_type": "chat",
  "plugin_id": "riddle",
  "player_seat": "副驾",
  "player_input": "答案是安全带",
  "game": {
    "status": "playing",
    "question_count": 4,
    "current_answer": "安全带"
  }
}
```

输出：

```json
{
  "passenger_action": null,
  "ai_reply_text": "副驾真聪明，答案就是“安全带”。本局 MVP 已经出现！",
  "game_status": "victory",
  "is_correct": true,
  "answer": "安全带",
  "ui_change": {
    "cabin_mode": "victory",
    "target_seat": "front",
    "host_emotion": "excited",
    "animation": "victory",
    "show_answer": true
  }
}
```

## Workflow 决策建议

建议 Workflow 采用：

```text
输入标准化
→ 高优先级事件判断
→ 时间轴事件处理
→ 座舱策略判断
→ 模拟乘客动作判断
→ 猜谜插件判断
→ AI 主持话术生成
→ JSON 输出校验
```

高优先级规则示例：

```text
如果 event.type = hard_brake：
  直接暂停游戏
  不生成 passenger_action
  返回 safety_pause

如果 car.speed >= 100：
  降低主驾互动频率
  模拟乘客 exclude driver

如果某乘客状态 = 睡着：
  不让该乘客主动发言
  话术改为轻声或建议暂停
```

## 错误处理

网页侧应处理：

- Workflow 地址为空
- 请求失败
- 返回非 JSON
- JSON 字段缺失
- 返回格式包在 `data`、`output`、`result` 等字段内

对外体验版中，Workflow 不可用时优先提示：

```text
AI 服务暂时繁忙，请稍后再试。
```

开发环境可以保留 Mock 开关，但不作为正式体验重点。
