# Coze 每题批量逻辑提问链搭建包

## 目标

每题开场只调用一次 Coze，同时返回：

1. AI 主持人的开场话术。
2. 本题 4 至 6 步有逻辑关系的模拟乘客提问链。
3. 每一步对应的主持人即时回答。
4. 不同年龄人群的自然措辞变体。

之后时间轴播放模拟乘客提问时不再逐问请求 Coze。真实副驾提问、安全事件和复杂座舱融合事件仍走现有实时路径。

## Workflow 改动

保持当前并行快速路径，只增加下面的数据透传和开场生成：

```text
输入标准化
  -> 读取 round_question_plan_request
  -> 路由判断
      -> start_game 且 enabled=true
          -> 现有开场 LLM 同时生成 opening + round_question_plan
      -> 其他请求
          -> 保持现有 Fast Answer / Director Core / 确定性安全路径
  -> 输出守卫
      -> 保留 round_question_plan
      -> 保留 covered_fact_keys
```

不要增加第二个大模型节点。提问链应合并到 `start_game` 当前使用的模型调用里。

## 输入标准化

输入标准化节点需要新增并原样输出：

```js
const request = input.round_question_plan_request || null;
const game = input.game || {};
const passengers = input.passengers || {};

return {
  ...existingOutput,
  round_question_plan_request: request,
  current_answer: game.current_answer || "",
  current_theme: game.current_theme || "",
  riddle_hint: game.hint || "",
  covered_fact_keys: Array.isArray(game.covered_fact_keys)
    ? game.covered_fact_keys
    : [],
  passenger_personas: passengers.personas || {},
};
```

## 开场路由条件

```js
const shouldGenerateRoundPlan =
  event_type === "start_game"
  && round_question_plan_request?.enabled === true;
```

此条件只控制是否生成提问链，不改变安全门和其他路由的优先级。

## 开场模型 Prompt

### 系统提示词

```text
你是智能座舱猜谜游戏的 AI 主持导演。

本次任务除了生成简短开场，还要为当前谜底一次性生成有逻辑关系的模拟乘客提问链。

硬规则：
1. 提问链必须沿“类别 -> 位置或场景 -> 功能 -> 特征 -> 接近答案”逐步缩小范围。
2. 后一个问题必须利用前面已经确认的事实，不能是互不相关的问题集合。
3. 每个问题都必须能用“是/否/不完全是”回答。
4. 前两个问题不得说出或直接猜中谜底。
5. 每一步都提供 fact_key、depends_on、不同年龄口吻 variants 和可直接播放的 host_reply_text。
6. variants 只改变表达口吻，不改变问题事实。
7. host_reply_text 要自然回应本步问题，并轻微承接上一步，不泄露谜底。
8. 不生成任何 passenger_action。具体发言座位由前端决定。
9. 只返回合法 JSON，不使用 Markdown 代码块，不输出分析过程。
```

### 用户提示词

```text
当前谜底：{{current_answer}}
题目主题：{{current_theme}}
题目提示：{{riddle_hint}}
车外环境：{{environment}}
目的地：{{destination}}
乘客关系：{{relationship}}
乘客人设：{{passenger_personas}}
计划请求：{{round_question_plan_request}}

返回：
{
  "ai_reply_text": "面向全车乘客的简短开场和玩法邀请",
  "game_status": "playing",
  "is_correct": false,
  "answer": "{{current_answer}}",
  "passenger_action": null,
  "round_question_plan": {
    "plan_id": "稳定且本题唯一的字符串",
    "reasoning_path": ["fact_key_1", "fact_key_2"],
    "steps": [
      {
        "id": "q1",
        "order": 1,
        "stage": "category",
        "fact_key": "稳定的英文事实键",
        "depends_on": [],
        "expected_answer": "yes",
        "variants": {
          "child": "儿童口吻",
          "adult": "成人口吻",
          "elder": "长辈口吻",
          "default": "通用口吻"
        },
        "host_reply_text": "可立即播放的主持人回答",
        "host_emotion": "thinking"
      }
    ]
  },
  "covered_fact_keys": [],
  "ui_change": {
    "cabin_mode": "normal",
    "target_seat": "all",
    "host_emotion": "confident",
    "animation": "speak",
    "show_answer": false
  }
}
```

模型实际生成的 `steps` 数量必须等于 `round_question_plan_request.step_count`。

## 真实用户覆盖事实

Fast Answer 和 Director Core 在处理真实副驾问题时，应判断该问题是否已经覆盖提问链中的某个事实方向，并返回：

```json
{
  "covered_fact_keys": ["in_sky", "visible_at_night"]
}
```

判断要求：

- 只返回确实被本轮问答确认的事实键。
- 不要返回尚未讨论的后续事实键。
- 不确定时返回空数组。
- `covered_fact_keys` 是增量结果，前端会自动合并。

前端会跳过事实键已覆盖的计划步骤，防止模拟乘客重复真实用户刚问过的内容。

## 输出守卫

现有输出守卫必须按路由选择实际结果，并额外保留两个新字段：

```js
const selected = routeResult || {};

return {
  ...existingGuardedOutput,
  passenger_action: selected.passenger_action ?? null,
  round_question_plan: selected.round_question_plan ?? null,
  covered_fact_keys: Array.isArray(selected.covered_fact_keys)
    ? selected.covered_fact_keys
    : [],
};
```

禁止未执行分支的 `{}` 覆盖实际开场结果。

## 前端运行规则

- 每题随机选择一条黄金时间轴。
- 时间轴只定义何时出现 `passenger_question`，不定义具体座位和具体问题。
- 每个提问槽位从计划中选择依赖已满足且尚未使用的最早步骤。
- 发言座位只在 `driver`、`rearLeft`、`rearRight` 中随机；不会模拟副驾。
- 根据实际座位人设的 `age_group` 选择对应 variants。
- 乘客气泡显示后，主持人进入约 3 秒思考态，再播放预生成回答。
- 安全事件可以立即取消预生成回答；真实用户在主持忙碌时仍可输入并进入队列。
- 有效计划不产生逐问网络请求；无效计划回退到旧路径。

## 验收用例

1. 每题开场返回至少 2 个有效步骤，正常目标为 4 至 6 步。
2. `q2.depends_on` 引用 `q1.fact_key`，后续依次推进。
3. 同一步的儿童和成人问法含义相同但口吻不同。
4. 模拟乘客播放两问时，浏览器 Network 中不新增 Workflow 请求。
5. 真实副驾提问仍新增一次 Workflow 请求并得到实时回复。
6. 副驾先问到某事实后，后续模拟链跳过相同 `fact_key`。
7. 急刹可立即打断思考态并进入安全暂停。
8. Workflow 不返回计划时，页面仍能用本地题库继续游戏。
