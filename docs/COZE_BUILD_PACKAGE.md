# Coze Workflow 可复制搭建包

> V1.2 低延迟改造请优先使用 [COZE_FAST_PATH_OPTIMIZATION.md](./COZE_FAST_PATH_OPTIMIZATION.md)。本文件保留 V1.1 完整节点版，便于理解原始职责拆分。

## 使用目标

本文用于在扣子 Coze 中快速搭建智能座舱 AI 猜谜 Demo 的 Workflow。

建议 Workflow 名称：

```text
SmartCabinRiddleDirector
```

中文名：

```text
智能座舱猜谜导演
```

## 搭建原则

- 前端所有动作只调用一个 Workflow。
- Start 节点只接收一个字符串参数：`input_payload`。
- `input_payload` 是前端完整上下文 JSON 字符串。
- Workflow 最终只输出一个结构化 JSON。
- 安全与优先级判断尽量规则化。
- 自然主持话术交给大模型生成。
- 第一阶段只支持单个 `passenger_action`。

## 节点总览

建议节点顺序：

```text
Start
→ Input Normalize
→ Priority Router
→ Strategy Match
→ Game Judge
→ Passenger Action Planner
→ Host Reply Generator
→ UI Change Composer
→ JSON Formatter
→ End
```

V1.1 最小版可以先省略复杂的独立 JSON Validator，把校验逻辑放进 `JSON Formatter` 的输出要求里。

## 1. Start 节点

### 入参配置

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `input_payload` | string | 是 | 前端传来的完整上下文 JSON 字符串 |

### 前端发送格式

```json
{
  "input_payload": "{\"trigger_type\":\"chat\",\"plugin_id\":\"riddle\"}"
}
```

注意：`input_payload` 内部是 JSON 字符串，不是对象。

## 2. Input Normalize 节点

### 推荐类型

代码节点。

### 节点名称

```text
Input Normalize
```

### 作用

解析 `input_payload`，补默认值，输出标准化上下文。

### 可复制代码逻辑

如果 Coze 代码节点支持 JavaScript，可用以下逻辑改写：

```js
async function main({ input_payload }) {
  let payload = {};

  try {
    payload = typeof input_payload === "string" ? JSON.parse(input_payload) : input_payload;
  } catch (error) {
    return {
      should_stop: true,
      error_code: "INVALID_INPUT_JSON",
      payload: {},
      trigger_type: "event",
      event_type: "invalid_input",
      player_input: ""
    };
  }

  const car = payload.car || {};
  const passengers = payload.passengers || {};
  const game = payload.game || {};
  const event = payload.event || null;
  const timeline = payload.timeline || {};
  const interaction = payload.interaction || {};

  return {
    should_stop: false,
    payload,
    trigger_type: payload.trigger_type || "event",
    plugin_id: payload.plugin_id || "riddle",
    event_type: event?.type || null,
    event_source: event?.source || null,
    priority_hint: event?.priority || null,
    car_speed: Number(car.speed || 0),
    environment: car.environment || "未知环境",
    destination: car.destination || "未设置",
    relationship: passengers.relationship || "未知关系",
    selected_seat: passengers.selected_seat || "front",
    selected_seat_label: passengers.selected_seat_label || "副驾",
    user_seat: passengers.user_seat || interaction.user_seat || "front",
    passenger_states: passengers.states || {},
    passenger_personas: passengers.personas || {},
    timeline,
    interaction,
    game_status: game.status || "idle",
    round_index: Number(game.round_index || 1),
    question_count: Number(game.question_count || 0),
    max_questions: Number(game.max_questions || 15),
    current_answer: game.current_answer || "",
    current_theme: game.current_theme || "",
    hint: game.hint || "",
    asked_questions: game.asked_questions || [],
    player_input: payload.player_input || "",
    recent_messages: interaction.recent_messages || []
  };
}
```

### 输出变量

后续节点至少需要使用：

- `trigger_type`
- `event_type`
- `car_speed`
- `environment`
- `relationship`
- `selected_seat`
- `user_seat`
- `passenger_states`
- `game_status`
- `question_count`
- `current_answer`
- `player_input`
- `asked_questions`

## 3. Priority Router 节点

### 推荐类型

代码节点或条件分支节点。

### 节点名称

```text
Priority Router
```

### 作用

判断是否命中高优先级安全事件。

### 可复制代码逻辑

```js
async function main({
  event_type,
  car_speed,
  passenger_states,
  game_status
}) {
  const states = passenger_states || {};
  const hasSleepingPassenger = Object.values(states).includes("睡着");

  if (event_type === "hard_brake") {
    return {
      priority: "P0",
      priority_reason: "检测到急刹，安全优先",
      forced_strategy_id: "S01",
      allow_passenger_action: false,
      skip_game_judge: true
    };
  }

  if (Number(car_speed || 0) >= 100) {
    return {
      priority: "P1",
      priority_reason: "车速达到 100km/h 以上，主驾需要降频",
      forced_strategy_id: "S02",
      allow_passenger_action: true,
      skip_game_judge: false
    };
  }

  if (event_type === "driver_tired") {
    return {
      priority: "P1",
      priority_reason: "检测到主驾疲惫",
      forced_strategy_id: "S03",
      allow_passenger_action: true,
      skip_game_judge: false
    };
  }

  if (hasSleepingPassenger || event_type === "passenger_sleep") {
    return {
      priority: "P2",
      priority_reason: "检测到乘客睡着，需要降低打扰",
      forced_strategy_id: "S04",
      allow_passenger_action: true,
      skip_game_judge: false
    };
  }

  return {
    priority: "P3",
    priority_reason: "普通游戏事件",
    forced_strategy_id: null,
    allow_passenger_action: true,
    skip_game_judge: false
  };
}
```

## 4. Strategy Match 节点

### 推荐类型

代码节点。

### 节点名称

```text
Strategy Match
```

### 作用

根据 know-how 策略表选择当前策略。

### 可复制代码逻辑

```js
async function main({
  forced_strategy_id,
  event_type,
  environment,
  question_count,
  priority,
  relationship
}) {
  let strategy_id = forced_strategy_id || "S00";

  if (!forced_strategy_id) {
    if (event_type === "near_destination") {
      strategy_id = "S09";
    } else if ((environment || "").includes("雨天")) {
      strategy_id = "S07";
    } else if (Number(question_count || 0) >= 8) {
      strategy_id = "S18";
    } else {
      strategy_id = "S00";
    }
  }

  const strategies = {
    S00: {
      strategy_name: "普通游戏主持",
      decision_goal: "正常推进猜谜游戏",
      host_tone: "自然、清晰、有一点趣味",
      cabin_mode: "normal",
      animation: "answer",
      host_emotion: "thinking"
    },
    S01: {
      strategy_name: "急刹打断",
      decision_goal: "安全优先，立即暂停游戏",
      host_tone: "温柔但坚定，短句，不开玩笑",
      cabin_mode: "safety_pause",
      animation: "pause",
      host_emotion: "serious"
    },
    S02: {
      strategy_name: "高速主驾降频",
      decision_goal: "降低主驾分心风险",
      host_tone: "清晰、照顾、不制造压力",
      cabin_mode: "driver_focus",
      animation: "cue",
      host_emotion: "care"
    },
    S03: {
      strategy_name: "主驾疲惫",
      decision_goal: "提醒主驾、降低互动压力",
      host_tone: "关心、轻声、不过度指责",
      cabin_mode: "driver_focus",
      animation: "cue",
      host_emotion: "care"
    },
    S04: {
      strategy_name: "有人睡着",
      decision_goal: "避免打扰睡着乘客",
      host_tone: "轻柔、体贴",
      cabin_mode: "soft",
      animation: "soft",
      host_emotion: "care"
    },
    S07: {
      strategy_name: "雨天环境入题",
      decision_goal: "将车外天气融入游戏",
      host_tone: "应景、自然、有观察感",
      cabin_mode: "environment_sync",
      animation: "scene_change",
      host_emotion: "observing"
    },
    S09: {
      strategy_name: "快到目的地绝杀局",
      decision_goal: "收束游戏节奏，制造临门一脚",
      host_tone: "兴奋、仪式感、带一点玩笑",
      cabin_mode: "final_round",
      animation: "final",
      host_emotion: "excited"
    },
    S14: {
      strategy_name: "小朋友答对",
      decision_goal: "强化成就感，制造高光时刻",
      host_tone: "兴奋、鼓励、有仪式感",
      cabin_mode: "victory",
      animation: "victory",
      host_emotion: "excited"
    },
    S18: {
      strategy_name: "多轮无进展给提示",
      decision_goal: "降低挫败感，推动游戏继续",
      host_tone: "自嘲、鼓励、降低压力",
      cabin_mode: "normal",
      animation: "cue",
      host_emotion: "care"
    }
  };

  return {
    strategy_id,
    priority,
    ...(strategies[strategy_id] || strategies.S00),
    relationship
  };
}
```

## 5. Game Judge 节点

### 推荐类型

大模型节点。

### 节点名称

```text
Game Judge
```

### 作用

判断玩家输入是问题还是猜答案，以及是否答对。

### 输入变量

- `player_input`
- `current_answer`
- `current_theme`
- `hint`
- `question_count`
- `asked_questions`
- `trigger_type`
- `skip_game_judge`

### 可复制 Prompt

```text
你是一个猜谜游戏裁判。请根据玩家输入和当前谜底，判断玩家是在问问题、猜答案、开玩笑还是无效输入。

当前谜底：{{current_answer}}
谜题主题：{{current_theme}}
辅助提示：{{hint}}
玩家输入：{{player_input}}
已提问次数：{{question_count}}
已问过的问题：{{asked_questions}}
触发类型：{{trigger_type}}

判断规则：
1. 如果玩家输入直接包含谜底，is_correct=true，input_type="guess"。
2. 如果玩家输入是在询问属性、类别、场景，input_type="question"。
3. 如果玩家输入接近谜底但没有完全命中，is_near_answer=true。
4. 不要因为语义相近就轻易判定正确，除非它明确等同于谜底。
5. 如果触发类型不是 chat，且没有玩家输入，input_type="none"。
6. 输出必须是 JSON，不要输出解释文本。

输出 JSON 格式：
{
  "input_type": "question/guess/joke/invalid/none",
  "is_valid_question": true,
  "is_guess": false,
  "is_correct": false,
  "is_near_answer": false,
  "should_reveal_answer": false,
  "answer_polarity": "yes/no/uncertain",
  "game_judge_reason": "一句话说明判断理由"
}
```

### 输出示例

```json
{
  "input_type": "question",
  "is_valid_question": true,
  "is_guess": false,
  "is_correct": false,
  "is_near_answer": true,
  "should_reveal_answer": false,
  "answer_polarity": "yes",
  "game_judge_reason": "安全带确实能保护乘客"
}
```

## 6. Passenger Action Planner 节点

### 推荐类型

大模型节点。

### 节点名称

```text
Passenger Action Planner
```

### 作用

决定是否生成一个模拟乘客动作。

### 输入变量

- `trigger_type`
- `event_type`
- `game_status`
- `priority`
- `allow_passenger_action`
- `passenger_states`
- `passenger_personas`
- `user_seat`
- `selected_seat`
- `asked_questions`
- `question_count`
- `current_answer`
- `relationship`
- `strategy_id`

### 可复制 Prompt

```text
你是智能座舱游戏导演，负责决定是否让一个模拟乘客参与猜谜。

当前触发类型：{{trigger_type}}
当前事件：{{event_type}}
游戏状态：{{game_status}}
优先级：{{priority}}
是否允许模拟乘客：{{allow_passenger_action}}
用户座位：{{user_seat}}
当前座位状态：{{passenger_states}}
乘客人设：{{passenger_personas}}
乘客关系：{{relationship}}
已问过的问题：{{asked_questions}}
已提问次数：{{question_count}}
当前谜底：{{current_answer}}
当前策略：{{strategy_id}}

规则：
1. 如果 game_status 是 paused，必须返回 passenger_action=null。
2. 如果 priority 是 P0，必须返回 passenger_action=null。
3. 如果 allow_passenger_action=false，必须返回 passenger_action=null。
4. 不要选择 user_seat。
5. 不要选择状态为“睡着”的乘客。
6. 车速高或主驾专注策略下，不要选择主驾。
7. 不要重复 asked_questions 中已经问过的问题。
8. 前 3 问不要直接猜中，除非策略明确要求绝杀或接近答案。
9. 每次最多生成一个 passenger_action。
10. 发言要短，像车里随口问的一句话。

如果适合生成，输出：
{
  "passenger_action": {
    "seat": "rearRight",
    "text": "它是不是车里能保护我们的东西？",
    "mood": "普通",
    "intent": "ask_attribute"
  },
  "passenger_action_reason": "一句话说明原因"
}

如果不适合生成，输出：
{
  "passenger_action": null,
  "passenger_action_reason": "一句话说明原因"
}

只输出 JSON。
```

## 7. Host Reply Generator 节点

### 推荐类型

大模型节点。

### 节点名称

```text
Host Reply Generator
```

### 作用

根据策略、游戏判断和模拟乘客动作生成 AI 主持人话术。

### 输入变量

- `strategy_id`
- `strategy_name`
- `decision_goal`
- `host_tone`
- `game_judge`
- `passenger_action`
- `current_answer`
- `relationship`
- `selected_seat_label`
- `player_input`
- `environment`
- `destination`

### 可复制 Prompt

```text
你是智能座舱里的 AI 猜谜主持人。你要根据座舱状态、游戏状态、当前策略和乘客输入，生成一句自然、有眼力见、有情绪价值的主持话术。

当前策略ID：{{strategy_id}}
策略名称：{{strategy_name}}
决策目标：{{decision_goal}}
话术风格：{{host_tone}}
游戏判断：{{game_judge}}
模拟乘客动作：{{passenger_action}}
当前谜底：{{current_answer}}
乘客关系：{{relationship}}
当前真实用户座位：{{selected_seat_label}}
用户输入：{{player_input}}
车外环境：{{environment}}
目的地：{{destination}}

话术要求：
1. 适合车内播报，尽量短，不超过 60 字。
2. 安全相关事件必须温柔但坚定，不开玩笑。
3. 高速或主驾疲惫时，减少主驾互动压力。
4. 有人睡着时，话术要轻柔，不 cue 睡着的人。
5. 小朋友答对时，要给明确称号和成就感。
6. 长辈答对时，要给尊重感。
7. 年轻朋友场景可以更活泼，但不要过度。
8. 不要泄露谜底，除非 is_correct=true 或 show_answer=true。
9. 如果 passenger_action 存在，优先回应模拟乘客的问题。
10. 只输出 JSON，不要解释。

输出格式：
{
  "ai_reply_text": "这里是一句主持人话术"
}
```

## 8. UI Change Composer 节点

### 推荐类型

代码节点。

### 节点名称

```text
UI Change Composer
```

### 作用

把策略和游戏判断转换为前端 UI 指令。

### 可复制代码逻辑

```js
async function main({
  strategy_id,
  cabin_mode,
  animation,
  host_emotion,
  selected_seat,
  passenger_action,
  game_judge,
  current_answer
}) {
  const judge = typeof game_judge === "string" ? JSON.parse(game_judge) : (game_judge || {});
  const action = typeof passenger_action === "string" ? JSON.parse(passenger_action) : passenger_action;

  let game_status = "playing";
  let show_answer = false;
  let is_correct = Boolean(judge.is_correct);

  if (strategy_id === "S01") {
    game_status = "paused";
  }

  if (is_correct) {
    game_status = "victory";
    show_answer = true;
  }

  const targetSeat =
    action?.passenger_action?.seat ||
    action?.seat ||
    selected_seat ||
    "all";

  return {
    game_status,
    is_correct,
    answer: current_answer || "",
    ui_change: {
      cabin_mode: is_correct ? "victory" : (cabin_mode || "normal"),
      target_seat: targetSeat,
      host_emotion: is_correct ? "excited" : (host_emotion || "normal"),
      animation: is_correct ? "victory" : (animation || "speak"),
      show_answer
    }
  };
}
```

## 9. JSON Formatter 节点

### 推荐类型

代码节点或模板节点。

### 节点名称

```text
JSON Formatter
```

### 作用

组装最终输出。

### 可复制代码逻辑

```js
async function main({
  passenger_action_result,
  host_reply,
  game_status,
  is_correct,
  answer,
  ui_change,
  strategy_id,
  priority,
  priority_reason
}) {
  const parsedPassenger =
    typeof passenger_action_result === "string"
      ? JSON.parse(passenger_action_result)
      : (passenger_action_result || {});

  const parsedHost =
    typeof host_reply === "string"
      ? JSON.parse(host_reply)
      : (host_reply || {});

  const passengerAction = parsedPassenger.passenger_action || null;
  const aiReplyText = parsedHost.ai_reply_text || "收到，我们继续。";

  const finalOutput = {
    passenger_action: game_status === "paused" ? null : passengerAction,
    ai_reply_text: aiReplyText,
    game_status: game_status || "playing",
    is_correct: Boolean(is_correct),
    answer: answer || "",
    ui_change: ui_change || {
      cabin_mode: "normal",
      target_seat: "all",
      host_emotion: "normal",
      animation: "speak",
      show_answer: false
    },
    debug: {
      strategy_id,
      priority,
      reason: priority_reason
    }
  };

  if (finalOutput.is_correct) {
    finalOutput.game_status = "victory";
    finalOutput.ui_change.show_answer = true;
    finalOutput.ui_change.cabin_mode = "victory";
    finalOutput.ui_change.animation = "victory";
  }

  return {
    workflow_output: JSON.stringify(finalOutput)
  };
}
```

## 10. End 节点

### 输出字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `workflow_output` | string | 最终 JSON 字符串 |

前端收到后解析 `workflow_output`。

## 前端动作映射

| 前端动作 | trigger_type | event.type | player_input | passenger_action |
| --- | --- | --- | --- | --- |
| AI 开场 | `event` | `start_game` | 空 | 否 |
| 用户提问 | `chat` | null | 用户文本 | 否 |
| 用户猜答案 | `chat` | null | 用户文本 | 否 |
| 请求模拟乘客 | `simulation` | `request_passenger_action` | 空 | 是 |
| 急刹 | `event` | `hard_brake` | 空 | 否 |
| 恢复游戏 | `event` | `resume_game` | 空 | 否 |
| 主驾疲惫 | `event` | `driver_tired` | 空 | 通常否 |
| 有人睡着 | `event` | `passenger_sleep` | 空 | 否 |
| 快到目的地 | `event` | `near_destination` | 空 | 可选 |
| 时间轴环境变化 | `event` | `environment_change` | 空 | 可选 |
| 时间轴车速变化 | `event` | `speed_change` | 空 | 可选 |

## 前端调用格式

```js
async function callCozeWorkflow(payload) {
  const response = await fetch(COZE_WORKFLOW_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input_payload: JSON.stringify(payload)
    })
  });

  const result = await response.json();
  return normalizeCozeOutput(result);
}
```

## 前端应用输出顺序

```text
1. 解析 workflow_output
2. 如果 passenger_action 存在，显示对应乘客气泡
3. 车内互动区追加模拟乘客消息
4. 显示 ai_reply_text
5. 更新 game_status
6. 应用 ui_change
7. 如果 show_answer=true，揭晓谜底
8. 如果 is_correct=true，点亮答对座位氛围灯并播放答对音效
```

## 测试 Payload 1：AI 开场

```json
{
  "trigger_type": "event",
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
  "game": {
    "status": "opening",
    "question_count": 0,
    "max_questions": 15,
    "current_answer": "安全带",
    "current_theme": "高速",
    "hint": "它平时很安静，但关键时刻比主持人还可靠。",
    "asked_questions": []
  },
  "interaction": {
    "current_speaker": "front",
    "user_seat": "front",
    "recent_messages": []
  },
  "player_input": "",
  "event": {
    "type": "start_game",
    "source": "manual"
  }
}
```

## 测试 Payload 2：用户提问

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
  "game": {
    "status": "playing",
    "question_count": 1,
    "max_questions": 15,
    "current_answer": "安全带",
    "current_theme": "高速",
    "hint": "它平时很安静，但关键时刻比主持人还可靠。",
    "asked_questions": []
  },
  "interaction": {
    "current_speaker": "front",
    "user_seat": "front",
    "recent_messages": []
  },
  "player_input": "它是车上的东西吗？",
  "event": null
}
```

## 测试 Payload 3：模拟乘客请求

```json
{
  "trigger_type": "simulation",
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
    },
    "personas": {
      "rear_right": {
        "name": "后排小朋友",
        "persona": "好奇、兴奋、喜欢动画和食物",
        "style": "短句、直接、偶尔抢答",
        "can_guess": true
      }
    }
  },
  "game": {
    "status": "playing",
    "question_count": 2,
    "max_questions": 15,
    "current_answer": "安全带",
    "current_theme": "高速",
    "hint": "它平时很安静，但关键时刻比主持人还可靠。",
    "asked_questions": ["它是车上的东西吗？"]
  },
  "interaction": {
    "current_speaker": "rearRight",
    "user_seat": "front",
    "simulation_request": {
      "enabled": true,
      "exclude_seats": ["front", "driver"],
      "reason": "轮到模拟乘客参与"
    },
    "recent_messages": []
  },
  "player_input": "",
  "event": {
    "type": "request_passenger_action",
    "source": "timeline"
  }
}
```

## 测试 Payload 4：急刹

```json
{
  "trigger_type": "event",
  "plugin_id": "riddle",
  "car": {
    "speed": 100,
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
    "elapsed_seconds": 45,
    "current_event": {
      "type": "hard_brake",
      "description": "车辆急刹"
    }
  },
  "game": {
    "status": "playing",
    "question_count": 3,
    "max_questions": 15,
    "current_answer": "安全带",
    "current_theme": "高速",
    "asked_questions": []
  },
  "interaction": {
    "current_speaker": "front",
    "user_seat": "front",
    "recent_messages": []
  },
  "player_input": "",
  "event": {
    "type": "hard_brake",
    "source": "timeline",
    "priority": "P0"
  }
}
```

## V1.1 搭建顺序

建议你在 Coze 里按这个顺序搭，别一口气全搭完：

1. 创建 Workflow，配置 Start 入参 `input_payload`
2. 搭 `Input Normalize`
3. 搭 `JSON Formatter` 和 `End`，先返回固定 JSON
4. 用测试 Payload 1 跑通
5. 加 `Priority Router`
6. 跑通急刹 `S01`
7. 加 `Game Judge`
8. 跑通用户提问
9. 加 `Passenger Action Planner`
10. 跑通模拟乘客
11. 加 `Host Reply Generator`
12. 加 `UI Change Composer`
13. 用四个测试 Payload 回归

## V1.1 最小验收

做到以下几点就可以接前端：

- AI 开场能返回合法 JSON
- 用户提问能返回主持人回答
- 急刹能返回 `game_status = paused`
- 急刹时 `passenger_action = null`
- 模拟乘客请求能返回单个 `passenger_action`
- 答对时 `is_correct = true`
- 答对时 `ui_change.show_answer = true`
