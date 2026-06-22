# Coze Workflow V1.2 快速路径优化包

## 优化目标

当前实测 Coze Workflow 响应约为 `6-9s`。现有设计把普通请求依次交给：

```text
Game Judge -> Passenger Action Planner -> Host Reply Generator
```

三个大模型节点串行执行是主要延迟来源。V1.2 建议改成：

```text
Start
-> Input Normalize（代码）
-> Fast Route（代码）
   -> deterministic：Fast Template（代码，零模型）
   -> llm：Fast Director（单个大模型）
-> Output Guard（代码）
-> End
```

预期效果：

- 开局、安全事件、精确猜中：不调用大模型，接近即时返回。
- 普通问题：由 3 次串行模型调用降为 1 次。
- `is_correct=true` 时不再生成 `passenger_action`。
- 真实用户固定称为“副驾”，禁止出现“副驾的朋友”。

## 一、保留与删除的节点

保留：

- `Start`
- `Input Normalize`
- `Priority Router` 中必要的规则逻辑，可并入 `Fast Route`
- `End`

停用或绕过：

- 独立 `Context Summary` 大模型节点
- 独立 `Game Judge` 大模型节点
- 独立 `Passenger Action Planner` 大模型节点
- 独立 `Host Reply Generator` 大模型节点
- 大模型 JSON 修复节点

## 二、Fast Route 代码节点

### 输入

- `payload`：Input Normalize 输出的完整对象

### 输出

- `route`：`deterministic` 或 `llm`
- `fast_result`：确定性路径的最终结构化结果
- `director_input`：Fast Director 的精简输入

### 可复制代码

```js
async function main({ payload }) {
  const input = typeof payload === "string" ? JSON.parse(payload) : (payload || {});
  const eventType = input.event?.type || input.timeline?.current_event?.type || "";
  const triggerType = input.trigger_type || "event";
  const game = input.game || {};
  const answer = String(game.current_answer || "").trim();
  const playerInput = String(input.player_input || "").trim();
  const speaker = input.passengers?.selected_seat || "front";
  const speakerLabel = input.passengers?.selected_seat_label || "副驾";

  const normalize = (value) => String(value || "")
    .toLowerCase()
    .replace(/[\s，。！？、,.!?“”"'：:；;（）()]/g, "");

  const normalizedInput = normalize(playerInput);
  const normalizedAnswer = normalize(answer);
  const exactCorrect = Boolean(
    normalizedAnswer &&
    (normalizedInput === normalizedAnswer ||
      normalizedInput === `答案是${normalizedAnswer}` ||
      normalizedInput === `我猜${normalizedAnswer}` ||
      normalizedInput.endsWith(`是${normalizedAnswer}`))
  );

  const baseUI = {
    cabin_mode: "normal",
    target_seat: speaker,
    host_emotion: "normal",
    animation: "speak",
    show_answer: false
  };

  if (exactCorrect) {
    return {
      route: "deterministic",
      fast_result: {
        passenger_action: null,
        ai_reply_text: `${speakerLabel}答对了！谜底就是“${answer}”，这一问拿下得很漂亮。`,
        game_status: "victory",
        is_correct: true,
        answer,
        ui_change: {
          ...baseUI,
          cabin_mode: "victory",
          target_seat: speaker,
          host_emotion: "excited",
          animation: "victory",
          show_answer: true
        },
        decision_trace: {
          perception: `${speakerLabel}猜中谜底`,
          decision: "进入胜利收尾并强化答对者成就感",
          execution: "揭晓谜底，点亮答对座位氛围灯",
          strategy_id: "S14",
          priority: "P3"
        }
      },
      director_input: null
    };
  }

  const templates = {
    start_game: {
      text: `各位侦探，谜底已经藏好了。大家轮流问是或否的问题，15问内猜出来就算赢。`,
      status: "playing",
      mode: "normal",
      emotion: "confident",
      animation: "speak",
      strategy: "S00",
      perception: "乘客开始一局15问猜谜",
      decision: "用简短规则开场并邀请全车参与",
      execution: "AI主持开局，隐藏谜底"
    },
    hard_brake: {
      text: "大家坐稳，游戏先暂停，安全第一。",
      status: "paused",
      mode: "safety_pause",
      emotion: "serious",
      animation: "pause",
      strategy: "S01",
      priority: "P0",
      perception: "检测到急刹",
      decision: "安全优先，立即暂停游戏",
      execution: "停止乘客发言并切换安全提醒"
    },
    driver_tired: {
      text: "主驾先专心看路，接下来的问题交给副驾和后排。",
      status: game.status === "idle" ? "idle" : "playing",
      mode: "driver_focus",
      emotion: "care",
      animation: "cue",
      strategy: "S03",
      priority: "P1",
      perception: "检测到主驾疲惫",
      decision: "降低主驾互动频率",
      execution: "副驾和后排接管提问"
    },
    passenger_sleep: {
      text: "后排有人睡着了，我们把声音放轻一点，先不打扰TA。",
      status: game.status || "playing",
      mode: "soft",
      emotion: "care",
      animation: "soft",
      strategy: "S04",
      priority: "P2",
      perception: "检测到后排乘客睡着",
      decision: "轻声继续并排除睡着乘客",
      execution: "切换轻声互动模式"
    },
    near_destination: {
      text: "前方快到目的地了，我们进入最后冲刺。",
      status: game.status === "idle" ? "playing" : (game.status || "playing"),
      mode: "final_round",
      emotion: "excited",
      animation: "final",
      strategy: "S09",
      priority: "P2",
      perception: "检测到即将到达目的地",
      decision: "收束游戏节奏",
      execution: "进入最后冲刺"
    }
  };

  if (templates[eventType]) {
    const item = templates[eventType];
    return {
      route: "deterministic",
      fast_result: {
        passenger_action: null,
        ai_reply_text: item.text,
        game_status: item.status,
        is_correct: false,
        answer,
        ui_change: {
          ...baseUI,
          cabin_mode: item.mode,
          host_emotion: item.emotion,
          animation: item.animation
        },
        decision_trace: {
          perception: item.perception,
          decision: item.decision,
          execution: item.execution,
          strategy_id: item.strategy,
          priority: item.priority || "P3"
        }
      },
      director_input: null
    };
  }

  const allowPassengerAction = Boolean(
    triggerType === "simulation" || eventType === "request_passenger_action"
  );

  return {
    route: "llm",
    fast_result: null,
    director_input: {
      trigger_type: triggerType,
      event_type: eventType,
      environment: input.car?.environment || "未知",
      destination: input.car?.destination || "未知",
      speed: Number(input.car?.speed || 0),
      relationship: input.passengers?.relationship || "未知",
      speaker,
      speaker_label: speakerLabel,
      passenger_states: input.passengers?.states || {},
      game_status: game.status || "playing",
      question_count: Number(game.question_count || 0),
      max_questions: Number(game.max_questions || 15),
      answer,
      theme: game.current_theme || "",
      hint: game.hint || "",
      player_input: playerInput,
      recent_messages: (input.interaction?.recent_messages || []).slice(-4),
      allow_passenger_action: allowPassengerAction
    }
  };
}
```

## 三、Fast Director 单模型节点

### 模型设置

- 使用低延迟模型。
- Temperature：`0.4-0.6`。
- 最大输出：`300 tokens` 以内。
- 开启结构化 JSON 输出，不增加第二个大模型 JSON 修复节点。

### 输入

- `director_input`

### 可复制 Prompt

```text
你是智能座舱15问猜谜的快速导演。一次完成：判断玩家问题、生成AI主持人回复、按需生成一个模拟乘客动作。

输入：{{director_input}}

硬规则：
1. 当前真实用户固定为 speaker=front，称呼必须使用 speaker_label 的原文，通常是“副驾”。
2. 禁止说“副驾的朋友”“这位朋友”“用户”，直接称呼“副驾”。
3. passenger_action 只能在 allow_passenger_action=true 时生成，否则必须为 null。
4. passenger_action.seat 只能是 rearLeft 或 rearRight，禁止 front 和 driver。
5. is_correct=true、game_status=paused 或安全事件时，passenger_action 必须为 null。
6. 睡着乘客不得发言。
7. 普通是/否问题只回答“是/不是/不完全是”并补一句简短推进，不泄露谜底。
8. 只有玩家明确猜答案且语义等于 answer 时，is_correct=true。
9. 主持人话术不超过55个汉字，适合车内口播。
10. 不输出解释，不使用Markdown，只输出一个JSON对象。

输出格式：
{
  "passenger_action": null,
  "ai_reply_text": "一句主持话术",
  "game_status": "playing",
  "is_correct": false,
  "answer": "原样返回输入answer",
  "ui_change": {
    "cabin_mode": "normal",
    "target_seat": "front",
    "host_emotion": "thinking",
    "animation": "answer",
    "show_answer": false
  },
  "decision_trace": {
    "perception": "一句关键感知",
    "decision": "一句决策",
    "execution": "一句执行",
    "strategy_id": "S00",
    "priority": "P3"
  }
}
```

## 四、Output Guard 代码节点

### 输入

- `route`
- `fast_result`
- `director_result`
- `director_input`

### 可复制代码

```js
async function main({ route, fast_result, director_result, director_input }) {
  const parse = (value) => {
    if (!value) return null;
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return null; }
  };

  const source = route === "deterministic"
    ? parse(fast_result)
    : parse(director_result);

  const input = parse(director_input) || director_input || {};
  const answer = String(source?.answer || input.answer || "");
  const isCorrect = Boolean(source?.is_correct || source?.game_status === "victory");
  const speaker = input.speaker || "front";

  let passengerAction = source?.passenger_action || null;
  if (
    isCorrect ||
    input.allow_passenger_action !== true ||
    !["rearLeft", "rearRight", "rear_left", "rear_right"].includes(passengerAction?.seat)
  ) {
    passengerAction = null;
  }

  const fallbackText = isCorrect
    ? `副驾答对了！谜底就是“${answer}”。`
    : "这个问题很有价值，我们继续缩小范围。";

  const result = {
    passenger_action: passengerAction,
    ai_reply_text: String(source?.ai_reply_text || fallbackText)
      .replace(/副驾的朋友/g, "副驾")
      .replace(/这位副驾朋友/g, "副驾"),
    game_status: isCorrect ? "victory" : (source?.game_status || "playing"),
    is_correct: isCorrect,
    answer,
    ui_change: {
      cabin_mode: isCorrect ? "victory" : (source?.ui_change?.cabin_mode || "normal"),
      target_seat: isCorrect ? speaker : (source?.ui_change?.target_seat || speaker),
      host_emotion: isCorrect ? "excited" : (source?.ui_change?.host_emotion || "normal"),
      animation: isCorrect ? "victory" : (source?.ui_change?.animation || "speak"),
      show_answer: isCorrect || Boolean(source?.ui_change?.show_answer)
    },
    decision_trace: source?.decision_trace || {
      perception: "收到玩家问题",
      decision: "判断问题并推进猜谜",
      execution: "AI主持人回答",
      strategy_id: "S00",
      priority: "P3"
    }
  };

  return {
    workflow_output: JSON.stringify(result)
  };
}
```

## 五、扣子画布连接方式

```text
Start -> Input Normalize -> Fast Route

Fast Route.route == deterministic
  -> Output Guard.fast_result

Fast Route.route == llm
  -> Fast Director -> Output Guard.director_result

Output Guard -> End
```

### 融合决策升级路径

当前快速路径部署并稳定后，在不增加第二个大模型节点的前提下扩展为：

```text
Start -> Input Normalize -> Cabin State Summary -> Safety Gate

Safety Gate 命中确定性事件
  -> Deterministic Result -> Output Guard

Safety Gate 未命中
  -> Strategy Selector
  -> Know-how Resolver
  -> Fast Director
  -> Output Guard
```

- `Cabin State Summary`、`Safety Gate`、`Strategy Selector` 均优先使用代码节点。
- `Know-how Resolver` 第一阶段使用代码映射，只返回 2-3 条相关经验；案例规模扩大后再接知识库。
- `Fast Director` 仍是唯一大模型节点，不接收完整 Know-how 文档。
- 运行时最小感知范围以 [WORKFLOW_CONTRACT.md](./WORKFLOW_CONTRACT.md) 的 `perception` 为准。

## 六、必须删除的旧行为

- 不要让普通 `chat` 每次都进入 Passenger Action Planner。
- 不要在 `is_correct=true` 时生成模拟乘客动作。
- UI `target_seat` 在胜利时必须优先使用真实发言者，不得优先使用 passenger_action.seat。
- 主持人 Prompt 不得用“朋友”泛称真实用户。
- 不使用独立大模型节点做 Context Summary 和 JSON Repair。

## 七、验收指标

优化后重新测试三类请求，每类连续执行 3 次：

| 请求 | 目标 |
| --- | --- |
| `start_game` | P50 < 1.5s |
| 精确猜中 | P50 < 1.5s |
| 普通问题 | P50 < 4s，P95 < 6s |

功能验收：

- 猜对话术直接称呼“副驾”。
- 猜对时 `passenger_action=null`。
- 猜对时 `ui_change.target_seat=front`。
- 普通 chat 默认不生成模拟乘客；只有 simulation/显式请求才生成。
- `decision_trace` 始终存在。
