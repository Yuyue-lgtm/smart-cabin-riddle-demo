# Coze Workflow 节点设计

> 当前推荐：以 [COZE_FAST_PATH_OPTIMIZATION.md](./COZE_FAST_PATH_OPTIMIZATION.md) 的低延迟路径为基线，逐步升级为“座舱状态摘要 + 策略选择 + 按需 Know-how + 单次快速导演”。下文旧版十节点拆分仅保留作职责参考，不应照原样串行部署。

## 目标

本文定义智能座舱 AI 猜谜 Demo 在 Coze 中的 Workflow 节点设计。该 Workflow 的角色不是普通聊天机器人，而是：

```text
智能座舱游戏导演
```

它负责接收前端传来的完整座舱上下文，结合融合决策 know-how，输出 AI 主持人话术、模拟乘客动作、游戏状态和 UI 指令。

## 关联文档

- [WORKFLOW_CONTRACT.md](./WORKFLOW_CONTRACT.md)：前端与 Workflow 的输入输出 JSON 契约
- [FUSION_DECISION_KNOWHOW.md](./FUSION_DECISION_KNOWHOW.md)：融合决策策略表
- [MVP_SPEC.md](./MVP_SPEC.md)：产品最小闭环和功能边界

## Workflow 名称

建议命名：

```text
SmartCabinRiddleDirector
```

中文名：

```text
智能座舱猜谜导演
```

## 当前目标结构

```text
Start
→ Input Normalize（输入标准化）
→ Cabin State Summary（座舱局势摘要，代码）
→ Safety Gate（安全与强制事件，代码）
→ Strategy Selector（主持策略选择，代码/轻量判断）
→ Know-how Resolver（按需取得 2-3 条相关经验）
→ Fast Director（单次大模型调用）
→ Output Guard（结构与动作校验，代码）
→ End
```

确定性事件继续绕过模型：

```text
Safety Gate 命中急刹、暂停、明确猜中等确定性事件
→ Deterministic Result
→ Output Guard
```

这套结构不是让模型每次重新学习完整 Know-how。常驻原则保持短小，策略由代码先选定，只有与当前局势相关的少量案例进入 `Fast Director`。

## 最小座舱状态

`Cabin State Summary` 只维护七类高感知状态：

| 状态 | 取值 |
| --- | --- |
| `vehicle_state` | `normal` / `high_speed` / `hard_brake` |
| `driver_state` | `normal` / `fatigued` |
| `sleeping_seats` | 座位数组 |
| `inactive_seat` | 一个座位或 `null` |
| `game_progress` | `normal` / `stuck` / `near_answer` / `correct` |
| `environment_hook` | 当前黄金体验线的环境枚举 |
| `cabin_mood` | `normal` / `laughing`，可选 |

年龄、乘客关系、目的地作为黄金体验线的场景配置，不作为实时控制项。第一版不加入电话、冲突、长期记忆、真实声纹和精细情绪识别。

## Know-how 在 Workflow 中的形态

### 常驻主持原则

始终放在 `Fast Director` 的系统提示词中，内容只包括安全优先级、主持人格、动作边界和禁止事项。

### 策略索引

由 `Strategy Selector` 使用，例如安全接管、游戏推进、邀请沉默玩家、环境融合和胜利造神。每次只选择一个主策略，最多附带两个表达修饰因素。

### 完整经验库

保存典型场景、表达技巧和正反例。`Know-how Resolver` 只返回当前局势相关的 2-3 条：

- V1.2 先用代码映射，避免增加知识库调用延迟。
- 案例规模扩大后，可替换为知识库检索，接口保持不变。
- 安全规则不进入知识库，召回失败也不能影响安全路径。

### Fast Director 输入

模型只接收压缩后的信息：

```json
{
  "cabin_state": {
    "vehicle_state": "normal",
    "driver_state": "normal",
    "sleeping_seats": ["rearLeft"],
    "inactive_seat": "rearRight",
    "game_progress": "stuck",
    "environment_hook": "城区雨天白天",
    "cabin_mood": "normal"
  },
  "primary_strategy": "PROGRESS_ASSIST",
  "modifiers": ["RAINY_CONTEXT", "CHILD_FRIENDLY"],
  "relevant_knowhow": [
    "游戏卡住时先替玩家找台阶，再给一级提示",
    "雨天只作为自然提示包装，不要机械播报天气"
  ]
}
```

## 旧版职责拆分参考

以下节点结构用于理解职责边界，不是当前部署拓扑：

```text
Start
→ Input Normalize
→ Context Summary
→ Priority Router
→ Strategy Match
→ Game Judge
→ Passenger Action Planner
→ Host Reply Generator
→ UI Change Composer
→ JSON Formatter
→ JSON Validator
→ End
```

## 设计原则

### 单入口

前端所有动作都调用同一个 Workflow。

不为 AI 开场、玩家提问、急刹、模拟乘客分别建多个 Workflow。这样可以保证状态判断、策略匹配和输出格式一致。

### 完整上下文输入

前端每次调用都发送完整上下文，而不是只发送变化字段。

原因：

- Workflow 不依赖隐式状态
- 更容易调试
- 时间轴事件、用户输入、模拟乘客动作可以统一处理

### 规则优先，模型表达

安全与优先级判断用规则，主持人自然话术用大模型。

```text
规则负责“该做什么”
模型负责“怎么说得像真人”
```

### 结构化输出

Workflow 最终必须输出符合 `WORKFLOW_CONTRACT.md` 的 JSON。

前端只执行 JSON，不解析 AI 自然语言。

## Start 节点

### 作用

接收前端输入。

### 推荐入参

第一阶段建议只配置一个入参：

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| `input_payload` | string | 前端传来的完整 JSON 字符串 |

### 为什么用单个 JSON 字符串

优点：

- 前端字段变化时不用频繁改 Coze 入参
- 可以完整保留嵌套结构
- 调试时可以直接复制一整段输入

### input_payload 示例

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
    "user_seat": "front",
    "states": {
      "driver": "普通",
      "front": "普通",
      "rear_left": "普通",
      "rear_right": "普通"
    }
  },
  "timeline": {
    "id": "family_highway_disney",
    "name": "高速亲子出行",
    "elapsed_seconds": 32
  },
  "game": {
    "status": "playing",
    "question_count": 3,
    "max_questions": 15,
    "current_answer": "安全带",
    "current_theme": "高速",
    "asked_questions": ["它是车上的东西吗？"]
  },
  "interaction": {
    "current_speaker": "front",
    "user_seat": "front",
    "recent_messages": []
  },
  "player_input": "它能保护我们吗？",
  "event": null
}
```

## 节点 1：Input Normalize

### 类型

建议优先用代码节点或变量处理节点。

### 作用

解析 `input_payload`，补默认值，统一字段名。

### 输入

```json
{
  "input_payload": "{...}"
}
```

### 输出

```json
{
  "payload": {},
  "trigger_type": "chat",
  "event_type": null,
  "event_source": null,
  "priority_hint": null,
  "car_speed": 80,
  "environment": "高速路晴天白天",
  "destination": "迪士尼",
  "relationship": "父母+小孩",
  "selected_seat": "front",
  "user_seat": "front",
  "game_status": "playing",
  "question_count": 3,
  "max_questions": 15,
  "current_answer": "安全带",
  "player_input": "它能保护我们吗？"
}
```

### 默认值规则

如果字段缺失：

```text
trigger_type = event
car_speed = 0
environment = 未知环境
destination = 未设置
relationship = 未知关系
game_status = idle
question_count = 0
max_questions = 15
player_input = ""
```

### 注意

如果 JSON 解析失败，直接输出错误态：

```json
{
  "should_stop": true,
  "error_code": "INVALID_INPUT_JSON"
}
```

后续 JSON Formatter 应返回：

```json
{
  "passenger_action": null,
  "ai_reply_text": "我这边收到的信息格式有点乱，先稳一下，我们重新开始这一轮。",
  "game_status": "idle",
  "is_correct": false,
  "answer": "",
  "ui_change": {
    "cabin_mode": "normal",
    "target_seat": "all",
    "host_emotion": "care",
    "animation": "speak",
    "show_answer": false
  }
}
```

## 节点 2：Context Summary

### 类型

大模型节点或模板节点。

### 作用

把完整上下文压缩成简短摘要，供后续节点使用。

### 输入

- 标准化后的 payload
- 最近消息
- 当前游戏状态
- 当前事件

### 输出

```json
{
  "context_summary": "当前是高速亲子出行场景，车速 80km/h，目的地迪士尼。用户坐在副驾，游戏进行中，谜底是安全带，已问 3 个问题。刚刚副驾问：它能保护我们吗？"
}
```

### 生成要求

- 不超过 120 字
- 只陈述事实，不做决策
- 保留关键风险信息，例如急刹、高速、主驾疲惫、有人睡着

## 节点 3：Priority Router

### 类型

规则节点。

### 作用

判断是否命中高优先级事件，决定后续分支。

### 输入

- `event_type`
- `car_speed`
- `passengers.states`
- `game_status`
- `timeline.current_event`

### 输出

```json
{
  "priority": "P1",
  "priority_reason": "车速达到 100km/h，主驾需要降频",
  "forced_strategy_id": "S02",
  "allow_passenger_action": true,
  "skip_game_judge": false
}
```

### 规则建议

```text
if event.type == hard_brake:
  priority = P0
  forced_strategy_id = S01
  allow_passenger_action = false
  skip_game_judge = true

else if car.speed >= 100:
  priority = P1
  forced_strategy_id = S02
  allow_passenger_action = true

else if event.type == driver_tired:
  priority = P1
  forced_strategy_id = S03
  allow_passenger_action = true

else if any passenger.state == 睡着:
  priority = P2
  forced_strategy_id = S04
  allow_passenger_action = true

else:
  priority = P3
  forced_strategy_id = null
```

### P0 分支要求

命中 P0 后：

- 不生成 `passenger_action`
- `game_status` 通常改为 `paused`
- 直接进入 `Host Reply Generator`
- 不继续做普通游戏判断

## 节点 4：Strategy Match

### 类型

规则节点 + 大模型辅助节点均可。

### 作用

根据 `FUSION_DECISION_KNOWHOW.md` 匹配当前策略。

### 输入

- Priority Router 输出
- Context Summary
- trigger_type
- event_type
- environment
- destination
- relationship
- question_count
- player_input
- game_status

### 输出

```json
{
  "strategy_id": "S18",
  "strategy_name": "多轮无进展给提示",
  "decision_goal": "降低挫败感，推动游戏继续",
  "host_tone": "自嘲、鼓励、降低压力",
  "strategy_rules": {
    "allow_passenger_action": true,
    "target_seat": "front",
    "cabin_mode": "normal",
    "animation": "cue"
  }
}
```

### V1.1 策略匹配规则

V1.1 先实现：

| strategy_id | 触发 |
| --- | --- |
| `S01` | 急刹 |
| `S02` | 车速 >= 100 |
| `S03` | 主驾疲惫 |
| `S04` | 有人睡着 |
| `S07` | 雨天环境 |
| `S09` | 快到目的地 |
| `S14` | 小朋友答对 |
| `S18` | 多轮无进展 |

### 策略匹配伪代码

```text
if forced_strategy_id exists:
  strategy = forced_strategy_id
elif event_type == near_destination:
  strategy = S09
elif environment contains 雨天:
  strategy = S07
elif question_count >= 8:
  strategy = S18
else:
  strategy = S00_NORMAL
```

## 节点 5：Game Judge

### 类型

大模型节点或规则 + 大模型节点。

### 作用

判断用户或模拟乘客输入与谜底的关系。

### 输入

- `player_input`
- `current_answer`
- `asked_questions`
- `question_count`
- `strategy_id`
- `trigger_type`

### 输出

```json
{
  "input_type": "question",
  "is_valid_question": true,
  "is_guess": false,
  "is_correct": false,
  "is_near_answer": true,
  "should_reveal_answer": false,
  "answer_polarity": "yes",
  "game_judge_reason": "玩家问是否能保护人，安全带符合该属性"
}
```

### 输入类型

| input_type | 含义 |
| --- | --- |
| `question` | 是/否问题 |
| `guess` | 直接猜答案 |
| `joke` | 玩笑/无明确问题 |
| `invalid` | 无效输入 |
| `none` | 本次没有玩家输入 |

### 判断规则

如果 `player_input` 包含当前谜底，通常：

```json
{
  "is_guess": true,
  "is_correct": true,
  "should_reveal_answer": true
}
```

如果是普通是/否问题：

```json
{
  "is_guess": false,
  "is_correct": false,
  "answer_polarity": "yes/no/uncertain"
}
```

### 注意

P0 急刹时可以跳过 Game Judge。

## 节点 6：Passenger Action Planner

### 类型

规则节点 + 大模型节点。

### 作用

决定是否生成模拟乘客动作。

### 输入

- `trigger_type`
- `game_status`
- `priority`
- `strategy_id`
- `allow_passenger_action`
- `passengers.states`
- `passengers.personas`
- `interaction.simulation_request`
- `asked_questions`
- `last_speaker`
- `user_seat`

### 输出

```json
{
  "passenger_action": {
    "seat": "rearRight",
    "text": "它是不是车里能保护我们的东西？",
    "mood": "普通",
    "intent": "ask_attribute"
  },
  "passenger_action_reason": "后排小朋友可参与，当前问题数不高，适合问属性问题"
}
```

或：

```json
{
  "passenger_action": null,
  "passenger_action_reason": "游戏暂停，不生成模拟乘客发言"
}
```

### 生成条件

满足以下任一条件才考虑生成：

- `trigger_type = simulation`
- `event.type = request_passenger_action`
- 时间轴事件请求模拟乘客发言
- 策略建议模拟乘客补充关键提问

### 禁止条件

如果命中任一条件，必须返回 `null`：

- `game_status = paused`
- `priority = P0`
- `allow_passenger_action = false`
- 可选乘客全部睡着或被排除
- 当前事件是急刹、通话、安全提醒

### 选座规则

优先级：

```text
非用户座位
非副驾真实用户
非主驾
未睡着
上一轮没发言
符合乘客关系的人设
```

高速时：

```text
exclude driver
exclude front for passenger_action
```

### 发言意图

V1.1 支持：

- `ask_category`
- `ask_attribute`
- `ask_scene`
- `guess_answer`

### 生成约束

- 每次最多生成一个 `passenger_action`
- 不重复已问过的问题
- 问题尽量短，适合车内语音
- 前 3 问不要直接猜中，除非时间轴或策略明确要求

## 节点 7：Host Reply Generator

### 类型

大模型节点。

### 作用

根据策略、游戏判断和模拟乘客动作，生成 AI 主持人话术。

### 输入

- `context_summary`
- `strategy_id`
- `strategy_name`
- `decision_goal`
- `host_tone`
- `game_judge`
- `passenger_action`
- `current_answer`
- `relationship`
- `selected_seat`

### 输出

```json
{
  "ai_reply_text": "是，非常接近。这个问题一下把范围缩小了。"
}
```

### Prompt 建议

```text
你是智能座舱里的 AI 猜谜主持人。
你要根据座舱状态、游戏状态、乘客状态和当前策略生成一句主持话术。

要求：
1. 话术适合车内播报，尽量短，不超过 60 字。
2. 安全相关事件必须温柔但坚定，不开玩笑。
3. 小朋友答对时要给具体鼓励。
4. 长辈答对时要给尊重感。
5. 年轻朋友场景可以更活泼，但不要过度。
6. 不要泄露谜底，除非 is_correct=true 或 show_answer=true。
7. 如果 passenger_action 存在，先回应该乘客的问题。
8. 输出只返回 ai_reply_text，不要返回解释。
```

### 示例

输入策略：

```json
{
  "strategy_id": "S02",
  "decision_goal": "降低主驾分心",
  "host_tone": "清晰、照顾、不制造压力"
}
```

输出：

```text
车速上来了，主驾先专心看路。接下来的问题交给副驾和后排侦探团。
```

## 节点 8：UI Change Composer

### 类型

规则节点。

### 作用

把策略和游戏结果转成前端 UI 指令。

### 输入

- `strategy_id`
- `game_judge`
- `passenger_action`
- `priority`
- `selected_seat`

### 输出

```json
{
  "game_status": "playing",
  "is_correct": false,
  "ui_change": {
    "cabin_mode": "normal",
    "target_seat": "rearRight",
    "host_emotion": "thinking",
    "animation": "answer",
    "show_answer": false
  }
}
```

### 映射规则

| 情况 | game_status | cabin_mode | animation | show_answer |
| --- | --- | --- | --- | --- |
| 急刹 | `paused` | `safety_pause` | `pause` | false |
| 高速主驾降频 | `playing` | `driver_focus` | `cue` | false |
| 有人睡着 | 当前状态 | `soft` | `soft` | false |
| 快到目的地 | `playing` | `final_round` | `final` | false |
| 答对 | `victory` | `victory` | `victory` | true |
| 失败揭晓 | `failed` | `reveal` | `reveal` | true |
| 普通回答 | `playing` | `normal` | `answer` | false |

### target_seat 规则

优先级：

1. `passenger_action.seat`
2. 答对乘客座位
3. 策略指定座位
4. 当前用户座位
5. `all`

## 节点 9：JSON Formatter

### 类型

模板节点或代码节点。

### 作用

组装最终输出 JSON。

### 输出格式

```json
{
  "passenger_action": null,
  "ai_reply_text": "",
  "game_status": "playing",
  "is_correct": false,
  "answer": "安全带",
  "ui_change": {
    "cabin_mode": "normal",
    "target_seat": "front",
    "host_emotion": "normal",
    "animation": "speak",
    "show_answer": false
  },
  "debug": {
    "strategy_id": "S00_NORMAL",
    "priority": "P3",
    "reason": "普通游戏回答"
  }
}
```

### debug 字段

建议开发期保留：

```json
"debug": {
  "strategy_id": "S02",
  "priority": "P1",
  "reason": "车速达到 100km/h"
}
```

对外分享版可以由前端隐藏。

## 节点 10：JSON Validator

### 类型

代码节点或大模型 JSON 修复节点。

### 作用

校验最终输出是否符合契约。

### 必检字段

- `ai_reply_text`
- `game_status`
- `is_correct`
- `answer`
- `ui_change`
- `ui_change.cabin_mode`
- `ui_change.show_answer`

### 校验规则

```text
if priority == P0:
  passenger_action must be null

if is_correct == true:
  ui_change.show_answer should be true
  game_status should be victory

if game_status == paused:
  passenger_action must be null

if passenger_action exists:
  passenger_action.seat and passenger_action.text required
```

### 失败处理

如果校验失败，返回保守输出：

```json
{
  "passenger_action": null,
  "ai_reply_text": "我这边稍微整理一下信息，我们继续稳稳地玩。",
  "game_status": "playing",
  "is_correct": false,
  "answer": "",
  "ui_change": {
    "cabin_mode": "normal",
    "target_seat": "all",
    "host_emotion": "care",
    "animation": "speak",
    "show_answer": false
  },
  "debug": {
    "error": "OUTPUT_VALIDATION_FAILED"
  }
}
```

## End 节点

### 输出

建议只输出一个字段：

```text
workflow_output
```

类型为 JSON 字符串或对象。

前端适配时需要兼容：

- 直接 JSON
- `{ "data": {} }`
- `{ "output": "{}" }`
- `{ "result": "{}" }`

## 前端动作到 Workflow 映射

前端只调用一个函数：

```js
callWorkflow(payload)
```

### 映射表

| 前端动作 | trigger_type | event.type | 是否有 player_input | 是否可能有 passenger_action |
| --- | --- | --- | --- | --- |
| AI 开场 | `event` | `start_game` | 否 | 否 |
| 用户提问 | `chat` | null | 是 | 否 |
| 用户猜答案 | `chat` | null | 是 | 否 |
| 请求模拟乘客发言 | `simulation` | `request_passenger_action` | 否 | 是 |
| 急刹打断 | `event` | `hard_brake` | 否 | 否 |
| 恢复游戏 | `event` | `resume_game` | 否 | 否 |
| 主驾疲惫 | `event` | `driver_tired` | 否 | 通常否 |
| 有人睡着 | `event` | `passenger_sleep` | 否 | 否 |
| 快到目的地 | `event` | `near_destination` | 否 | 可选 |
| 时间轴环境变化 | `event` | `environment_change` | 否 | 可选 |
| 时间轴车速变化 | `event` | `speed_change` | 否 | 可选 |

## 前端接口封装建议

### 统一调用

```js
async function callWorkflow(payload) {
  const response = await fetch(WORKFLOW_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input_payload: JSON.stringify(payload)
    })
  });

  return normalizeWorkflowResponse(await response.json());
}
```

### payload 构建

每次调用都包含：

- car
- passengers
- timeline
- game
- interaction
- trigger_type
- event
- player_input

不要只传增量。

### 前端应用输出

前端收到输出后按顺序处理：

```text
1. 如果 passenger_action 存在，显示乘客气泡并追加互动记录
2. 显示 ai_reply_text
3. 更新 game_status
4. 应用 ui_change
5. 如果 show_answer=true，揭晓谜底
6. 如果 is_correct=true，触发答对乘客氛围灯和音效
```

## 时间轴接入方式

时间轴由前端管理。Coze 不负责计时。

前端时间轴每触发一个事件，就调用 Workflow：

```json
{
  "trigger_type": "event",
  "event": {
    "type": "driver_tired",
    "source": "timeline",
    "priority": "P1"
  },
  "timeline": {
    "id": "family_highway_disney",
    "name": "高速亲子出行",
    "elapsed_seconds": 30,
    "current_event": {
      "type": "driver_tired",
      "description": "检测到主驾疲惫"
    }
  }
}
```

### 时间轴原则

- 时间流逝在前端
- 决策在 Workflow
- 状态展示在前端
- 高优先级事件可以打断时间轴普通发言

## 调试建议

### 开发期打开 debug

Workflow 输出中保留：

```json
{
  "debug": {
    "strategy_id": "S02",
    "priority": "P1",
    "reason": "车速达到 100km/h",
    "passenger_action_reason": "高速状态不选择主驾"
  }
}
```

前端可以暂时显示一个调试面板，后续分享版隐藏。

### 准备测试样例

至少准备以下输入样例：

1. AI 开场
2. 普通用户提问
3. 用户猜对
4. 急刹打断
5. 主驾疲惫
6. 有人睡着
7. 雨天环境变化
8. 请求模拟乘客发言

## V1.1 搭建顺序

建议按这个顺序搭：

1. Start + Input Normalize
2. JSON Formatter + End
3. 先跑通固定输出
4. 加 Priority Router
5. 实现 S01 急刹
6. 实现普通用户提问
7. 实现 Game Judge
8. 实现 Passenger Action Planner
9. 实现 Host Reply Generator
10. 加 JSON Validator
11. 前端联调

这样每一步都可测，不容易一次性搭成黑盒。

## V1.1 最小可用范围

V1.1 不需要一次实现全部策略。最低可用范围：

- `S01` 急刹打断
- `S02` 高速主驾降频
- `S04` 有人睡着
- 普通用户提问回答
- 用户猜对判断
- 单个 `passenger_action`
- 一条时间轴事件

完成这些，就已经能证明：

```text
前端上下文 → Coze 融合决策 → AI 主持话术 → 模拟乘客动作 → UI 执行
```
