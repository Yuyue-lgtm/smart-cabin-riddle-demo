# Dify 当前状态与子对话交接

## 2026-10-19 最新主持人权限更新

玩家明确要求暂停/继续时，前端以受限动作 `game.set_paused` 执行；输入框继续模拟口述，不含麦克风识别。主持人 Chatflow 已发布并读回，当前 hash 为 `5fd8948bda460cb725b10b271ddfa51c33976fc1a6bab66bcee9a3481ee3d6d0`。守卫核对玩家原话、游戏/题目范围及安全暂停状态，模型不能自行暂停或越过安全暂停。前端暂停保留当前题、事实、问题数和剩余倒计时；恢复后接续原进度。情境 Workflow 和提问预演 Workflow 未修改。六题配置及 153 项本地回归见 [游戏暂停权限与六题配置](GAME_CONTROL_AND_SIX_ROUNDS.md)。

最后核对：2026-10-18。本文是开始 Dify 相关子对话时的状态入口；发布 hash 是最近一次有记录的云端状态，执行任何写操作前仍必须实时读取目标应用并确认草稿 hash。

同日最新应景开场增量：[下一题应景与开场串词](ENVIRONMENT_AWARE_RIDDLES.md)。实际应景题出现第N题时，以受限`operation=environment_round_intro`直接请求现有Chatflow的`round_changed`事件回应，不再多跑情境分析。BFF确定性校验并构造一次性规则指导，不缓存、不绕过原普通情境签名。每题一次、P3、开题6秒窗口，问答先到/P0/换题/环境变化即取消未播结果；失败不补固定话术，不播思考动画，不更新事实/游戏/设备。142项本地单元、真实发布API独立会话三种环境及Chrome→本地BFF→Chatflow链路通过，未保存或发布任何Dify应用。4186服务已重启，健康标记`environment_round_intro=true`；脚本缓存`20261018-environment-round-intro-v1`。未部署线上。

同日最新选题增量：[下一题应景](ENVIRONMENT_AWARE_RIDDLES.md)。环境稳定800ms后优先选择本局未出过的相关题，当前题/事实/次数保持不变；题目实际变化才取消旧预演、按新题快照请求，保留单题时间轴。答对和超时换题前锁定最新选题，不等预演，不用本地问题。下一局第一题预取保持原逻辑。130项单元测试及选题/完整暂停/事件队列浏览器回归通过，网络使用桩。只改前端，不改三个Dify应用/BFF协议，不部署线上；脚本缓存 `20261018-environment-next-riddle-v1`。

同日最新前端增量：[暂停模拟完整冻结](SIMULATION_FREEZE.md)。三分区的气泡、计时、人物、彩带、CSS动效与音频一起暂停；Dify结果与资源回调等待继续模拟后应用。只冻结本地模拟时间，云端签名有效期仍按真实时间验证。117项本地回归、Chrome游戏/结算逐像素冻结及安全恢复测试通过。缓存版本 `20261018-full-simulation-freeze-v1`；Dify云端hash和BFF协议不变，未部署线上。

同日最新前端修复：真实体验出现“第2题超时揭晓后420ms急刹”，API均正常，原急刹恢复误设playing且丢失下一题计时器，导致卡住。现保存 `safetyResumeContext`，4.5秒后恢复原状态及揭晓后的下一题调度；92项本地回归通过，浏览器复现链路验证。只改前端与测试，Dify云端hash、知识库和代理未再修改。脚本缓存版本 `20261018-safety-reveal-recovery-v1`，旧页面刷新后生效。详情见 `TEST_SCRIPT.md` 最新章节。

2026-10-18最新 [座舱情境协同规则](CABIN_SCENARIO_POLICY.md) 已在主持Chatflow与情境Workflow发布并读回，hash见下表；预演应用未改。求助只复述 `game.public_clues` 中实际已展示内容；普通对话允许明确分区灯光，未开放普通空调、ETA、换主题等能力。最新增量：有效入睡且目标尚未关怀时必须启用，不再自主选择静默；关灯、分区音量0、空调调至“用户记忆值”，覆盖同日早先的关闭空调规则。漏动作/错误设备描述由有效事件的确定性守卫补齐安全话术与目标动作，仍等气泡开始显示才执行。醒来随承接话术恢复睡前设置。共用感知映射补齐 `driver_distracted`，显示主驾状态“分心”，不再退回“收到座舱事件”。经验HK05更新4.1且已索引，其他云端经验保留当前版本。92项本地回归、37项座舱节点规则、37项睡眠守卫及浏览器事件链通过；最终草稿14次主持运行与5次情境运行通过。模型配置、全局会话、图结构和预演保持不变。

当前维护入口是 `update-cabin-policy.mjs status / prepare / save / verify / publish`，基于实时hash定点更新并同步完整DSL。不要使用旧睡眠补丁或早期生成器覆盖当前图、移除 `cabin_policy_input.py / cabin_policy_guard.py` 包装层。前端和BFF只在本地4186更新，未部署Vercel、未提交Git。

2026-10-18 最新可靠性修复已在三个应用发布并读回：[完整根因、配置与验收](DIFY_RELIABILITY_20261018.md)。推理与最终文本分离，移除提供商 JSON 模式及 Dify 原生提前解析，最终文本仍严格校验 JSON Schema 和业务守卫；字段冲突同样可以修复一次。已同步 `passenger_inactive` 白名单与真实清醒状态。49次云端草稿回归通过，其中44次正常运行和5次故障注入。下方旧日期记录仅为历史。

日志脚本复用共享Console自动刷新客户端，并按事件关联情境/Chatflow请求、检查历史运行图。遇到401先运行 `node tools/dify-workflow-mcp/scripts/diagnose-chatflow-run.mjs --latest --cloud`，不要直接要求用户更换Cookie；旧MCP进程可能只缓存了旧令牌，CLI仍可正常访问。详见 [兜底诊断](DIFY_FALLBACK_DIAGNOSTICS.md)。

2026-10-17新增主持经验v2：原知识库已更新并索引27条完整经验；首批成就反馈与主持偏好已接入，详见 [主持经验v2](HOST_EXPERIENCES_V2.md)。预演应用未改。

2026-10-17最新增量已发布并读回：事件改为 [情境分析→前端→Chatflow](SITUATION_DIALOGUE_ROUTING.md)。情境不再生成话术，P1走零模型/零检索规则；前端自动接续Chatflow，保留全局会话、P0本地执行和结果失效保护。原“本地环境短句＋后台分析”已替代。

2026-10-18验收：真实副驾未参与场景在情境 Workflow 中检索到HK28并申请邀请；经本地BFF接续Chatflow后守卫通过，话术自然且不提沉默时长。前端快照版本测试、缺失参与状态/错误版本守卫测试、睡眠/拒绝/近期输入静默测试均通过。运行记录：Dify 情境 `468a70ca-6ebc-4dac-9ab3-29b7e799f3f0`、Chatflow `571949ca-1ed8-4461-92bf-d3cfadee0b5c`；本地BFF另验证成功，详情在 `tmp/dify-import/situation-dialogue/api-verification.json`。未部署Vercel。

2026-10-18副驾长期未参与仍无主持人回应的修复已发布：前端精简 Chatflow 快照曾漏传 `participation`，Dify `clean_snapshot` 又会过滤该字段；同时检索映射和多个模型校验节点只认识 HK01–HK27。现已端到端补齐状态/版本、失败原因、HK28低压力邀请经验和全部守卫白名单。知识库28条均已索引；真实 Dify 草稿与本地 `/api/workflow` 回归均通过。详细记录见 [主持经验库 v3](HOST_EXPERIENCES_V2.md)。

## 当前云端应用

同日面板显示增量：融合决策现在显示同时感知事件、前端优先级标签、等待/先行原因，以及当前回应和下一批待办。保留原模型分析和设备回执，空决策阶段不提前显示执行。112项本地回归及桌面/小窗口浏览器验证通过；脚本/样式缓存版本 `20261018-priority-panel-v1`。仅前端展示变化，Dify及BFF规则不改。详见 [HOST_EVENT_QUEUE.md](HOST_EVENT_QUEUE.md)。

同日多事件增量：已执行 [主持人多事件队列](HOST_EVENT_QUEUE.md)。不同座位事件独立、P1–P4优先级＋同级FIFO，非P0不打断当前气泡；无关状态变化不直接取消事件，必要时重分析取得最新签名；P0保留待办意图但拒绝旧结果。设备每事件去重。脚本缓存版本 `20261018-event-priority-queue-v1`，本次不改Dify/BFF发布版本。

同日最新纯前端增量：手动“乘客醒来”不再固定向右后座发送事件，每次选择仍睡着的目标（优先当前选中睡眠座位，否则后排右、后排左、副驾、主驾）。无人睡着不重复请求；4秒冷却和主持承接后恢复设备不变。脚本缓存版本 `20261018-manual-wake-target-v1`，Dify发布hash不变。

| 用途 | App ID | 最近记录的云端状态 | 本地入口 |
| --- | --- | --- | --- |
| 实时主持 Chatflow | `74bef8bd-22bd-4e19-91da-5e8d645dd8ed` | 已发布并读回；hash：`5fd8948bda460cb725b10b271ddfa51c33976fc1a6bab66bcee9a3481ee3d6d0`；新增受限 `game.set_paused` 玩家暂停/继续权限；保留睡眠关怀、主驾分心、结构化输出与HK28守卫 | `workflows/parallel/host-dialogue-v4.yml`、`workflows/host/src/` |
| 情境分析 Workflow | `bc1ce5be-d5c5-4885-84c5-72c2c1f63d18` | 已发布并读回；hash：`b3e1a2f11479a7b4aa9ac24dc001aa458b4a7df7e84aa7f18fd66f4219e9194a`；修复主驾分心感知映射；保留HK28检索与现有分支 | `workflows/parallel/cabin-situation-v1.yml`、`workflows/host/src/scene_*.py` |
| 提问预演 Workflow | `bf81cd44-a49f-4048-901f-e95e941dc429` | 已发布并读回；hash：`78c269cb39c01529f7c71392ca14011e9e12a4c727130c62365147e52ea67a99`；显式非思考、6144上限，保留安全前缀与一次修复 | `workflows/preview/question-preview-v1.yml`、`scripts/prepare-preview-repair.mjs` |

三个应用已发布并回读；本轮原环境输入连续6次首次输出有效，另强制验证首次与重试均有效、字段冲突修复、截断/异常恢复及耗尽处理。本地64项前端/BFF测试、13项预演守卫测试和18个代码节点契约检查通过。发布后真实浏览器经情境→BFF→Chatflow显示环境话术，约5.9秒，无页面异常；浏览器测试仅预演使用桩，主持/情境均为真实发布API。详细验收以新报告为准。`/api/health`的Key已配置只说明可调用，不代表Console可编辑或草稿已发布。

## 请求与权限边界

浏览器只请求同源 `POST /api/workflow`，Dify API Key 保存在服务端环境变量。BFF 路由如下：

| 请求 | Dify 路由 | 前端所有权 |
| --- | --- | --- |
| 玩家/模拟乘客提问 | `route=chat` → Chatflow `/v1/chat-messages` | 前端控制思考状态、气泡、最短显示时长及优先级；Chatflow 只建议话术/动作 |
| 应景题开场 | `route=chat, operation=environment_round_intro` → BFF校验主题/环境及未开始问答 → 现有Chatflow事件回应 | 每题一次P3，开题6秒窗口；不思考、不改变事实/游戏/设备，问答先到或过晚静默 |
| 座舱重要事件 | `route=situation` → 分析；有效发言请求自动接续 `route=chat, operation=situation_reply` | P1环境/超速/疲惫规则快速分析；Chatflow生成话术；前端负责有效期和优先级。P0仅后台记录 |
| 揭晓后成绩反馈 | `post_result_feedback` → 成就分析/检索 → Chatflow表达 | 同局同题P0结束后以P4反馈，沿用限频、去重、窗口和事实兜底，不缓存到后续聊天 |
| 每题乘客问题预演 | `route=preview` → 提问预演 Workflow | 预演只提供该题的乘客问题计划；不替代主持人实时回答。没有可用计划时跳过自动乘客问题，不使用本地题目兜底 |
| 未知事件 | `route=skipped` | 不得自动转发到普通 Chatflow |

每次相关请求携带当前快照与 `game_id`、`round_id`、`scene_version`；事件使用独立 `event.id`。普通车速更新不调用模型。前端已停用常规 `sync_state`，不依赖 `cabin_snapshot` 会话变量；Chatflow 与情境请求各自携带最新所需快照。P0 的本地安全暂停、答对、超时及整局结束不等待模型，后台分析不能改变游戏状态或覆盖 P0 话术。

同一浏览器同源的 `user_id` 与 Dify `conversation_id` 存在 `localStorage`，跨题、新局、刷新继续复用；不同来源/端口/浏览器配置是不同会话。每题前端上下文显式声明旧题结束和当前快照优先，避免把上一题的谜底/属性用于新题。

情境结果以服务端签名的 `situation_handoff` 交给前端，第二次请求带回凭据；BFF验证用户、事件、优先级、局、题、情境版本及有效期后才调用Chatflow，不依赖两次请求命中同一进程。前端接受、排队及播放前再次验证。情境串词不改变游戏状态、事实或乘客，不播放思考动画。情境设备动作仅开放有效睡眠事件的必启关怀和醒来恢复，均需目标条件有效、附带设备说明，并在气泡实际显示时执行模拟；普通聊天另允许明确背景音乐和分区灯光，其他设备不得执行。临时打断只后台记录；主驾分心/疲惫为安全提醒。`/api/health` 的 `workflow_proxy.situation_dialogue_protocol=serial-v1` 表示本地BFF已加载串行协议。

提问预演仍生成 `host_reply_text` 供云端守卫与修复使用，但前端不播放回答，只消费问题、事实键、依赖；真实主持人回答仍请求 Chatflow。修复必须使用 BFF 返回的 `preview_repair` 完整信封，不能从移除了主持回答的展示计划自行重组。修复后仍不完整时保留安全前缀，不无限修复；再次迭代前仍需实时检查云端版本。

## 主持人当前可靠性配置

当前发布模型为 `deepseek-flash`：主模型 `thinking=true / reasoning_effort=low`，重试模型 `thinking=false`，两者 `max_tokens=4096 / reasoning_format=separated`。提供商 `response_format` 不配置，Dify LLM 节点 `structured_output_enabled=false`，不进行原生提前解析；代码只解析最终 `text`，继续严格校验同一份 JSON Schema 和最终业务守卫。关闭思考的主模型候选出现过语义误判，未采用。思考文本不得进入玩家话术或对话记忆。情境/预演模型显式非思考并保留一次节点异常重试。

Chatflow 正常只调用一次模型。模型输出为空、只有思考内容、无法解析、不符合结构或未通过业务预检时，在同一次 Chatflow 执行内最多再调用一次；重试沿用当前题快照、玩家原话及安全约束，并收到具体失败原因。第二次失败明确记录耗尽：普通问答请重问，情境回应静默，不反复使用固定安抚话术，也不推进谜底事实。所有结果继续经过既有提示拒绝、谜底防泄露、游戏状态及动作白名单守卫。P0 确定性分支不进入模型重试。

诊断输出包含 `model_output_status`、`model_retry_count`、`model_attempts`、`model_failure_reason_codes`，区分 `structured_output`、旧文本解析和无输出来源；本地诊断日志不保存任意原始模型 payload。HTTP 200 只说明 BFF/工作流按某条路径完成，不代表主持人模型输出有效。

## 环境配置

Demo 服务端的本地 `.env.local` 支持：

```dotenv
DIFY_CHATFLOW_API_KEY=...
DIFY_CHATFLOW_APP_ID=74bef8bd-22bd-4e19-91da-5e8d645dd8ed
DIFY_SITUATION_API_KEY=...
DIFY_SITUATION_APP_ID=bc1ce5be-d5c5-4885-84c5-72c2c1f63d18
DIFY_PREVIEW_API_KEY=...
DIFY_PREVIEW_APP_ID=bf81cd44-a49f-4048-901f-e95e941dc429
```

也可用 `DIFY_WORKFLOW_API_KEYS` JSON 对象按 App ID 映射 API Key；主持人还兼容 `DIFY_API_KEY`。不要把 API Key、Console token、Cookie 或 CSRF 值写入文档、前端或 Git。MCP 管理连接的独立凭证位于 `tools/dify-workflow-mcp/.env`，与 Demo API Key 分开。共享客户端每次重读私有文件并在401时自动刷新；终端诊断可直接运行。旧MCP进程一次重连后加载新客户端。仅当刷新cookie也被拒绝时才需手工恢复登录；浏览器登录状态不等于MCP已认证。

## 后续 Dify 迭代流程

1. 先读本文，再读 [双路并行方案](DIFY_PARALLEL_HOST.md)、[兜底诊断](DIFY_FALLBACK_DIAGNOSTICS.md) 和对应应用的源文件。
2. 通过 MCP 或终端的 `requestConsoleJson` 共享客户端读取目标应用当前草稿、hash、发布版本及节点。MCP旧进程报401时优先用终端客户端验证，避免反复让用户更新Cookie。不要使用本文历史 hash 直接覆盖云端，也不要从过期的 `tmp/` DSL 恢复整个图。
3. 明确只修改的节点和保留的特征、Memory、知识库绑定、会话变量、边与布局；优先应用当前生成器/定点补丁，避免重建时覆盖云端后来改动。
4. 保存草稿后立即回读并核对图与目标 hash。用原失败输入或针对性场景验证；对话可靠性发布必须运行：

   ```sh
   node tools/dify-workflow-mcp/scripts/update-structured-reliability.mjs status
   node tools/dify-workflow-mcp/scripts/update-structured-reliability.mjs prepare
   node tools/dify-workflow-mcp/scripts/update-structured-reliability.mjs save
   node tools/dify-workflow-mcp/scripts/verify-structured-reliability.mjs
   node tools/dify-workflow-mcp/scripts/update-structured-reliability.mjs publish
   node tools/dify-workflow-mcp/scripts/update-structured-reliability.mjs sync-local
   node tools/dify-workflow-mcp/scripts/verify-structured-reliability-api.mjs
   ```

   `publish` 仅在当前草稿 hash 与通过的 `verification.json` 一致时允许发布。仅要检查对话失败日志时运行 `node tools/dify-workflow-mcp/scripts/diagnose-chatflow-run.mjs --latest`；要读取云端节点原始 trace 时加 `--cloud`。无需让用户先手动提供 run ID。
5. 发布后读回已发布版本，并通过本地 BFF 验证实际 API。只更新文档记录实际发布 hash、验证日期、测试结果及哪些应用未改。

当前这次工作没有部署 Vercel，也没有创建 Git commit。Demo 前端/BFF 和 Dify 发布是分开的发布面。

## 权威细节

- [DIFY_RELIABILITY_20261018.md](DIFY_RELIABILITY_20261018.md)：最新模型配置、真实失败根因、49次云端回归和维护命令。
- [DIFY_CHATFLOW_INTEGRATION.md](DIFY_CHATFLOW_INTEGRATION.md)：前端接入、上下文、会话及动作权限。
- [DIFY_PARALLEL_HOST.md](DIFY_PARALLEL_HOST.md)：Chatflow、情境及预演工作流职责、输入输出契约。
- [DIFY_FALLBACK_DIAGNOSTICS.md](DIFY_FALLBACK_DIAGNOSTICS.md)：失败根因、模型参数、重试、日志与本次验收结果。
- [HOST_KNOWHOW_IMPLEMENTATION.md](HOST_KNOWHOW_IMPLEMENTATION.md)：主持人经验库/Know-how 的实现边界与本地改动。
- [REALTIME_HOST_CONTEXT.md](REALTIME_HOST_CONTEXT.md)：当前游戏上下文与前端状态边界。
- [TEST_SCRIPT.md](TEST_SCRIPT.md)：复测命令和用户流程。
- `tools/dify-workflow-mcp/README.md`：本地 Dify 管理连接器的认证及操作方式。
