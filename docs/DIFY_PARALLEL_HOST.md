# 主持人双路并行方案 v4

2026-10-18 可靠性修复已发布到主持、情境及预演三应用，详见 [最新配置与回归](DIFY_RELIABILITY_20261018.md)。当前主持模型先分离推理、再对最终文本校验Schema和业务守卫，失败最多一次修正；不启用提供商JSON模式和Dify原生提前解析。下方旧日期测试结果及模型参数为历史记录。

2026-10-17 最新事件链路已改为“情境分析→前端→Chatflow”，情境不再生成候选话术，P1走零模型规则分析。当前协议以 [情境串行路由](SITUATION_DIALOGUE_ROUTING.md) 为准；本文下方保留此前方案及历史验证，“本地环境串词”不再描述当前行为。

开始新的 Dify 子对话前，先读 [Dify 当前状态与子对话交接](DIFY_CURRENT_STATE.md)。本文保留实现细节与历史验证记录；旧 hash 不是可直接写回云端的目标版本。

## 本次交付与边界

本次已完成 Demo 的 BFF 适配：同源 `/api/workflow` 根据请求类型分别代理 Chatflow 与情境 Workflow，并在服务端缓存可供对话使用的有效情境结果。环境变化改由前端本地P1立即串词，Workflow结果只更新决策面板；P0本地执行并异步通知，返回只记录。环境与P0分析不写入后续对话缓存。

2026-10-16 前端适配：事件路由只进入情境 Workflow，未知事件由 BFF 返回 `route=skipped`；响应包含 `route`、`event_type`、`event_id`，情境响应还包含局、题及情境版本。急刹等 P0 由前端本地执行，情境通知异步发送且不驱动 UI。前端不再调用旧 `sync_state`。情境结果需要通过事件 ID、作用域、过期时间和主动发言标志校验后才进入话术队列。开场暂用本地话术，新的每题问答链 Workflow 留待下一阶段。

| 应用 | 云端 ID | 可导入文件 |
| --- | --- | --- |
| 自然对话 Chatflow | 74bef8bd-22bd-4e19-91da-5e8d645dd8ed（沿用） | tools/dify-workflow-mcp/workflows/parallel/host-dialogue-v4.yml |
| 情境分析 Workflow | bc1ce5be-d5c5-4885-84c5-72c2c1f63d18（新增） | tools/dify-workflow-mcp/workflows/parallel/cabin-situation-v1.yml |

模型沿用云端 deepseek-flash，知识库沿用实际绑定。没有编造模型配置、dataset ID 或凭证。

2026-10-17 主持人输出恢复已验证并发布；当前对话应用 hash 见交接文档。低强度思考、结构化结果优先及单次有条件重试生效；17项云端验收和3个发布 API 请求通过。情境与预演应用未在本轮更新。详情见 [主持人兜底诊断](DIFY_FALLBACK_DIAGNOSTICS.md)。

生成器为 `tools/dify-workflow-mcp/scripts/build-parallel-host.mjs`，默认读取同目录下的 `workflows/parallel/cloud-bindings.json`，其中保存从原云端草稿读取的真实模型/检索设置（无密钥）。可用命令行参数指定新的云端草稿JSON。应用ID记录于 `workflows/parallel/cloud-apps.json`；本次原草稿完整备份为 `tmp/dify-import/host-before-parallel.json`。

两个画布分别有3、4个彩色备注，所有处理节点都有中文描述。备注使用官方 custom-note / Lexical 格式，不参与运行。

## 两条路线

- 乘客发言：当前快照与缓存校验 → P0判定或主持LLM → 优先校验结构化回复 → 无效时重试一次 → 输出守卫 → 自然语言Answer。详见 [模型输出恢复](DIFY_FALLBACK_DIAGNOSTICS.md)。
- 环境变化前台：前后环境校验 → 可信环境映射短句 → 立即进入本地P1仲裁，不等待网络。
- 环境变化后台：并行情境Workflow → 守卫及有效期封装 → 仅更新决策面板；云端仍可能生成候选串词，前端不播放或执行。
- 其他重要情境：P0规则旁路或事件门控 → 分析LLM → 按需Knowledge Retrieval → 策略LLM → 守卫及有效期封装。

代理分别发起请求，不把情境分析串在每次聊天之前。聊天读取调用开始时已有的有效分析，分析尚未结束时直接使用当前硬约束正常回应。本阶段玩家原话不触发情境分析/检索；求助、独立思考等由对话主持人的基本规则和Memory处理。

分析LLM判断 `needs_knowhow`、`share_context`、`selected_fields`、`proactive_speech`。检索词由代码用相关的真实状态构造，不包含谜底、玩家原话或历史。策略LLM结合实际经验生成建议。因此情境路径最多两次模型调用，对话正常一次、模型输出无效时最多两次，P0零次。主持对话模型使用低强度思考和 JSON 格式；前端问答等待动画仍按原生命周期运行。

| 事件 | 处理 |
| --- | --- |
| hard_brake / safety_pause / timeout / round_timeout / game_end / answer_correct | P0规则旁路，不经过检索或模型 |
| environment_change | 游戏进行中/开场且前后环境真实变化、event.value匹配当前环境时，前端立即调度本地P1短句；并行情境结果只更新面板，同值、暂停不发言 |
| speed_overspeed | previous_value <= 120 且 value > 120 才分析，可申请P1主动串词 |
| driver_tired | 疲惫/睡着且 duration_ms > 15000，可申请P3主动串词 |
| passenger_inactive | 真实副驾未参与 >=20秒、对话已空闲 >=2.5秒、剩余时间 >15秒且清醒时，情境 Workflow 判断是否申请P4邀请；每题最多分析一次 |
| passenger_sleep / passenger_wake / near_destination / game_stuck / near_answer / cabin_laughing / resume_game / round_changed | 可分析，默认只更新背景建议 |
| 未知事件、普通数值变化、暂停期普通事件 | 静默跳过 |

持续15秒的计时检测、event.id去重、P1等待期间新事件覆盖旧事件仍由前端/代理实现。Workflow自身不持续轮询，不管理计时器。量产对应车端常驻事件服务。

2026-10-17 副驾邀请：移除“轮流破题”23秒、“轻松玩梗”40秒的 `cue_real_user` 固定串词，以及“安静照顾”31秒的模拟沉默事件。前端根据本题真实输入和发言状态产生 `passenger_inactive`，不直接生成邀请文案，也不改变乘客表情来伪造沉默。没有合格模拟乘客时直接跳过该提问点。

`snapshot.participation` 只携带副驾座位、活动版本、未参与时长、对话空闲时长、剩余时间、真实用户发言次数和是否明确要求独立思考。睡眠、暂停、正在回答、存在排队问题或环境串词、最后15秒等情况不发起分析。暂停时间不累计为沉默时间。

情境 Workflow 同时检查这些条件，再由分析 LLM 决定 `proactive_speech`；策略 LLM 生成自然话术，仅允许 `invite_collaboration + target_seat=front` 申请发言。拒绝邀请、近期参与、睡眠状态或校验失败均静默，不补通用话术。

返回 `participation_version`，邀请结果有效期为10秒，不进入后续聊天的情境缓存。前端接受和播放前再次核对本题、状态及活动版本；等待期间任何乘客提问或新的主持话术都会使旧邀请失效。邀请采用P4，不打断正在显示的问答。

该改动已于2026-10-17保存并发布至情境应用 `bc1ce5be-d5c5-4885-84c5-72c2c1f63d18`，发布 hash 为 `14bf16d8d2924140a4eee5b76255502138a947c5e0e553f2b840be324c8fdb08`。只更新事件门控、分析计划、最终守卫、两个模型提示词及对应画布备注；保留云端模型、检索绑定、其他节点和布局。主持人 Chatflow 未重新发布。

2026-10-17 环境播报增量已发布，当前情境应用 hash 为 `2d68d3c2aaa7a82e6de01e8e01e967c6f6d53c4411c5ced5130f903619e982e0`。新增环境分支 `3000000000020` 与免检索上下文 `3000000000021`，沿用原串词模型；有效环境变化不再由分析模型决定是否静默。输出不合格时用可信环境映射生成短句；禁止推断路况或声称执行车辆动作。

后续同日本地调整：移除BFF的4500ms环境话术预算和代播兜底，环境话术归前端本地所有。后台按正常超时等待真实分析，静默结果也可更新面板，网络失败如实显示分析不可用。此调整无需修改或重发云端Workflow。前端不执行环境分析返回的气泡、动画、游戏状态或动作计划，也不让其进入后续Chatflow情境缓存。

前端情境请求按事件类型关联，低优先级事件不能使环境请求失效；同类事件仅接受最新结果。环境串词等待普通气泡至少显示1500ms后优先显示，遇到P0/P1则等待其结束。被延后的乘客回答按本局、本题、P0代数及30秒有效期校验后继续显示。连续环境更新保留最新候选，P0清除待播内容。面板用执行回执显示排队、显示结束、取消及静默，不将“无需检索”等同于“未处理事件”。

## 输入契约

共用应用输入 `snapshot` 为JSON字符串，示例：

```json
{
  "game_id": "game-1",
  "round_id": "round-1",
  "scene_version": "1",
  "game": {
    "status": "playing",
    "current_answer": "雨伞",
    "round_index": 1,
    "question_count": 3,
    "max_questions": 15,
    "covered_fact_keys": [],
    "asked_questions": []
  },
  "car": {"environment": "城市夜景", "speed": 50, "destination": "火锅店"},
  "passengers": {
    "selected_seat": "front",
    "states": {"driver": "awake", "front": "awake", "rearLeft": "sleeping", "rearRight": "awake"}
  },
  "event": {"id": "event-1", "type": "passenger_sleep", "value": "rearLeft"}
}
```

原题目事实通过 `game.round_question_plan.steps` 提供，沿用事实键守卫。`game_id`每局变化，`round_id`每题变化；`scene_version`在环境、乘员、驾驶状态、暂停/恢复等影响建议的状态变化时递增，不因普通数值刷新或每次发言无条件递增。每个重要事件有唯一 `event.id`。

作用域字段缺失时，对话仍可使用当前状态，但不采用缓存；非P0情境分析跳过。未知状态、睡眠乘员及主驾不可作为协作目标。

### 对话 Chatflow

```json
{
  "conversation_id": "已有会话ID",
  "user": "现有稳定用户ID",
  "query": "下雨时会用到它吗？",
  "inputs": {
    "snapshot": "快照序列化后的字符串",
    "situation": "最近有效scene_output原文，缺省为{}"
  },
  "response_mode": "streaming"
}
```

同一conversation_id跨局延续，Memory窗口保持最近10轮。应用输入不复制进query或Answer，也不再重复发送前端最近6条原话。新Answer只有自然语言，因此新助手历史不含整份JSON。旧会话中原有JSON不会自动清空，会逐渐移出窗口；历史持久化不等于模型无限读取历史。

历史记录（2026-10-17，已被后续主持人可靠性发布替代）：前端持久化全局会话并在每轮带 `snapshot.round_context`；当时发布 hash 为 `0fd5cef582870f78a642fc49676aacb449a865513fa6b533be81e9fb2ccaf0db`。当前发布 hash 见交接文档。

云端草稿已验证同一会话下一局请求能读取新 `inputs.snapshot`。发布API仍需在代理联调时验证。原 `cabin_snapshot` 会话变量为兼容旧同步接口保留，但v4不读取它。

当前云端控制台的草稿调试接口还需传上一轮 `message_id` 为 `parent_message_id`，才能续接同一条消息分支；只传conversation_id可能复用会话容器却新开消息分支。测试脚本已按实际控制台接口处理。发布API的续聊行为另行联调，不把控制台私有参数盲目当作公共API必填字段。

### 情境 Workflow

调用新应用 `/v1/workflows/run`，只传 `inputs.snapshot`，不传query、conversation_id或transcript。新应用需要独立应用API Key，在Dify UI创建后放到服务端。不能用旧Chatflow Key代替。本次没有创建凭证或修改 `.env`。

## 输出与协调

Chatflow的Answer/SSE message只含自然话术。结果代码节点 `1000000000020` 另外输出 `host_result` JSON字符串，结构沿用现有面板契约。代理需从SSE `node_finished` 的 `data.outputs.host_result`提取，并关联本次请求；云端草稿调试流已实测存在此字段。发布API的事件可见性仍需联调，不能假定blocking响应自动包含任意节点输出。

当前 `/api/workflow` 通过流式 Chat API 读取自然语言 Answer，并尽可能提取结果节点的 `host_result`；返回给前端的 `workflow_output` 仍保持原有结构。若发布 API 没有暴露结果节点，BFF 会用 Answer 构造最小兼容响应，聊天仍可继续，但结构化决策字段会降级为空。

情境Workflow的End返回 `scene_output` JSON字符串：

- `analysis_status`：ready / rule / skipped / failed。
- `game_id`、`round_id`、`scene_version`、`event_id`、`generated_at_ms`、`expires_at_ms`。
- `usable_for_dialogue`、`dialogue_context`：所选快照、结构化建议、仅实际采用的精简经验。
- `request_proactive_speech`、`host_response`：候选发言；静默分析时host_response=null，不算实际发言。
- `perception`、`decision_trace`、`execution`、检索命中与采用经验ID、策略/目标等展示字段。

普通情境建议有效期暂定60秒；副驾邀请为10秒且不进入聊天缓存。代理保存前、前端播放前都要核对作用域与过期时间；失效或乱序结果不能覆盖新状态。Chatflow再校验一次，并从当前快照重取选中事实，避免重复使用旧车速或乘员状态。

检索命中与最终采用分别展示。检索结果先进行事件适用性筛选，再校验策略引用。缓存仅保留实际采用经验的精简策略/例外，省略例子与无关文档。只有可信代理可传入缓存分析，不能将玩家任意JSON当作分析结果。

所有候选串词继续由前端优先级仲裁。UI、气泡、动画、计时、音频及车辆执行器模拟仍由前端管理。答对氛围灯仍由前端答对逻辑触发；输出仅描述计划。音乐开关仍需玩家明确授权。

主动串词由独立Workflow产生，因此默认不会自动成为Chatflow的一条助手记忆。BFF 按 `user_id` 缓存有效情境结果，并在下一次聊天请求中通过 `inputs.situation` 传入；过期、乱序或作用域不匹配的结果不会进入 Chatflow。主动话术仍交给前端原有优先级仲裁，不能绕过前端计时器。

### BFF 接入

浏览器继续只请求同源 `/api/workflow`，不接触 Dify 凭证。服务端配置：

```env
DIFY_CHATFLOW_API_KEY=...
DIFY_CHATFLOW_APP_ID=74bef8bd-22bd-4e19-91da-5e8d645dd8ed
DIFY_SITUATION_API_KEY=...
DIFY_SITUATION_APP_ID=bc1ce5be-d5c5-4885-84c5-72c2c1f63d18
```

乘客发言使用 `route=chat` 或 `input_payload.trigger_type=chat`；BFF 将原话放在 `query`，将当前快照和缓存情境放在 `inputs.snapshot`、`inputs.situation`。重要事件使用 `route=situation`，BFF 只将 `inputs.snapshot` 传给情境 Workflow，并独立更新缓存，因此不会占用聊天请求锁。当前缓存是单进程短期缓存，多实例部署时应替换为 Redis 或其他共享存储。

## 降级与验证

- 无检索命中：继续策略生成；异常片段标failed，不采用引用。
- Knowledge Retrieval硬异常：可能使情境Workflow失败。代理标记失败，不安装新缓存；独立对话继续使用硬约束及仍有效的缓存。
- 分析/策略模型异常：LLM默认输出空JSON，守卫不产生主动串词或新有效缓存。
- P0网络失败：前端紧急规则立即处理。

```sh
node tools/dify-workflow-mcp/scripts/build-parallel-host.mjs
node tools/dify-workflow-mcp/scripts/test-parallel-host.mjs
node tools/dify-workflow-mcp/scripts/test-parallel-cloud.mjs smoke
node tools/dify-workflow-mcp/scripts/test-parallel-cloud.mjs scene
node tools/dify-workflow-mcp/scripts/test-parallel-cloud.mjs memory
```

测试覆盖图/引用/备注、P0旁路、对话无检索、事件阈值、空/异常检索、未知经验ID、睡眠/主驾邀请、暂停音乐控制、缓存失效及快照与原话分离。实际云端trace保存在 `tmp/dify-import/parallel-tests/`，不含凭证。

### 本次验证记录

本地12组测试通过，额外覆盖模型输出附带思考标签和重复JSON示例的情况：解析只使用最终JSON，思考文本不会进入话术或面板。

| 云端草稿场景 | 实际结果 |
| --- | --- |
| 普通“下雨时会用到它吗？” | 一次对话LLM、零检索，Answer为自然语言，结构化结果单独输出 |
| 同一会话换局并猜“西瓜” | 使用新快照谜底，P0判对，零LLM |
| 急刹 | 零LLM、零检索，返回paused |
| 后排左睡着 | 两次后台LLM、一次检索，实际采用HK05，静默更新建议 |
| 全员清醒、环境变化 | 分析LLM选择免检索；策略正常生成，无强制主动发言 |
| 携带有效情境缓存，“让我再想想” | 一次对话LLM、零检索，尊重独立思考，不邀请乘员 |
| 普通车速数值变化 | skipped，零LLM、零检索 |
| 先说“我叫小橙”，换局后询问名字 | 同一会话/消息分支正确回答“小橙”；实际模型输入包含上一轮原话与自然回复，历史消息不含快照 |

两份云端草稿的代码、提示词、模型Memory、知识库绑定、备注文本与本地文件回读一致。检索硬网络错误的独立降级仅完成契约与本地异常路径检查，没有对云端知识库做破坏性故障注入。

历史验证边界（连接器/API 配置刚建立时）：节点耗时仅供诊断，不代表端到端显示/出声时延；当时未做真实云端双路端到端联调或实车 Always-on 验证。后续本地 API Key 配置状态可查 `/api/health`，当前云端哈希及实际验收以交接页、诊断页所记录的具体日期为准。

格式参考：[Chat API](https://docs.dify.ai/en/api-reference/chat-messages/send-chat-message)、[备注类型](https://github.com/langgenius/dify/blob/main/web/app/components/workflow/note-node/types.ts)、[备注编辑器](https://github.com/langgenius/dify/blob/main/web/app/components/workflow/note-node/note-editor/context.tsx)。
