# Workflow 接口契约

2026-10-18新增受限应景开场操作`route=chat, operation=environment_round_intro`：仅`round_changed / environment_riddle / P3`且第2题起、问题数0、无玩家输入、主题匹配环境时允许。BFF构造服务器规则指导，复用Chatflow已有事件校验，不调用情境Workflow、不写情境缓存，不替代或放宽普通情境的签名交接。前端只应用有效短话术，设备/事实/答对与游戏状态均不执行；每题一次、P3和6秒开题窗口，问答先到则取消。详见 [应景开场](ENVIRONMENT_AWARE_RIDDLES.md)。

2026-10-18多事件调度见 [HOST_EVENT_QUEUE.md](HOST_EVENT_QUEUE.md)：前端按优先级与同级FIFO保留事件，不再按全局状态变化一律丢弃；轮到生成时快照版本变化，必须重新获取分析及签名交接，不篡改旧凭据或放宽服务端校验。P0之后只重发仍有效事件，不复用旧模型结果。BFF/Dify协议本次未改。

2026-10-18当前增量见 [座舱情境协同规则](CABIN_SCENARIO_POLICY.md)：普通对话允许背景音乐和明确分区灯光；求助仅复述 `game.public_clues`，不增加事实；有效入睡必须启用关怀，分区关灯、音量0、空调调至用户记忆值，醒来随话术恢复原设置。新增 `temporary_interruption` 本地暂停4.5秒、后台仅记录，`driver_distracted` 为P1安全提醒并显示明确的分心感知。不考虑导航打断。以下旧版“提示一律婉拒”“自主选择睡眠关怀/关闭空调”和“仅音乐动作”由此替代。

2026-10-17最新协议见 [情境串行路由](SITUATION_DIALOGUE_ROUTING.md)：重要事件先以`route=situation`分析，前端再以`route=chat, operation=situation_reply`及签名交接凭据请求主持人话术。P0不接续Chatflow；P1规则分析零模型零检索。以下较早“环境本地P1”说明不再适用于当前版本。

> 当前使用 [Dify双路并行v4契约](DIFY_PARALLEL_HOST.md)：对话Answer为自然语言，结构化结果通过结果节点输出；情境分析使用独立Workflow，同源BFF已适配。2026-10-17环境快速分支已发布，前端/BFF增量尚未部署Vercel；本文较早Coze字段保留为历史参考。
>
> 跨子对话的最新云端发布 hash、未确认项和安全更新步骤见 [Dify 当前状态与子对话交接](DIFY_CURRENT_STATE.md)。

## 目标

2026-10-17主持经验v2增量：聊天与情境输入增加真实统计`performance`和同源持久化偏好`host_preferences`。成就反馈使用P4事件`post_result_feedback`、来源`performance_monitor`及顶层`host_feedback`，走独立情境分支。前端核对反馈ID、局、题、环境版本、有效期和守卫状态后排队，不应用其游戏状态或动作；BFF不缓存该反馈为后续聊天情境。P0本地揭晓优先。字段与触发边界见[主持经验库v2](HOST_EXPERIENCES_V2.md)。

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
  "perception": {},
  "round_question_plan_request": null,
  "timeline": {},
  "game": {},
  "interaction": {},
  "player_seat": "副驾",
  "player_input": "它是车上的东西吗？",
  "event": null
}
```

## round_question_plan_request

前端在独立 `route=preview` 请求中携带此字段，沿用 `event.type=start_game`、`event.source=question_preview`。这是目标题的预演请求，不等于当前 UI 正在开场：准备页请求首题，进入第 N 题请求第 N+1 题，结算页请求下一局首题。一次预演生成一整条提问链，实际开场复用缓存，不再等待或重复请求。

预演输入的 `game_id/round_id`、谜底、主题、题号及自动事件模板必须对应目标题，提问次数为 0，已问问题、已覆盖事实及近期对话为空。下一局首题提前保留新 `game_id`，继续挑战时使用同一标识。响应须回显本次请求的局、题、状态版本及事件 ID；缓存只向匹配的目标题供给问题，不直接执行预演中的主持人话术或其他状态。

```json
{
  "enabled": true,
  "step_count": 5,
  "reasoning_stages": [
    "category",
    "location",
    "function",
    "feature",
    "near_answer"
  ],
  "persona_age_groups": ["adult", "child"],
  "generate_question_variants": true,
  "generate_host_replies": true,
  "passenger_slots": [
    {
      "slot": 1,
      "delay_ms": 7000,
      "label": "模拟乘客提出第一问"
    }
  ],
  "rules": [
    "问题之间必须形成逐步缩小范围的逻辑链",
    "每个问题必须可以用是或否回答",
    "不要在前两个步骤直接说出或猜中谜底",
    "为不同年龄人群提供自然的措辞变体",
    "每一步同时生成可即时播放的主持人回答"
  ]
}
```

前端会根据当前单题黄金时间轴的乘客发言槽位决定 `step_count`，并额外请求少量备用步骤。具体发言座位不写入计划，由前端在 `driver`、`rearLeft`、`rearRight` 中临时选择；`front` 始终留给真实用户。

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
  "selected_persona": {
    "name": "副驾真实用户",
    "role": "家长",
    "age_group": "adult",
    "is_real_user": true
  },
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

### selected_persona

当前发言座位对应的人设快照。前端在真实用户提问和时间轴模拟乘客提问时都会填写，Workflow 不需要再根据座位猜测对方是小朋友、年轻人还是长辈。

常用字段：

- `name`
- `role`
- `age_group`
- `persona`
- `style`
- `can_guess`
- `is_real_user`

### user_seat

真实用户扮演的座位。当前前端固定为 `front` / `副驾`，不提供座位下拉选择。其他座位可由模拟乘客系统参与。

### states

每个座位当前情绪。

支持：

- `普通`
- `大笑`
- `沉默`
- `睡着`

### personas

模拟乘客人设信息。Workflow 可根据人设决定是否发言、如何发言、是否猜答案。

## perception

V1.2 的收敛后感知状态。这里传递的是时间轴或前端状态中心已经标准化的语义结果，不传摄像头、麦克风等原始数据。

```json
{
  "vehicle_state": "normal",
  "driver_state": "normal",
  "sleeping_seats": ["rearLeft"],
  "inactive_seat": "rearRight",
  "cabin_mood": "normal",
  "game_progress": "stuck",
  "environment_hook": "城区雨天白天"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `vehicle_state` | string | 否 | `normal` / `high_speed` / `hard_brake` |
| `driver_state` | string | 否 | `normal` / `fatigued` |
| `sleeping_seats` | array | 否 | 当前睡着的座位；这些座位不得被 cue 或生成发言 |
| `inactive_seat` | string/null | 否 | 当前最需要照顾参与感的一个座位 |
| `cabin_mood` | string | 否 | `normal` / `laughing`；第一版为可选增强 |
| `game_progress` | string | 否 | `normal` / `stuck` / `near_answer` / `correct` |
| `environment_hook` | string | 否 | 可自然融入主持话术的当前环境 |

约束：

- 每次请求发送当前完整感知快照，而不是只发送变化字段。
- `hard_brake` 仍同时使用 `event.type=hard_brake` 触发 P0 确定性路径。
- `inactive_seat` 由近期发言轮次推导，第一版一次只标记一个座位。
- 乘客关系、年龄和目的地由黄金体验线预设，不在 `perception` 中重复表达。
- 暂不扩展电话、冲突、长期记忆、声纹和精细情绪字段。

## timeline

时间轴状态。

```json
{
  "id": "family_highway_disney",
  "name": "高速亲子出行",
  "round_timeline_id": "round_collaborative",
  "round_timeline_name": "轮流破题",
  "round_index": 2,
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
| `round_timeline_id` | string | 否 | 本题随机抽中的单题时间轴 ID |
| `round_timeline_name` | string | 否 | 本题随机抽中的单题时间轴名称 |
| `round_index` | number | 否 | 单题时间轴对应的题号 |
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
  "progress": "normal",
  "asked_questions": [
    "它是车上的东西吗？",
    "它能保护我们吗？"
  ],
  "covered_fact_keys": ["is_object", "in_car"]
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
| `progress` | string | 否 | `normal` / `stuck` / `near_answer` / `correct`，与 `perception.game_progress` 保持一致 |
| `asked_questions` | array | 否 | 已经问过的问题，用于避免重复 |
| `covered_fact_keys` | array | 否 | 已经确认过的事实键；Workflow 可根据真实用户的新问题补充返回，前端据此跳过提问链中的重复步骤 |

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
  "current_speaker_label": "副驾",
  "current_speaker_persona": {
    "role": "家长",
    "age_group": "adult",
    "is_real_user": true
  },
  "speaker_source": "real_user",
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
  "suppress_passenger_action": false
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `current_speaker` | string | 否 | 当前发言座位 |
| `current_speaker_label` | string | 否 | 当前发言座位中文名 |
| `current_speaker_persona` | object/null | 否 | 当前发言者的人物身份快照 |
| `speaker_source` | string | 否 | `real_user` / `timeline_simulation` / `system_event` |
| `user_seat` | string | 否 | 真实用户座位 |
| `recent_messages` | array | 否 | 近期对话记录 |
| `suppress_passenger_action` | boolean | 否 | 前端已生成模拟发言时为 `true`，避免 Workflow 再生成一位乘客 |

## player_input

当 `trigger_type = chat` 时，表示当前发言者输入内容。发言者可能是副驾真实用户，也可能是前端时间轴选中的模拟乘客，需结合 `interaction.speaker_source` 和 `passengers.selected_persona` 判断。

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
| `passenger_inactive` | 某位乘客长期未参与 | P2 |
| `game_stuck` | 游戏多轮无进展 | P3 |
| `near_answer` | 玩家接近答案 | P3 |
| `cabin_laughing` | 舱内持续大笑，可选 | P4 |
| `near_destination` | 快到目的地 | P2 |
| `environment_change` | 有效环境变化先走情境规则快速分析；前端再调用Chatflow生成一句回应，进入P1仲裁 | P1 |
| `speed_overspeed` | 车速从 `<=120` 进入 `>120 km/h` | P1，仅边沿触发 |
| `speed_change` | 普通车速变化 | P2 状态同步，不逐次调用主持人 |
| `destination_change` | 目的地变化 | P3 |
| `relationship_change` | 乘客关系变化 | P3 |
| `request_passenger_action` | 请求模拟乘客动作 | P3 |

其中 `near_destination`、`destination_change`、`relationship_change` 保留向后兼容，不属于 V1.2 收敛后的核心感知范围。

## 输出结构

当前 Dify Chatflow 在既有游戏输出之外，必须返回 `perception`、`decision_trace` 与 `execution`。其优先级只回显前端传入的 `event.priority`；前端仍拥有 UI、气泡、动画、P1 队列和 P0 紧急兜底。

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
  "covered_fact_keys": ["protective"],
  "round_question_plan": null,
  "decision_trace": {
    "schema_version": 2,
    "layer": "llm",
    "matched_rule": "reply_mode_selected",
    "priority": "P2",
    "strategy_id": "realtime_director",
    "decision": "回答本轮问题",
    "selection_origin": "model_reply_mode",
    "policy": "frontend_arbitrates_execution",
    "guard_status": "passed",
    "hint_blocked": false
  },
  "perception": {
    "schema_version": 2,
    "source": "request",
    "signals": [{"field": "player_input", "label": "后排右说", "value": "它是不是车里能保护我们的东西？", "source": "request"}],
    "confidence": null
  },
  "execution": {
    "kind": "plan",
    "actions": [],
    "timing": {"owner": "frontend"},
    "fallback": "ignore_unapproved_or_failed_action"
  },
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
| `passenger_states` | object/array | 否 | 一个或多个座位的可视化状态变化 |
| `ui_change` | object | 是 | 网页执行动作 |
| `decision_trace` | object | 否 | 融合决策可视化摘要 |
| `perception` | object | 是 | v2 使用 `signals` 摘录上报事实；`confidence: null`，不生成固定置信度 |
| `execution` | object | 是 | `actions`、`timing`、`fallback`；描述动作计划而非执行结果 |
| `covered_fact_keys` | array | 否 | 本次对话新覆盖的事实键；用于让预生成提问链跳过已被真实用户问过的方向 |
| `round_question_plan` | object/null | 否 | 目标题提前预演返回的有序逻辑提问链；实时聊天请求可省略或返回 `null` |

## round_question_plan

`round_question_plan` 是模拟乘客本题后续发言的主计划。当前 Dify 提问预演仍生成并校验每步 `host_reply_text`，但前端只使用问题、事实键与依赖；实际主持人回答逐问调用实时 Chatflow。预演输出的 `ai_reply_text` 为空，不播放开场白。

```json
{
  "round_question_plan": {
    "plan_id": "round-3-moon",
    "reasoning_path": [
      "is_object",
      "in_sky",
      "visible_at_night",
      "reflects_light",
      "near_answer"
    ],
    "steps": [
      {
        "id": "q1",
        "order": 1,
        "stage": "category",
        "fact_key": "is_object",
        "depends_on": [],
        "expected_answer": "yes",
        "variants": {
          "child": "它是一个东西吗？",
          "adult": "它属于具体物品吗？",
          "elder": "这是能看得见的实物吗？",
          "default": "它是具体存在的东西吗？"
        },
        "host_reply_text": "是，它是可以看见的具体事物。这个分类问得很稳。",
        "host_emotion": "thinking"
      },
      {
        "id": "q2",
        "order": 2,
        "stage": "location",
        "fact_key": "in_sky",
        "depends_on": ["is_object"],
        "expected_answer": "yes",
        "variants": {
          "child": "它在天上吗？",
          "adult": "它通常会出现在天空中吗？",
          "default": "它和天空有关吗？"
        },
        "host_reply_text": "是，位置已经锁定到天空了，范围一下小了很多。",
        "host_emotion": "smile"
      }
    ]
  }
}
```

约束：

- 完整 `steps` 按请求生成 2–8 步，按 `order` 递增；明确标记 `preview_status=partial` 的连续安全前缀可以只有 1 步。未带新状态的旧输出仍要求至少 2 步。
- `fact_key` 在同一计划内唯一且稳定，供前端去重和跳步。
- `depends_on` 只引用前序步骤的 `fact_key`，且每一步必须依赖紧邻的前一步，表示下一问是在主持人回答该问题之后继续规划。
- `variants` 至少提供 `default`；建议按请求中的 `persona_age_groups` 提供 `child`、`adult`、`elder` 等变体。
- 当前预演守卫仍校验 `host_reply_text`，要求它简短、准确且不泄露答案；前端不播放它，也不做座位占位符替换。
- 当前 Dify 草稿按“宽泛类别 → 宽泛场景 → 一般用途 → 非独有特征”递进；前三问必须依次为 category/location/function，第四问为 feature。只有第五问起才允许逐渐使用更具体的线索。
- 每一步的 `expected_answer` 必须根据谜底和提示判断；`host_reply_text` 必须准确回答当前问题且不额外透露下一步线索，下一问再依据这一回答继续收窄。
- 前四问要适用于大量不同答案；如果听完问题就能明显想到谜底，不能只把它标成宽泛阶段，必须改写为更上位的问题。
- 第五步起才逐步引入更具体的用途或特征；每一步只增加一个区分信息，最后一步也不强制模拟乘客答对。
- 新守卫在发现泄露、阶段错误或依赖不连续的第一步停止，保留此前通过校验的连续前缀。首步失败则为空，不使用本地问题池。云端是否已同步此实现须读取提问预演应用当前草稿/发布版本确认；不要把本段历史中的“待登录恢复”当作当前登录状态。
- 每道题提前请求一次独立预演 Workflow；若 `preview_diagnostic.repairable=true`，允许再发一次修复请求，`round_question_plan_request.repair` 包含 `attempt:1`、`plan_id`、`accepted_steps`、`validation_errors`。云端模型只生成后缀，守卫合并并重验全链，BFF 拒绝改写固定前缀的结果，不再自动修复第三次。
- BFF 输出 `preview_status=ready|partial|failed` 和 `preview_diagnostic`，包含有效/目标步数、修复标志、错误码及 `workflow_run_id`。守卫拒绝可以 HTTP 200 返回 `failed`，不能以 HTTP 状态替代内容校验。上游执行失败不自动进行内容修复。
- 预演及修复不占用主持人问答锁；每个实际模拟问题及真实副驾提问仍调用实时主持 Chatflow，高优先级座舱事件走独立情境 Workflow 或前端 P0 规则。
- 没有有效安全步骤、计划字段不合法或步骤用完时，游戏与玩家问答继续，模拟乘客不提问。修复失败保留原安全前缀。晚到结果仅用于后续提问时机，不补播已错过时刻，不清空已覆盖事实或已问问题。

## passenger_action

第一阶段只支持单个模拟乘客动作，避免流程复杂度过高。

V1.2 兼容两种用法：带 `text` 时表示模拟乘客发言；只带 `action` 时表示座位视觉状态，不代表该乘客真的说了一句话。

```json
{
  "seat": "rearRight",
  "action": "思考作答",
  "text": "它是不是车里能保护我们的东西？",
  "mood": "普通",
  "intent": "ask_attribute"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `seat` | string | 是 | 发言座位 |
| `action` | string | 否 | 思考、提问、作答、倾听、庆祝等可视化动作 |
| `text` | string | 否 | 模拟乘客发言内容；无此字段时只更新视觉状态 |
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
- 不生成 `seat = front` / `副驾` 的模拟发言；允许用 `action` 表示真实副驾正在思考或庆祝
- 睡着乘客不主动发言
- 主驾在高速或复杂路况下降低参与
- 不重复问已问过的问题
- 不连续让同一乘客抢话
- 不在太早阶段直接猜中
- 当 `interaction.speaker_source=timeline_simulation` 且问题来自 `round_question_plan` 时，返回 `passenger_action=null`，避免再生成另一位乘客发言

## passenger_states

当 Workflow 需要一次更新多个座位时，推荐使用独立字段：

```json
{
  "passenger_states": {
    "front": { "action": "thinking" },
    "rearLeft": { "mood": "大笑", "action": "celebrating" },
    "rearRight": { "mood": "睡着" }
  }
}
```

前端暂用座位状态文字、头像表情和轻动画占位。后续人物切图按 `relationship + mood + activity` 组合映射，不改 Workflow 契约。

## ui_change

```json
{
  "cabin_mode": "normal",
  "target_seat": "front",
  "host_emotion": "thinking",
  "host_avatar_state": "normal",
  "animation": "answer",
  "show_answer": false
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cabin_mode` | string | 是 | 座舱表现模式 |
| `target_seat` | string | 否 | 被 cue 或高亮的座位 |
| `host_emotion` | string | 否 | AI 主持人情绪 |
| `host_avatar_state` | string | 否 | AI 主持人人偶切片状态，建议值为 `normal` / `smile` / `awkward` / `excited` |
| `animation` | string | 否 | 页面动画类型 |
| `show_answer` | boolean | 是 | 是否展示谜底 |

### host_avatar_state

`host_avatar_state` 用于让前端切换 AI 主持人人偶切片。当前前端已支持以下状态：

| 值 | 中文语义 | 前端行为 |
| --- | --- | --- |
| `normal` | 普通 | 默认主持人形象 |
| `smile` | 笑 | 临时表情，显示约 4 秒后回到 `normal` |
| `awkward` | 尴尬 | 临时表情，显示约 4 秒后回到 `normal` |
| `excited` | 兴奋 | 答对/胜利高光形象，胜利态下保持显示 |

兼容规则：

- 如果 Workflow 暂时不返回 `host_avatar_state`，前端会根据 `host_emotion` 做兼容映射。
- `host_emotion = excited`、`celebrating` 或 `victory` 会映射为 `excited`。
- `host_emotion = smile`、`laugh`、`happy`、`笑` 会映射为 `smile`。
- `host_emotion = awkward`、`embarrassed`、`尴尬` 会映射为 `awkward`。
- 未识别值会回落为 `normal`。

中控屏背景不依赖 Workflow 字段。当前前端根据 `car.environment` 进行多对一映射，已预留 `default` / `sunny` / `night` / `snow` / `rain` 五类中控屏背景状态，后续可替换为正式映射表。

## decision_trace

可核验处理记录，不是模型内部推理。当前 `schema_version: 2` 的 `decision` 来自实际代码分支或通过校验的模型 `reply_mode`。输入事实放在顶层 `perception.signals`，动作计划放在顶层 `execution.actions`，实际执行状态由前端生成 `execution_receipts`。

以下是旧版本兼容结构，仅保留用于读取历史，不再作为新面板的决策/执行证据：

```json
{
  "perception": "检测到后排右睡着",
  "decision": "轻声继续，并避免 cue 睡着乘客",
  "execution": "切换轻声模式，高亮后排右",
  "strategy_id": "S04",
  "priority": "P2"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `perception` | string | 否 | Workflow 识别到的关键感知信息 |
| `decision` | string | 否 | 本轮融合决策结论 |
| `execution` | string | 否 | 建议网页或主持人执行的动作 |
| `strategy_id` | string | 否 | 命中的 know-how 策略 ID |
| `priority` | string | 否 | 事件优先级 |

当前 Chatflow 另包含 `layer`（`rule`/`llm`/`fallback`）、`matched_rule`、`policy`、`guard_status` 和 `hint_blocked`，这些字段留作调试，不公开堆在三栏中。P0 为 `rule`；普通导演事件走 `llm`，但固定事件入口选择标为 `selection_origin: code_branch`；回复方式选择为 `model_reply_mode`。额外提示拦截是 `rule`；校验失败为 `fallback`，不能伪装成模型成功决策。

## execution 与动作白名单

`execution.kind: plan`，`execution.actions` 是 Chatflow 的计划；实际执行和成功/失败回执由前端产生，二者不得混为一谈。`timing.owner: frontend` 不表示实际排队；只有前端真的进入等待才显示“等待当前气泡结束”。音乐播放成功需要 `play()` 成功且播放器未暂停；被浏览器拦截、无播放器、加载失败均不得显示“音乐已开启”。

- 自然语言音乐开关可输出 `music.set_enabled`，仅当用户明确要求开/关时由输出守卫校验后执行；任何乘客、任何游戏状态均可请求。
- 游戏控制可输出 `{"type":"game.set_paused","paused":true|false}`。仅当玩家当前原话明确要求暂停/继续、请求作用域匹配且不处于安全暂停时允许；仅模型提出动作不授权。前端核对动作与原话后执行，保留题目、提问次数、事实和倒计时剩余时间。
- 答对规则可输出 `ambient_light.play_preset`，参数 `preset = cabin-correct-light`。该动作只用于计划展示，灯效仍由前端已有答对逻辑触发。
- 2026-10-18新增窄范围模拟动作 `{"type":"cabin.apply_sleep_comfort","seat":"rearRight"}`。仅限有效 `situation_event / passenger_sleep` 的当前目标座位，且该座位仍睡着；由主持人决定是否输出，空动作列表代表不执行。整套模拟包含该区关灯、分区音量0、空调恢复用户记忆值。
- 恢复动作为 `{"type":"cabin.restore_sleep_comfort","seat":"rearRight"}`，仅限有效 `passenger_wake` 的清醒目标，且 `car.sleep_comfort_seats` 确认该座位此前启用了关怀。醒来只更新乘员状态，不立即恢复设备。
- 两种动作必须附带灯光、空调和分区音量说明，即使情境原本静默也应随动作发言；无动作仍可保持静默。前端让话术和动作一起排队，在气泡实际显示时再核对局/题/情境版本/P0和目标状态后执行，而非在响应到达时执行。无话术或说明不全的动作结果由Dify守卫拒绝并重试；P0/过期/条件变化取消待执行动作。
- 不支持任意灯光/温度/音量参数，不改变整车背景音乐。普通乘客聊天、其他情境、过期/跨座位结果不能授权。重置清除该座位关怀效果；通用照明、空调和其他设备动作仍未开放。
- 气泡、Sprite 动画、屏幕切换、倒计时和抢占策略不属于 Chatflow 执行动作。

注意：

- `decision_trace` 是演示可视化摘要，不是模型完整推理链。
- 不应输出冗长内部分析或敏感 know-how。
- 前端可以将其展示在多模态感知面板中。

### 策略编号约定

为避免 Coze Workflow 和前端可视化展示错位，以下编号必须保持稳定：

| 策略 ID | 场景 | 前端期望 |
| --- | --- | --- |
| `S04` | 有人睡着 | `cabin_mode = soft`，不再 cue 睡着座位 |
| `S09` | 快到目的地 | `cabin_mode = final_round`，`animation = final`，游戏进入收束节奏但不直接结束 |

2026-06-23 复测：`event.type = near_destination` 已返回 `strategy_id = S09`、`priority = P2`、`game_status = playing`、`cabin_mode = final_round`、`animation = final`。

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

当前推荐路径由前端时间轴先决定“什么时候有乘客提问”，再从 `driver`、`rearLeft`、`rearRight` 中随机选择一个合规座位。`front` 固定为真实用户，不参与随机。前端选好问题后，以 `chat` 请求把发言座位、问题和人物身份一起传给 Workflow。

输入：

```json
{
  "trigger_type": "chat",
  "plugin_id": "riddle",
  "player_input": "它能保护我们吗？",
  "player_seat": "右后",
  "car": {
    "speed": 80,
    "destination": "迪士尼",
    "environment": "高速路晴天白天"
  },
  "passengers": {
    "relationship": "父母+小孩",
    "selected_seat": "rearRight",
    "selected_seat_label": "右后",
    "selected_persona": {
      "name": "后排小朋友",
      "role": "小朋友",
      "age_group": "child",
      "persona": "好奇、兴奋、喜欢动画和食物",
      "style": "短句、直接、偶尔跳脱",
      "is_real_user": false
    },
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
        "role": "小朋友",
        "age_group": "child",
        "is_real_user": false
      }
    }
  },
  "game": {
    "status": "playing",
    "question_count": 2,
    "current_answer": "安全带",
    "asked_questions": ["它是车上的东西吗？"]
  },
  "event": {
    "type": "passenger_question",
    "source": "timeline",
    "seat": "rearRight",
    "seat_label": "右后"
  },
  "timeline": {
    "id": "family_highway_disney",
    "name": "高速亲子出行",
    "round_timeline_id": "round_collaborative",
    "round_timeline_name": "轮流破题",
    "round_index": 2,
    "current_event": {
      "type": "passenger_question",
      "description": "乘客开始提问"
    }
  },
  "interaction": {
    "user_seat": "front",
    "current_speaker": "rearRight",
    "current_speaker_label": "右后",
    "current_speaker_persona": {
      "role": "小朋友",
      "age_group": "child"
    },
    "speaker_source": "timeline_simulation",
    "suppress_passenger_action": true
  }
}
```

输出：

```json
{
  "passenger_action": null,
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

此路径中前端已经显示了乘客气泡，Workflow 不应再次返回 `passenger_action`，否则会造成重复发言或切换到错误座位。旧的 `trigger_type=simulation + request_passenger_action` 路径仅作为兼容能力保留，不再是单题黄金时间轴的主路径。

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

## 副驾参与机会

`route=situation` 的 `passenger_inactive` 由真实参与状态触发，事件需要 `seat=front`、`source=participation_monitor`、`priority=P4`。输入 `participation` 包括 `seat`、整数 `version`、`inactive_duration_ms`、`dialogue_silence_ms`、`remaining_ms`、`real_user_turn_count`、`invitation_declined`。不传原始对话给情境分析器。

Workflow 只在未参与至少20000ms、对话空闲至少2500ms、剩余时间大于15000ms且副驾清醒时分析；模型决定是否主动邀请。候选输出需要 `request_proactive_speech=true`、`strategy=invite_collaboration`、`target_seat=front`，并回显 `participation_version`。结果有效期10000ms，`usable_for_dialogue=false`，不将邀请策略带入后续问答。前端在播放前复核活动版本和空闲条件。静默、失败或过时结果均不生成本地邀请兜底。

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
