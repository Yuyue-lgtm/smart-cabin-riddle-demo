# Dify 实时主持 Chatflow

2026-10-19 玩家可在现有输入框明确请求暂停/继续游戏。前端识别指令并验证当前局/题和安全暂停状态；Chatflow 仅可返回 `game.set_paused` 受限动作，前端拥有最终执行权。动作及守卫见 [游戏暂停权限与六题配置](GAME_CONTROL_AND_SIX_ROUNDS.md)。主持人应用发布 hash 见 [Dify 当前状态](DIFY_CURRENT_STATE.md)。

2026-10-18应景题新增开场串词，见 [下一题应景与开场](ENVIRONMENT_AWARE_RIDDLES.md)：前端在实际应景题开题时请求`route=chat, operation=environment_round_intro`，BFF校验后以`round_changed`和服务器生成的一次性规则情境调用已有Chatflow，不走情境分析Workflow、不改云端图。沿用全局会话和守卫，仅消费自然串词，禁止游戏/事实/设备更新；P3、每题一次、6秒开题窗口，问答先到或过晚不补播。

2026-10-18当前能力与情境规则以 [CABIN_SCENARIO_POLICY.md](CABIN_SCENARIO_POLICY.md) 为准：求助仅复述已展示公开线索，普通对话允许明确分区灯光及背景音乐，其他车控婉拒；有效入睡必启关怀，空调调至用户记忆值，不关闭空调。临时事件本地暂停4.5秒并保留待回答问题，不包含导航；主驾疲惫或分心仅安全提醒、不通过游戏提神。以下旧版提示拒绝和仅音乐白名单说明已被替代。

固定兜底的原因码、单次运行追踪和测试判定见 [主持人兜底诊断](DIFY_FALLBACK_DIAGNOSTICS.md)。

开始 Dify 迭代前，先核对 [Dify 当前状态与子对话交接](DIFY_CURRENT_STATE.md)。该页的已发布 hash 是最近记录值，写云端前仍要实时读取当前草稿 hash。

2026-10-17 对话输出恢复：主持人模型使用低强度思考、JSON 格式和既有 Schema；优先读取 `structured_output`，兼容旧文本。输出无效时只在同一次 Chatflow 执行中重试一次，随后统一经过原安全守卫。原有跨题、跨局和刷新会话复用保持不变；新增尝试/重试诊断不会把模型思考内容放进气泡或聊天记忆。详情、验收和发布状态以上述诊断文档为准。

> 当前使用自然对话 Chatflow 与独立情境 Workflow，见 [双路并行方案 v4](DIFY_PARALLEL_HOST.md)。主持人 Chatflow 已发布并通过本地 BFF 连续回归；前端/BFF 改动尚未部署 Vercel。云端应用分别使用自己的 API Key，不能绕过 BFF 将凭证放进浏览器。本文下方旧版接口说明仅用于兼容背景。

## 当前前端适配（2026-10-17）

最新增量见 [情境串行路由](SITUATION_DIALOGUE_ROUTING.md)：情境只做分析，前端校验有效发言请求后自动调用同一持久Chatflow。环境/超速/疲惫走零模型P1分析；环境、睡眠和目的地本地固定串词已移除。P0仍本地即时处理。以下早期“环境本地P1”描述由此替代。

前端已停用 `sync_state`：Chatflow 使用玩家原话与当前快照，情境 Workflow 使用事件快照。每次请求带 `game_id`、`round_id`、`scene_version`；事件另带独立 `event.id`。BFF 严格区分聊天和情境路由，未知事件返回 `route=skipped`，不会落入 Chatflow。

急刹、答对、超时和整局结束由前端立即执行 P0 规则，并可在后台通知情境 Workflow；P0 通知结果只保存分析记录，不作为页面话术。环境变化由前端立即显示本地 P1 短句，情境 Workflow 并行分析只更新决策面板。其它情境候选话术必须通过事件、作用域、有效期及 `request_proactive_speech` 校验才可能进入前端队列。

提问预演使用独立 Workflow（App ID `bf81cd44-a49f-4048-901f-e95e941dc429`，BFF 路由 `preview`）。它接收 `input_payload`，返回 `workflow_output.round_question_plan`；前端只保存有序的乘客问题、事实键和依赖，不播放其中的 `host_reply_text`。每个预演问题出现后仍调用实时主持 Chatflow 回答。服务端使用独立的 `DIFY_PREVIEW_API_KEY`（或按 App ID 配置 `DIFY_WORKFLOW_API_KEYS`），不与主持人 Chatflow 共用 API Key。云端预演的当前草稿/发布 hash 尚未在主持人可靠性发布中重新读取；下方有关云端预演节点的记录为历史状态，后续修改前先实时读取应用。

历史记录：2026-10-17 曾对提问预演草稿做过“雨伞/钥匙”四步计划调试；该次不是发布 API 或前端端到端验收，且不证明现在云端仍是相同草稿。预演仍可能生成和校验 `host_reply_text`，但前端不播放它。

下文保留旧版 Chatflow 接入记录；涉及 `cabin_snapshot` 变量与 `sync_state` 的段落不再描述当前前端行为。

## 提前一道题预演（2026-10-17）

2026-10-18前端新增 [下一题应景](ENVIRONMENT_AWARE_RIDDLES.md)：环境稳定800ms后，下一题优先选本局未出现的相关谜题，实际换题才替换预演。当前题始终锁定，新题预演携带新的谜底/主题及最新座舱快照，仍逐问调用实时Chatflow。没有预演就跳过模拟，不阻塞开题；不需要新增或更新云端Workflow。

### 安全前缀与一次修复（本地实现；云端状态待重新读取）

本轮不切换为播放预演主持人回答：仍保留云端生成和校验的 `host_reply_text`，实际模拟提问逐问交给实时 Chatflow 回答。此前关于删除预演回答的讨论未实施。

新协议把计划分为 `ready / partial / failed`：守卫逐步校验，在第一个不合格步骤处停止，保留此前连续安全前缀；不能跳过坏步骤后继续保留依赖它的问题。至少一个通过校验的步骤即可先供前端使用。后台只对首个坏步骤及后续依赖修复一次，固定前缀、计划 ID、已问及已覆盖记录不变。修复失败保留原前缀；没有安全问题时继续跳过模拟，不补播错过的提问点、不使用本地问题。

BFF 返回 `preview_status`、`preview_diagnostic`（原因码、有效步数、目标步数、是否修复、Dify run ID）。`preview_repair.accepted_steps` 仅作下一次云端校验上下文，包含预演回答但不渲染；前端使用的 `round_question_plan.steps` 继续剥离回答。日志区分守卫拒绝和上游执行失败，HTTP 200 不代表整条链通过。

云端候选源码在 `tools/dify-workflow-mcp/workflows/preview/src/`，构建器为 `scripts/prepare-preview-repair.mjs`。该次本地实现尚未完成云端发布确认；控制台认证状态可能变化，不再以历史 401 判断当前连接。合并前先读取现有云端草稿和 hash，只更新经确认的节点。

乘客气泡对主持人回复的最短等待为 1500ms：接口返回较快时只等剩余时间，已经等待超过 1.5 秒则不额外等待。主持人话术气泡也至少显示 1500ms；后续气泡不会在这段保护期内将其挤掉，原有优先级仲裁保持不变。

| 时机 | 后台请求 |
| --- | --- |
| 首次进入准备页或刷新 | 本局第 1 题的提问链 |
| 进入第 N 题 | 第 N+1 题的提问链；最后一题不再请求本局下一题 |
| 进入结算页 | 当前体验线的下一局第 1 题 |
| 从结算页点击继续挑战 | 复用已请求的首题，包含仍在进行的请求 |

题目继续使用现有顺序：首题由体验线决定，其后按题库顺序轮转。预演请求时同时锁定目标局、题号、题目和自动事件模板，进入目标题时使用同一份记录。准备页改变体验线或环境导致首题变化时取消旧记录并重取；游戏进行中的环境变化不会改动已确定的题目。

预演完全不占用主持人的问答锁，不阻塞开题、题号动画、90 秒倒计时或玩家问答。尚未完成、失败、无有效计划或计划已用完时，跳过该次模拟乘客提问，不使用本地问题库。计划晚到时仅在匹配题目且未暂停时装入；后续自动提问时使用剩余步骤，并跳过已问问题及已覆盖事实，不补播已错过的时间点。

急刹、答对、超时仍使旧聊天、情境回复和待播话术失效，但保留纯提问预演。暂停期间返回的结果只缓存，恢复或进入目标题后才使用。换局、重置和替换首题通过缓存身份及局/题/题目校验拒绝旧返回。缓存中的 Promise、AbortController 放在运行时 Map，不进入 `DEFAULT_STATE`。

主持人只在 `route=chat` 的实际问答等待期间启动思考动画，沿用 300ms 的启动延迟和单次播完规则。预演、情境 Workflow、本地开场都不触发思考。刷新后准备第 1 题新局，但继续复用同源的全局 Dify 会话及用户 ID。

该轮修改为本地前端和文档，未修改 Dify 云端应用。已通过 14 项前端/BFF 回归以及 Chrome 挂起预演请求的实际页面验证；模拟请求验证不代表云端提问预演的内容质量或发布状态已通过验收。

## 会话与状态

历史记录（2026-10-17，已被后续主持人可靠性发布替代）：当时全局会话与换题修复的草稿/发布 hash 为 `0fd5cef582870f78a642fc49676aacb449a865513fa6b533be81e9fb2ccaf0db`，workflow ID 为 `da146116-d525-48ca-8b6c-28457b054404`。当前主持人 hash 见交接文档，不要将此历史 hash 当作最新版本。

回归中发现模型收到正确新题后，仍可能输出非 JSON 或直接说出当前谜底，导致守卫变成固定安抚话术。经确认后为主持人 LLM 启用 `dialogue-output.schema.json` 结构化输出，并要求属性问题仅回答所问属性、使用代词指代谜底；原防泄露守卫继续保留。草稿实测“安全带”揭晓后，同一会话切到“海豚”回答“不是，它不是人造的”，同时仍记得“小橙”称呼。

当时发布后本地 BFF 的五轮连续回归通过。后续主持人可靠性版本通过本地 BFF 又验证三次真实 API 请求，`context_verified=true`；最新证据及其范围见 [兜底诊断记录](DIFY_FALLBACK_DIAGNOSTICS.md)。前端/BFF 改动没有随 Dify 发布自动部署到 Vercel。

主持人使用现有 Chatflow 应用 `74bef8bd-22bd-4e19-91da-5e8d645dd8ed`。同一浏览器同源的 `user_id` 和 Dify `conversation_id` 持久化在 `localStorage`，跨题、新局和刷新持续复用；不同域名/端口、浏览器配置文件或清理站点数据会建立不同会话。旧版按题作用域存储的会话 ID 继续复用，不自动删除对话。

Chatflow 启用最近 10 轮的对话记忆，Dify 保留完整会话记录。前端的 `recent_messages`、`asked_questions` 和进度按 `round_id` 过滤，Chatflow 不把前端近期对话复制成第二份记忆。每次请求通过 `snapshot.round_context` 发送当前题与上次成功聊天的范围，换题/新局明确声明旧题结束、当前题快照优先。该标记进入系统上下文，不拼进玩家 `query`，不单独发起聊天。

当响应包含 `host_result.context_scope` 时，BFF 将其与本次请求范围核对，不匹配则拒绝；前端也会阻止旧题和 P0 前的迟到响应覆盖当前 UI 或会话 ID。兼容响应缺少可验证范围时标记 `context_verified=false`，不返回隐藏谜底字段。2026-10-17 最新发布版本的三次本地 BFF API 回归均 `context_verified=true`；较早发布 API 未暴露范围字段的历史测试不代表当前结果。全局会话仍保留旧题记忆，是否串题需用真实连续会话验证，不能只凭范围字段推断。

历史兼容说明：旧版曾使用 `cabin_snapshot` 会话变量和 `sync_state`。当前前端不再调用状态同步接口；Chatflow 与情境 Workflow 请求直接携带各自需要的最新快照。环境变化播报由本地 P1 负责，后台情境结果只更新决策面板。中控屏背景仍独立延迟 2 秒切换。优先级、气泡、动画和计时仍由前端管理。

## 动作权限

Chatflow 只能提出有类型的动作计划，不能直接操作浏览器 UI。当前前端执行白名单包括：

- `music.set_enabled`：权限设计允许所有乘客、所有游戏状态请求。当前守卫按明确的开/关表达确定布尔参数，覆盖模型可能返回的相反方向；“不要关闭音乐”不授权改变状态。前端执行并记录结果，全状态端到端验收见测试文档。
- `ambient_light.play_preset`：答对时的 `cabin-correct-light` 只作为 Chatflow 执行计划展示；实际仍由前端答对逻辑触发，不根据模型动作执行。

2026-10-18新增 `cabin.apply_sleep_comfort`：只用于本次仍睡着且尚未关怀的事件目标，最新规则为必须提出，空调调至用户记忆值；`cabin.restore_sleep_comfort` 只用于已醒且此前启用关怀的目标。最新快照携带 `car.sleep_comfort_seats`。两者均须附带灯光、空调、分区音量承接话术，前端收到后先排队，气泡真正显示时复核并执行模拟。醒来不立即恢复。情境静默时仍通过 `request_host_decision` 请求关怀话术，有效必启事件不因空动作而静默，由守卫补齐安全计划。普通对话照明仅开放明确分区开关，任意温度/音量和其他设备动作仍不开放。详见 [睡眠关怀](SLEEP_COMFORT.md)。提示/线索请求不能授权模型泄露谜底或隐藏提示；输出守卫负责拦截。

## 感知、决策、执行输出

实时 Chatflow 输出：

- `perception.schema_version: 2`：`signals` 只摘录本轮真实输入（乘客原话、环境前后值、车速、主驾状态及持续时长）。这些是模拟器上报值，不是传感器推断；`confidence` 为 `null`，不再固定生成 100% / 90% / 70%。缺失信号不补成“正常”。
- `decision_trace.schema_version: 2`：`decision` 记录实际分支选择或通过校验的 `reply_mode`，例如拒绝额外提示、回应新环境、闲聊后回到游戏。`layer` 标明处理路径，`selection_origin` 区分代码选择和模型回复方式；经过 LLM 不等于所有策略都由模型决定。不是模型隐含推理链。
- `execution.kind: plan`：白名单动作计划。仅保留前端执行权，不再统一生成“P1 等上一句结束”模板；是否排队由实际仲裁决定。

三栏公开展示“输入事实 / 具体选择 / 执行回执”，隐藏层级、规则编号、守卫 passed、优先级和通用降级模板。执行回执来自前端：气泡排队、显示、到期、被替换或取消；音乐等待启动、播放成功或被浏览器拦截；答对灯明确标记为“模拟播放”，不冒充真实车辆回执。没有动作计划不显示“无车辆动作计划”的填充语。

回执按独立记录 ID 绑定，旧异步结果只更新自己的记录，不覆盖当前面板；运行时保留最近 100 组回执索引。历史中的 `execution_receipts` 与原始输出分别保留。本地时间轴只展示实际游戏状态并标明非实时模型决策；预生成问答明确注明复用问答；旧版接口没有新版决策证据时显示“未提供可核验的决策记录”，不由前端替模型编理由。

P0 安全暂停/答对/超时/整局结束走确定性规则分支；其余事件经导演模型与输出守卫。前端保留急刹立即暂停兜底。超速仅在车速从 `<=120` 进入 `>120 km/h` 时触发一次 P1；主驾疲惫/睡着持续超过 15 秒后触发沿用的疲惫事件等级。

`输入标准化与 P0 预判` 负责解析输入、整理上下文并计算 `is_p0`；`P0 规则分支` 只读取该布尔值，将流程路由到确定性响应或模型节点。两者分别承担业务计算与流程分流。

## API 代理

前端只请求同源 `/api/workflow`。服务端使用 `DIFY_CHATFLOW_API_KEY`（兼容 `DIFY_API_KEY` 和按 app ID 配置的 `DIFY_WORKFLOW_API_KEYS`），密钥不放进浏览器。

聊天请求代理到 Dify `POST /v1/chat-messages`，传入玩家原话、当前快照、有效情境摘要、持久 `conversation_id` 与 `user_id`。情境和预演请求分别代理到 `POST /v1/workflows/run`。常规 `sync_state` 不再属于当前请求流程；请求字段、路由及大小限制以 `api/dify-bff.js` 为准。

## 草稿生成与发布

版本管理内的源文件在 `tools/dify-workflow-mcp/workflows/host/`：`base-workflow.yml` 保存基础节点结构，`src/` 保存 Python 逻辑与 `realtime-prompt.txt`。`tmp/dify-import/` 只存生成产物，不再作为生成脚本的输入来源。首次检出后先安装工具依赖，再生成并验证：

```sh
npm ci --prefix tools/dify-workflow-mcp
node tools/dify-workflow-mcp/scripts/build-host-chatflow.mjs
node -e "const fs=require('fs'),Y=require('./tools/dify-workflow-mcp/node_modules/yaml'); const f='tmp/dify-import/realtime-host-director-chatflow-v3.yml'; const document=Y.parse(fs.readFileSync(f,'utf8')); process.stdout.write(JSON.stringify([{file:f,document}]));" | python3 tools/dify-workflow-mcp/scripts/validate-dsl.py
```

Chatflow 草稿直接更新现有 app 的 workflow draft 接口，避免导入接口尝试新建应用。脚本会检查预览 hash、写入后回读校验；只改草稿、不发布：

```sh
node tools/dify-workflow-mcp/scripts/push-chatflow-draft.mjs <app-id> <expected-hash> tmp/dify-import/realtime-host-director-chatflow-v3.yml
```

只更新标准化、P0、输出守卫三个代码节点时加 `--code-only`，保留云端模型、提示词、会话变量和图布局。2026-10-06 本次可核验记录升级采用此方式；保留用户当前 `deepseek-flash` 模型。前端更新不会自动发布 Dify，运行 API 仍使用已发布版本。

2026-10-06 基础功能更新的草稿 hash 为 `09cc8c7695fb31628c5c93b4cb943add596dd4d094ec34bc51941c8433bc15a7`；后续真实性升级使用 `--code-only`，保存后回读 hash 为 `794d4f76add7c5c3cf2b04d195fa108caa7acdb7068c782905966965a43a54c5`。应用 ID 保持不变，两次操作均未发布。这些 hash 是当次验证记录，下次更新前必须重新读取，不能直接复用。运行 API 使用已发布版本，发布后再验收会话变量、事件和动作的完整链路。
