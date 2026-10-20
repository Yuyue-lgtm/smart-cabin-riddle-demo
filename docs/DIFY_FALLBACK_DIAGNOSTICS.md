# 主持人兜底诊断

## 本机链路优先检查（2026-10-20）

先执行 `node tools/dify.mjs doctor`，核对固定8081的后台SSH隧道、测试应用Key及环境绑定。隧道与模型问题分开定位；`502`且没有运行ID时，查看 `proxy_failure.stage/api_origin/error_name/error_code/cause_code`，不要据此猜测模型守卫失败。`diagnose-chatflow-run.mjs --latest`已直接显示该字段。完整连接配置和10次真实测试、1.7秒自动恢复证据见 [连接与诊断](DIFY_CONNECTION.md)。

## 阿里云生产排查入口（2026-10-20）

公开Demo现使用ECS自托管Dify，三套目标App ID及最近运行证据见[生产部署记录](ALIBABA_CLOUD_PRODUCTION.md)。本机Cloud连接器、日志目录与`--cloud`命令不会自动切换到ECS；不要把本机旧日志或Cloud运行当作线上刚发生的问题。

1. 先确认体验页面来源及`/api/health`的`runtime`、`workflow_proxy`中的三个App ID、`local_diagnostics.server_instance_id`。对照[Dify当前状态](DIFY_CURRENT_STATE.md)，区分本机Cloud、ECS生产或其他端口。
2. 线上请求先查ECS的`journalctl -u smart-cabin-demo`和服务目录`/opt/smart-cabin-demo/tmp/workflow-diagnostics.ndjson`（及轮转`.1`），按时间、`diagnostic_id`、`event_id`、`workflow_run_id`、局/题关联。日志使用字段白名单，不记录Key、原话或谜底；不要要求用户提供密钥或下载完整环境文件。
3. 如需原始节点执行详情，在正确的自托管Dify应用内，按对应run ID核对输入标准化、实际模型最终输出/推理字段、首次校验、单次重试及最终守卫。当前Cloud维护连接器未迁移为ECS连接器；现有Cloud刷新令牌不能当作ECS凭证使用。不能通过直接读数据库绕过认证。
4. 公网`POST /api/client-diagnostic`关闭并返回404，仅本地模式开放。健康信息`local_diagnostics.enabled=true`表示服务端有成功写入脱敏诊断，不代表向公网开放日志或已启用浏览器换题等待诊断。没有收到相应客户端记录时，不可编造前端阻塞结论。

`agent_backend`此前的ServerSettings失败已确认为Agent Stub专用密钥长度不合规，授权修复后运行正常、0次重启。它与“我陪你慢慢想”等模型守卫兜底不是同一个故障；修复Agent容器不能替代读取失败的Chatflow节点。另有换题保护已部署，但`context_verified=true`只证明返回范围匹配，不证明属性回答正确。两项的证据与保留问题见[修复与维护边界](ALIBABA_CLOUD_PRODUCTION.md#已知问题与维护边界)。

以上为已完成部署和代码核对结果，不代表本次文档整理重新登录服务器或测试了新一轮模型输出。下文为Cloud阶段的详细诊断方法，执行前先确认实例及权限。

## 2026-10-18 最新修复已发布

以 [可靠性修复与验收](DIFY_RELIABILITY_20261018.md) 和 [当前状态](DIFY_CURRENT_STATE.md) 为准。三个应用已发布并读回：推理字段分离，只解析最终文本，关闭提供商 JSON 模式和 Dify 原生提前解析；最终仍严格校验 JSON Schema、业务字段及安全约束，失败最多一次修正。已修复参与事件白名单和清醒状态表，诊断同时读取 `node.error` 与 `outputs.error_message`。49次草稿回归、13次发布API和真实浏览器环境串词验证通过。下面“未修改白名单”及JSON模式开启等表述是更早阶段的历史状态，不能用于当前配置。

## 2026-10-18：自动刷新与事件交接诊断

日志脚本此前绕过连接器，直接使用启动时读取的 Console token，收到401便报过期。现已统一调用 `src/index.mjs` 导出的 `requestConsoleJson`；认证实现位于 `src/console-client.mjs`。每次请求重读本机私有 `.env`，401后自动刷新一次并重试；刷新后的 access、CSRF、refresh cookie 原子写回，文件权限0600。文件锁协调不同诊断/连接器进程，避免同时使用同一刷新cookie，进程退出遗留锁可恢复。Cookie名称也会重读。

快速定位最近一次异常（无需玩家提供运行ID）：

```sh
node tools/dify-workflow-mcp/scripts/diagnose-chatflow-run.mjs --latest --cloud
```

该命令选择最新的聊天失败、模型重试耗尽或 `event_reply_skipped` 等守卫拒绝，读取原始运行和节点详情，并按 `event_id` 关联情境分析与Chatflow两段请求。`event_context.handoff_checks` 使用**这次运行保存的历史图**核对事件白名单、局/题/情境作用域、事件ID、发言申请和有效期；不拿当前草稿反推历史。摘要保存于忽略目录 `tmp/dify-diagnostics/<workflow_run_id>.json`（0600），不含密钥、玩家原话、谜底和模型思考原文。普通离线 `--latest` 仍可读取本地记录；新BFF日志同时保存事件输入校验是否有效及其状态。

认证排查顺序：先运行上述CLI；若MCP工具报401而CLI成功，说明**旧MCP进程仍缓存旧登录态**，继续用CLI共享客户端排查，不要让用户重复换Cookie。旧进程需要一次连接器重新连接后才加载本次客户端；现有终端诊断与更新脚本不受影响。只有共享客户端真正返回 `DIFY_REFRESH_SESSION_EXPIRED` 才表示刷新cookie被服务端拒绝，需要恢复一次登录。`DIFY_AUTH_COOKIE_MISMATCH` 表示Cookie名称不匹配；网络错误与这两种认证错误分别报告。

本次已实际读取运行 `41d980f0-e06e-4b4f-85fd-4a8bcd6d6f7a`：事件 `passenger_inactive` 在情境Workflow通过，但Chatflow入口 `event_dialogue.valid=false`。原始输入的事件ID、局/题/情境、ready状态与发言申请均一致，时间也未过期；该次运行历史图的 `SCENE_EVENTS` **没有 `passenger_inactive`**，因此被判为无效交接并清空话术。模型生成本身有效。此次仅修复认证/诊断能力和BFF分类，**尚未修改或发布云端事件白名单**，后续业务修复应以此证据为准。

本次61项本地测试通过，覆盖共享凭证轮换、并发刷新、旧环境重读、真正刷新失败、原始响应兼容、历史图事件识别、最新拒绝记录选择、BFF分类与日志脱敏。云端只读追踪已成功，未更改发布图。本地4186服务已重启加载新增日志字段。以下旧版认证操作以本节为准。

## 已确认与待确认

2026-10-17 本轮已取回三次实际兜底的原始节点记录：`cd25b122…`、`7de38769…` 的模型节点因仅输出思考段而结构化解析失败；`391a482f…` 虽标记成功，但最终文本仍只有思考段，`structured_output={}`。三次均由缺失最终回复引起。`invalid_strategy` 是空结果的后续校验错误；`missing_long_or_answer_leaking_reply` 是合并错误码，不能据此认定发生了谜底泄露。

## 模型输出恢复（已验证并发布）

2026-10-17 已发布主持人应用 `74bef8bd-22bd-4e19-91da-5e8d645dd8ed`，草稿与发布 hash 均为 `3b492aaae0b0f14b954e7c139928b62d6447fc1e333828dd65532738c34146bd`。本地43项前端/BFF测试、19项工作流节点测试通过；云端17项验收通过，其中原三条失败输入各重放三次均得到有效回复，三种故障注入符合一次重试/耗尽预期，五轮连续对话保留称呼并正确使用新题。

发布后通过本地4186代理的三个真实服务API请求再次验收：普通问答、同一会话换到“海豚”后的人造属性判断、提示婉拒均通过，`context_verified=true`、`model_output_status=valid`，本轮均无需重试。对应运行 `bd0b2663-2757-43ef-a09b-58c2b7e9255d`、`28aa9160-8cf8-4c6a-883a-8f237a9717da`、`332cf0de-ed3a-4d5c-b549-2ea64aef3175`。使用独立测试用户，没有重置真实玩家会话。本地日志已确认保存新增的模型尝试字段；本轮未部署Vercel前端/BFF。

- 主持人模型继续使用 `deepseek-flash`；显式配置 `thinking=true`、`reasoning_effort=low`、`response_format=json_object`、`max_tokens=4096`，保留 Dify JSON Schema。模型参数已按本工作区实际返回的 parameter-rules 核对；思考模式下不设置无效的 temperature。关闭思考的候选曾出现换题后属性误判，因此未发布该候选，改为低强度思考并再次验证。模型思考参数不影响前端等待期间的思考动画。
- `1000000000021` 优先校验非空 `structured_output`；兼容去掉完整思考段后的最终 JSON 文本。不会从思考段内提取答案或把思考内容展示给玩家。
- 仅思考、空结果、JSON 解析失败、缺少必填字段或字段类型不合格时，通过 `1000000000022` 调度一次重试模型 `1000000000023`。没有回环，也不叠加节点内自动重试：正常一次模型调用，异常最多两次。重试沿用当前题、同一会话和相同原话，不新增聊天轮次。
- `1000000000024` 保留两次尝试，`1000000000025` 选取最终结果后统一经过原有谜底、提示、事实键、乘员和动作守卫。P0 继续零模型调用。
- 两次均失败时，标记 `model_output_fallback` / `model_retry_exhausted`，使用请乘客重问的中性话术，按请求区分表达，不再把模型输出失败写成“我陪你慢慢想”。不补充属性事实，不声称已经答对，不放宽提示、暂停或动作权限。

响应 `diagnostic` 与本地日志新增 `model_output_status`、`model_retry_count`、`model_attempts`、`model_failure_reason_codes`。每次尝试包含来源、状态、原因码，区分 `think_only_output`、`empty_model_output`、`invalid_model_json` 及具体结构字段错误。节点摘要仍独立记录模型错误/结构化解析错误。恢复成功保留首次失败证据；重试耗尽可由 `--latest` 自动定位，无需手动找运行 ID。

本轮生成器与更新入口：

```sh
node tools/dify-workflow-mcp/scripts/build-parallel-host.mjs --dialogue-only
node tools/dify-workflow-mcp/scripts/update-dialogue-reliability.mjs prepare
node tools/dify-workflow-mcp/scripts/update-dialogue-reliability.mjs save
node tools/dify-workflow-mcp/scripts/verify-dialogue-reliability.mjs
node tools/dify-workflow-mcp/scripts/update-dialogue-reliability.mjs publish
```

更新器以最新云端图为基础，只补对话模型、守卫与恢复节点；保留其他节点和会话变量。测试将原失败输入各重放三次，并在草稿中暂时压低输出上限来验证重试成功和耗尽，最后恢复完整配置。发布要求验证报告与当前草稿 hash 一致。原始测试轨迹和报告位于被忽略的 `tmp/dify-import/dialogue-reliability/`，不加入版本控制。

参数依据：[Dify DeepSeek 模型参数](https://github.com/langgenius/dify-official-plugins/blob/main/models/deepseek/models/llm/deepseek-flash.yaml)、[DeepSeek JSON 输出说明](https://api-docs.deepseek.com/guides/json_mode/)。后者明确提示 JSON 模式仍可能返回空内容，因此不能只靠格式开关消除兜底。

## 既有约束兜底记录

“我陪你慢慢想，按你的节奏来。”由对话 Chatflow 的最终 `parallel_guard` 在约束冲突时写入。HTTP 200 只证明 Dify 成功返回结果，不能单凭这句话判定模型格式错误或谜底保护命中。此前两次线上记录没有守卫节点输出，具体触发项仍是**未确认**。

守卫记录 `debug.fallback_origin`、`debug.fallback_reason_codes` 和 `decision_trace.guard_reason_codes`。原因码区分邀请不合格乘员、没有有效目标/策略的邀请、玩家要求独立思考却被邀请、上游校验失败、暂停状态等。上游回复校验另记 `debug.validation_reason_codes`：模型 JSON 无效或为空、缺失回复、回复超过 60 字、回复中出现当前谜底。原有 `validation_errors` 保留；模型输出失败采用上方的新恢复路径，其他约束仍由原守卫执行。

2026-10-17 已核对并发布主持人 Chatflow 守卫节点 `1000000000006` 的原因码，发布 hash 为 `9a994899ce17ac870fac27c71110b1a1886760d4a12581ec6db0ee9c7135080b`。发布前两次实际 API 运行 `75a60bfa-3989-40d3-ac56-e883d315759e`、`fbd4c199-2013-4b5d-babb-b318d8c58b62` 的 LLM 节点均标记成功，但只输出 `<think>…</think>`，没有 JSON 或 `ai_reply_text`；第一层守卫记 `missing_long_or_answer_leaking_reply`，第二层因上游校验失败改为固定兜底。另一次运行 `0a0d9d4a-ad5a-40ef-b019-1643a7132a61` 的 LLM 节点报 `Failed to parse structured output`，随后也进入同一兜底链。HTTP 200 表示工作流按降级路径完成，不能说明模型回答有效。旧运行没有新原因码，但这三次的 LLM/守卫节点输出已足够区分触发路径；不能推断其他未检查的运行也由同一原因造成。

## 每次测试如何留证

本地服务会将脱敏后的请求关联、Dify `workflow_run_id`、守卫原因码和耗时追加到 `tmp/workflow-diagnostics.ndjson`，文件权限为仅当前用户可读写，超过 2 MB 会轮转。不会持久化玩家原话、谜底、对话历史或主持人回复正文。报告问题时无需手动提供运行 ID；直接查看最近一次记录即可：

```sh
node tools/dify-workflow-mcp/scripts/diagnose-chatflow-run.mjs --latest
```

该命令自动选择最近一条发生兜底/失败的 Chatflow 请求（包含轮转日志及未获得运行 ID 的网络失败），默认读取本地已保存的守卫原因和 SSE 模型节点摘要，不需要控制台登录令牌。摘要可区分空输出、仅思考标签、JSON 输出和结构化解析失败，不保存模型原文。SSE 未提供节点输出时标为 `unavailable`，不能据此认定模型输出为空。完整云端节点详情使用 `--latest --cloud`，共享客户端在401后自动刷新；仅刷新cookie被拒绝时需要按本文开头恢复登录，不要把令牌发送到聊天中。

本地服务器启动时立即写入 `server_start`，`/api/health.local_diagnostics` 返回当前实例、启动时间、日志版本、最近写入时间及错误码。只有实际写入成功后 `enabled` 才为 `true`。请求完成日志同时保留事件、局号和题号，便于关联。首次启用日志或更新 Node 服务代码需要重启实际使用端口上的 `node dev-server.cjs`；只刷新网页不会重新加载服务端代码。

答对后未推进属于浏览器运行状态问题时，另查下方“前端答对后未推进诊断”。`diagnose-chatflow-run.mjs --latest` 选择的是工作流异常，不会自动选择前端等待记录。

1. 优先运行 `node tools/dify-workflow-mcp/scripts/diagnose-chatflow-run.mjs --latest`，自动定位最近一条兜底/失败 Chatflow 记录，并读取本地证据。
2. 若 `diagnostic.status=reason_recorded`，查看 `reason_codes`、`validation_reason_codes`、`validation_errors`。只有这些字段来自结构化守卫结果时，才可以确认触发原因。
3. 若固定话术返回但状态为 `reason_unavailable`，在配置了**本机私有** Dify 控制台登录令牌后运行：

   ```sh
   node tools/dify-workflow-mcp/scripts/diagnose-chatflow-run.mjs <workflow_run_id>
   ```

   工具只读 Dify 控制台的本次运行及节点执行记录，打印守卫原因、LLM 节点状态和耗时，不打印模型原文、谜底或凭证。自动刷新失败、没有运行 ID、节点输出不可读时，结论必须写“原因未取回”，不能把固定话术反推为某一种守卫错误。
4. 云端草稿回归可运行 `node tools/dify-workflow-mcp/scripts/test-parallel-cloud.mjs ...`；摘要会保存诊断字段。固定兜底但没有原因时，测试会失败。发布 API 的测试仍应按第 1–3 步核对，草稿成功不代表发布版本已经更新。

发布版 API 的 SSE 在 JSON 数据中携带事件类型。本地 BFF 已兼容这种格式以读取 `workflow_run_id` 和 `node_finished.host_result`；若 Dify 对某次运行只返回最终 `answer`，仍可能标为 `source=dify_answer_only`、`reason_unavailable`，这时用运行 ID 查询节点记录。更新云端时只同步必要节点并校验草稿 hash，不用旧 DSL 覆盖其他节点。

诊断查询只在测试或事后排查时进行，不加入玩家问答的关键路径，也不延长气泡、思考动画或出声时间。

## 前端答对后未推进诊断（2026-10-19）

本机开发服务新增 `POST /api/client-diagnostic`，将浏览器记录追加到同一日志，`phase=client_runtime`。页面健康状态须为 `runtime=local`；直接打开 HTML、云端页面及未加载新接口的旧服务不能采集这一类记录。更新服务端代码后重启实际端口的 Node 进程并刷新页面，再复现问题。此次本地验收端口为 `4187`，不代表其他端口已重启。

| `client_diagnostic.type` | 记录时机与含义 |
| --- | --- |
| `round_advance_started` | 安排答对后的下一题调度；随后仍等待原揭晓展示时段 |
| `round_advance_wait` | 下一题检查被某项条件阻塞；首次、阻塞原因变化时记录，持续相同原因最多每 5 秒一次 |
| `round_advance_completed` | 等待检查已通过，接下来切下一题或整局结算；不等于所有待播话术均已显示 |

按 `game_id`、`round_id` 与附近 `phase=start/finish` 的工作流记录关联。时间戳为 UTC；`wait_duration_ms` 在等待记录中表示从首次阻塞起的真实耗时。快速查看：

```sh
rg '"phase":"client_runtime"' tmp/workflow-diagnostics.ndjson | tail -20
```

等待原因对应当前 `advanceAfterVictory()` 的检查条件：

| `blockers` 项 | 当前条件 |
| --- | --- |
| `timeline_paused` | 时间轴处于暂停状态 |
| `workflow_in_flight` | 前端仍标记主持请求未结束 |
| `deferred_chat_reply` | 当前题仍有来源为 `chat`、`passenger_question` 或 `workflow_fallback` 的待播回答 |
| `chat_speech_active` | 上述乘客回答仍处于气泡展示期 |
| `result_feedback_not_shown` | 答后反馈对象存在且尚未标记已提交展示 |
| `post_result_feedback_active` | 答后反馈已成为当前话术，展示期尚未结束 |

快照还记录当前题全部待播话术数量/来源、待处理乘客问题数量、话术锁剩余时长、答后反馈剩余窗口、最短气泡保护及模拟暂停状态。服务端按白名单落盘，限制字符串、数组及数值范围，不包含玩家原话、谜底、气泡正文、模型输出或密钥；未知话术来源记为 `other`。

解读快照时保留以下边界：`deferred_reply_count` 包含当前题的全部来源，不等于 `deferred_chat_reply` 阻塞数；答后反馈 `shown` 表示已交给话术发布逻辑，仍可能在队列中；`next_round_timer_active` 是检查回调内的瞬时值，回调会先清空引用再安排重试，不能仅凭 `false` 断定计时器丢失。模型请求全部完成也不能单独证明画面或下一题已推进。

此次新增诊断没有确认旧卡住会话内部的具体阻塞项。后续体验日志已观察到第 1→2→3 题的调度检查通过，题号提示缺失则另外由浏览器复现并修复，详见 [测试记录](TEST_SCRIPT.md)。
# 当前日常维护：阿里云测试环境（2026-10-20）

本机Demo当前连接独立ECS测试应用，入口4175；Cloud只保留历史。先运行 `node tools/dify.mjs status` 核对目标，管理会话使用独立 `.env.ecs` 自动刷新，不再要求每次粘贴Cloud Cookie。若确实被撤销，使用 `node tools/dify.mjs login` 的本机表单重新登录，密码不保存。

新维护代码入口为 `tools/dify-workflow-mcp/src/ecs-console.mjs` 的 `createEcsConsole()`，从 `dify/environments.json` 选择测试/正式App ID后读取 `/apps/<id>/workflow-runs/<run_id>` 与 `/node-executions`。旧Cloud连接器和下文 `--cloud` 命令不能用来读取ECS运行ID；已驻留的旧MCP进程也可能缓存Cloud配置，不应继续用于日常写操作。

发布流程会将本次虚构回归的run ID、失败阶段与只含白名单字段的报告保存在版本目录，不把Cookie、Key或密码写入日志。完整命令、例外和保留问题见 [DIFY_ECS_ITERATION.md](DIFY_ECS_ITERATION.md)。
