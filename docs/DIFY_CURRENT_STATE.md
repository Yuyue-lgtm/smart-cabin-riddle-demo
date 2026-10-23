# Dify 当前状态与子对话交接

## 2026-10-23 赛前候选版正式同步

用户批准近期网页/BFF/资源、测试主持人已发布草稿及黄金线经验一起上线。Dify正式发布版本`2026-10-23T06-18-41-925Z-ecs`，测试和正式草稿各12项真实回归及HK28检索通过；新测试库`8bde5f27-73f8-43dd-adae-1b34d20625bf`、新正式库`ef99372e-418d-4757-a2d7-88ea255decdd`，均28条，原库保留，三App ID/API Key不变。此次也将HK10与当前前端/工作流六题门槛对齐，避免保留旧四/六题不一致。

网页已上线`V1.4.2-competition-candidate`，源提交`ced32f1`，118文件包`2026-10-23T06-27-35-230Z-70dd184903d3`；原网页备份`/root/cabinplay-backups/20261023T063421Z-voice`。111公开文件哈希、健康/就绪、HTTPS、音频Range和私有路径检查、382项Node回归及21组线上QA均通过；真实问答/情境/预演、答案快通道和一次完整合成播放通过。Safari单独验收范围与自动化限制、全部证据及剩余边界见[发布测试记录](RELEASE_QA_2026-10-23.md)。下文“本地补充/尚未写入”及“只发布测试”等段落是之前历史，不再代表当前是否上线。

## 2026-10-23 黄金线主持经验本地补充

保留28个经验ID，HK01–HK09、HK24–HK26、HK28共13条补强至5.0；JSONL为唯一编辑源，上传Markdown已同步。覆盖公开线索复述/独立思考、实时身份协作、睡眠记忆温度与恢复、九种环境、超速/疲惫、多事件打断、到达收尾和轻声接梗。HK10–HK23、HK27原文保持不变。另修正HK02默认策略与既有守卫的冲突，并让旧维护入口只导出，避免把新经验回写成4.0。

新增10项经验契约测试及现有座舱/黄金线回归共40项通过，全部当前Node回归373项通过；真实检索整理代码可完整解析28条。历史v3检查脚本仍在27条旧断言处失败，已记录，未重建历史DSL。未修改前端/BFF、应用图、模型、Memory、权限或检索路由。ECS维护读取先报 `fetch failed`，项目通道探测报 `ECS_TUNNEL_UNAVAILABLE`（8081），因此测试知识库和正式知识库均未写入；不得称本轮已生效或已测云端生成/延迟。后续仅先同步独立测试库，不能用旧Cloud脚本或正式库代替。可读覆盖说明与待验收项见 [黄金线经验补充](HOST_KNOWHOW_GOLDEN_LINES.md)。

## 2026-10-22 测试主持人答案优先确认

已发布到测试主持人 `b8bff994-d397-484e-8ccd-11851e6cc460`，hash：`ab19253b7be67ffab5c192bb62b2b8fbef6645afe6a8ee51cfc79d4b64407fb4`。正式版、其他工作流、知识库和模型参数未改；保留之前的口吻优化和温度 1.8。本地网页静态脚本已更新，刷新4175使用。

用户反馈的是答对等待过久，不应仅凭源码中的本地命中逻辑就断言实际网页会立即判对。真实BFF基线：裸“雨伞”约1114ms走规则判对；“是雨伞吗”约6274ms走完整模型，其中模型约4952ms，最终未标记正确。

本次包含当前谜底的输入优先进入Dify既有代码分支，明确单一猜测（如“是雨伞吗”“是不是雨伞”“我觉得可能是雨伞吧”）直接确认，否定或非明确猜测不揭晓、不增加提问次数；不包含谜底的输入仍走正常主持。仅修改输入节点与确定性响应节点，不增加模型节点。前端独立请求确认，不排在普通语音或情景分析后，不为确认额外等待思考动画或乘客气泡最短时长；确认成功再按原流程取消过期任务并揭晓。确认期间旧任务保留，P0/重置或新确认会使过期结果失效。5秒内确认请求仍失败时按同一明确猜测规则安全本地兜底，并记录诊断；普通对话的超时预算不变。

真实测试草稿9条输入通过：8个答案候选均零LLM调用，约913–1024ms，另1条普通属性问题保留原LLM路径。发布后无头Chrome真实BFF验收：首次“是雨伞吗”点击至揭晓约2679ms，随后“不是雨伞”约1325ms且不判对，再次“我猜是雨伞”约1176ms判对。浏览器测试仅隔离预加载和情景事件，主持确认是真实发布API，音频关闭，无脚本异常；这些有限样例不保证所有网络、机器和首次资源加载都有相同耗时。

298项Node回归与27个共享输入用例、3个安全/超时/结束优先级Python用例通过；包含迟到回复、重复确认、暂停、断网兜底、气泡去重、前后端规则一致性，以及补丁只改两个节点的检查。工具：[update-ecs-answer-fastpath.mjs](../tools/dify-workflow-mcp/scripts/update-ecs-answer-fastpath.mjs)。真实运行ID、前后备份及Chrome截图位于 Git 忽略的 `tmp/dify-ecs/2026-10-22T08-41-29-453Z-answer-fastpath/`，BFF基线位于 `tmp/dify-ecs/answer-fastpath/baseline.json`。回退须先比较当前版本，保留之后的手动修改。

## 2026-10-22 测试主持人口吻优化 v2

已发布到独立测试主持人 `b8bff994-d397-484e-8ccd-11851e6cc460`，发布 hash：`64ebf5a928a07e454800170b95611ee321113129e201abcce08a7afb37861e9e`。正式主持人的草稿与发布内容均未改动；未更新其他应用、知识库或网页服务。

原因：温度 1.8 当时仅保存在测试草稿，发布版本尚未包含；提示词允许简单属性问题只回“是/不是”，求助和能力边界分支又会直接覆盖模型文案，因此仅调整温度不能改变这些固定输出。之前留在本地的口吻规则也未进入现行 Dify 发布图。

本次在首选与格式重试两个 LLM 中明确“热情、机灵、会接话的游戏搭子”定位，区分体谅、接梗、认错和成绩反馈；允许简短的互动句，但不补充未问属性。三个守卫副本同步更新：公开线索去除字段前缀，安全口语包装增加变化，长线索保持全文且不超60字；模型表达只用于选择包装，不直接复制模型生成的提示事实。能力边界先回应需求再说明不能做什么，不再机械追加进度说明。

仅变更5个节点，节点连线、变量、底层安全/判题守卫与模型参数保留，包括用户设置的温度 1.8。没有增加模型调用环节。更新脚本：[update-ecs-host-style.mjs](../tools/dify-workflow-mcp/scripts/update-ecs-host-style.mjs)。

验收：17项Node测试、44项实际代码节点测试通过；8组真实草稿对话通过，约2.8–4.1秒，包含属性问答、求助、独立思考、冷漠反馈、玩笑、舒适需求、分区灯光与防剧透。发布后经本地4175真实BFF再次验证测试绑定、话术、守卫与动作字段，约3.2秒成功。自然语言效果仍需持续体验，不能把有限样例通过视为所有回复都必然幽默。未播放测试音频。

完整草稿/发布前备份、候选、真实运行ID与发布后验收保存在 Git 忽略的 `tmp/dify-ecs/2026-10-22T07-59-36-153Z-host-style/`，勿公开其中完整快照。回退应经 `saveDraft` 的当前版本并发校验恢复 `before.json` 中的测试图并验证后发布，不覆盖之后的手动修改。

## 2026-10-21 测试预演生成与补全规则 v2

仅阿里云测试预演应用 `aa30333f-4a8d-4d89-9d6f-557ee7296263` 已发布 `preview-rules-v2`。原问题不只是网络：模型生成未明确遵守谜底连续两字片段及提示文本重合规则，例如“保障安全”和“它平时……”会被现有守卫截断，补全时又重复违规。

输入节点现显式提供禁用片段、具体特征词、提示重合片段、短回答和补全全局题序；提示词要求前三问保守避开提示片段、年龄变体不改变事实、补全只生成后缀且保留已接受前缀。模型/参数、输出守卫、节点连接、变量和知识库均未修改。

最终草稿12项真实回归（六种首题及实际提示、4/5/6步、安全带重复生成与前缀补全）全部首次通过，耗时2.3–3.7秒；发布API另3项全部通过。本地16项Python守卫、14项Node预演测试通过。本机4175三路readiness正常。完整修复前后DSL、失败证据、版本hash和测试run ID见 [测试预演版本记录](../dify/releases/2026-10-21T12-27-52-272Z-test-preview-fix/VERSION.md)。有限样例通过不保证模型永不失败；安全截断和一次补全机制保留。

正式三应用、测试主持/情境应用与Cloud未改，不部署正式网页。刷新本地Demo会重新生成页面内存中的预演；仅重试时仍按原逻辑保留已成功部分。后续同步正式版需另行执行发布流程，不会自动同步。

## 2026-10-21 稳定性修复已上线

当前网页/BFF版本 `V1.4-dify-reliability`：失效会话仅在明确拒绝且尚未生成时恢复一次；正文/SSE超时覆盖完整响应；前端按BFF预算等待；流内错误、空回复及各类上游错误有独立脱敏分类。`/api/readiness`无模型消耗验证三API实际连通，不能把`/api/health`的configured当成调用成功证明。

本地4175/4179已重启并保持阿里云测试绑定；正式网站已备份部署，221项Node、测试/正式各12项真实请求及线上暂停浏览器回归通过。模型/工作流/知识库未发布；只读审计发现测试主持首选模型名与正式不同，不能自动认定两环境完全同步。具体证据、限制及发布回执见 [稳定性记录](DIFY_RELIABILITY.md) 和 [生产部署记录](ALIBABA_CLOUD_PRODUCTION.md)。

本次本地故障包含热点IP白名单变化和旧阿里云客户端占用8081。已释放旧转发、恢复统一后台SSH；不要再同时开启客户端8081转发，自动重连不能越过安全组。

## 2026-10-20 本机维护链路修复

已改为公网22直连SSH、Mac launchd后台自动重连，固定本机8081→ECS回环8080；不再依赖返回WebSocket403的阿里云客户端。`node tools/dify.mjs dev`启动前检查隧道及三套测试Key，`doctor`检查全部连接环节，`smoke`验证实际测试应用。配置位置、来源IP变化的限制、失败诊断与验收见 [连接与诊断](DIFY_CONNECTION.md)。

## 2026-10-20 日常迭代转为 ECS 测试环境

Cloud 保留历史，今后日常修改集中在阿里云独立测试环境。测试资源已实际创建、发布；本机 `.env.local` 已切换，原 Cloud 配置保存在 Git 忽略且600权限的 `tmp/dify-ecs/.env.cloud-backup`。产品规则未改。完整操作见 [阿里云测试与发布](DIFY_ECS_ITERATION.md)，ID来源见 [environments.json](../dify/environments.json)。

| 用途 | ECS 测试 App ID |
| --- | --- |
| 主持 Chatflow | `b8bff994-d397-484e-8ccd-11851e6cc460` |
| 情境 Workflow | `6e3c5968-1a66-443d-9a2d-a6c62ff248eb` |
| 提问预演 | `aa30333f-4a8d-4d89-9d6f-557ee7296263` |

独立测试库 `387156dd-5587-43ec-87ae-4976ca04c18a`，文档 `37c487ee-15be-4ffd-8176-01a1ca28e181`，28条原文逐条一致、两个检索节点均绑定测试库。正式库与原三套正式App ID保留；模型插件和原参数复用同一实例配置。

本地使用 `node tools/dify.mjs dev`，地址 `http://127.0.0.1:4175/`；健康接口的环境标签是 `alibaba-test`。4175为独立来源，首次新建测试会话，其后跨题/新局/刷新仍复用；不能把Cloud conversation_id发给ECS。Mac关机或关闭转发不影响线上，只影响本地调试和维护。

发布命令 `node tools/dify.mjs release --publish` 会备份、比较差异、跑本地与两套草稿回归、校验版本后发布，并保留失败回退进度；只Dify变化不需要重启网站。ECS真实导出已保存，不再仅依赖下节历史导入模板。最新执行结果以 `dify/releases/` 的 `release.json` 为准。

已实际执行并发布 `2026-10-20T05-17-33-943Z-ecs`：测试应用和正式草稿各12次真实BFF请求通过，两个库分别通过实际检索节点命中HK28；发布后公开网站10次请求全部200，预演ready/4步。三套应用的业务图和知识库相对原正式版无差异，App ID/Key不变。版本、完整导出、知识库原文、运行ID与证据见 [本次发布记录](../dify/releases/2026-10-20T05-17-33-943Z-ecs/release.json) 和 [公开验收](../dify/releases/2026-10-20T05-17-33-943Z-ecs/public-verification.json)。未提交Git，也未重新部署网页/重启ECS服务。

维护登录独立保存于 `tools/dify-workflow-mcp/.env.ecs`，使用自动刷新，密码不保存。新入口是 `ecs-console.mjs` 与 `tools/dify.mjs`；旧Cloud MCP和旧脚本没有自动变成ECS客户端，不能用Cloud ID编辑测试应用。新启动的旧Cloud脚本默认拒绝历史环境写入，常驻旧进程仍可能缓存旧代码/配置，不应继续用它进行日常写入。不要为读取ECS而把Cloud连接器Cookie复制到ECS配置。

最初发布回归曾错误地断言每次副驾未参与都必须检索HK28，实际运行合法选择免检索；这轮在写正式草稿前停止，记录保留。现改为直接运行真实经济检索节点验证HK28，再验证事件回应，未修改工作流业务策略。原换题语义问题及HK10门槛矛盾保持已知状态，不能称为此次修复。

## 历史：2026-10-20 本地工作流与知识库归档（首次整理）

无密钥的正式版本资料已从忽略目录整理至 [dify/](../dify/README.md)，包括三套 Cloud 完整来源 DSL、三套 DeepSeek 0.0.25 的 ECS 导入副本、28 条来源经验 JSONL/Markdown、原始证据清单、环境 ID 映射和文件 SHA-256。入口与校验命令见该目录 README；版本来源、测试边界和已知问题见 [迁移基线说明](../dify/releases/2026-10-20-migration-baseline/VERSION.md)。

本轮仅本地归档，不重新读取/发布远端，不切换 `.env.local`，也没有创建阿里云测试应用。Cloud 导出核对时间是 2026-10-19；ECS 文件仍为迁移导入材料，两个检索节点的引用留空，不能当作当前 ECS 发布图的直接备份。目标实际绑定保存在环境映射中，ECS 发布 hash 尚未独立回读，保持 null。旧编写稿 HK10 差异和换题语义问题继续保留，不因归档声称已修复；没有新增 Git 提交。

## 2026-10-20 阿里云已上线（当前生产入口）

用户已单独批准上线、创建独立服务端 Key、隔离5003并仅重启插件容器，网站不加访问密码。三套 ECS 应用现已发布，Demo 正式入口为 **[https://cabinplay.xyz/](https://cabinplay.xyz/)**（www 也可用）。完整目标ID、运行/备份路径、发布清单、测试run ID和待办见 [阿里云生产部署记录](ALIBABA_CLOUD_PRODUCTION.md)。下方“草稿/未切换”是先前历史进度，不再代表当前生产状态。

主机运行 Node22.23.3 / Caddy2.11.7，Demo 由 smartcabin 非root用户运行、systemd开机启动和故障重启、仅监听127.0.0.1:4173。三个Key在 `/etc/smart-cabin-demo.env`（600 root:root），Dify仍为原实例1.17.1，管理端/DB不公开，插件5003仅回环。**本机Cloud `.env.local` 和Cloud三应用未切换/修改。** 后续迭代应先明确是ECS还是Cloud，旧Cloud维护脚本不得直接用于生产。

三路正式API共10次独立虚构数据请求通过，含SSE结构化输出、同会话续聊、环境→Chatflow、P0旁路、入睡/醒来动作和4步预演；161项本地回归通过。双域名HTTPS/TLS、私有路径404和音乐Range206通过。浏览器准备页截图有显示，但控件自动化超时，线上完整交互/刷新回归未完成，不代表大陆多运营商可达性已验证。产品仍是输入框模拟口述。

按用户选择暂不修复已知换题语义问题，本次发布仍包含它；HK10四/六题矛盾未改。换题问题来自迁移时的Dify调试会话，前端/BFF的当前题边界和过期结果保护已存在且线上文件一致，不能直接推断线上完整换题保护失效；当前范围校验也不验证模型的属性回答真伪。不能把“正式API通过”解读为这些问题已经解决。本轮未提交或推送Git，release源提交8086880但包含工作区适配改动，逐文件hash见服务目录manifest。

同日后续：用户确认后已修复`agent_backend`重启，根因为Agent Stub专用密钥解码36字节而非所需32字节。服务器生成合规密钥，只改`.env`该字段并仅重建Agent容器；其他运行容器未变，数据库/工作流/Cloud未改。`02:27:45Z`启动，`02:30:03Z`复查running、0次重启、无新增校验错误；内部OpenAPI200、实际Settings/密钥校验及双域HTTPS通过。修复后3应用10次生产BFF真实回归全部200、预演ready/4步；161项Node测试和5项修复脚本测试通过。私有备份`/root/cabinplay-backups/20261020T022744Z-agent-secret`，维护SSH本地端口现为2223（此前2222）。细节/断言边界见[Agent修复记录](ALIBABA_CLOUD_PRODUCTION.md#agent-启动配置修复2026-10-20)；不要将此密钥当作数据库密钥，也不要无条件重跑修复脚本做密钥轮换。

## 后续子对话接手顺序

1. 先读本页当前生产状态，再读[生产部署记录](ALIBABA_CLOUD_PRODUCTION.md)和[接入说明](DIFY_CHATFLOW_INTEGRATION.md#当前生产接入2026-10-20)。本地Cloud配置与ECS生产并存，涉及“最新应用”必须先明确实例、App ID和正在体验的页面来源。
2. 线上故障先从生产BFF的脱敏日志关联run ID，再读取目标Dify节点；详见[生产排查入口](DIFY_FALLBACK_DIAGNOSTICS.md#阿里云生产排查入口2026-10-20)。旧Cloud连接器和`--cloud`脚本没有自动迁移到ECS。
3. 保留全局会话复用、当前题边界与异步结果保护。迁移调试中的属性回答错误尚未修复，也未证明真实前端完整换题保护失效；不能仅看`context_verified`或HTTP200判定语义通过。
4. 不重装Dify，不重复导入资源、不直接改数据库；变更生产服务或发布规则前，说明范围并确认。已合规的Agent密钥不再轮换，不把旧私有备份整体覆盖回去。
5. 上线与Agent修复后的测试、run ID、备份和未覆盖项均已记录；不能把文档整理当作重新执行验收。当前工作区仍有未提交部署/后端改动，生产release含这些改动，不是源提交8086880的纯净检出；没有新增Git提交或推送。

## 历史：2026-10-20 自托管迁移状态（发布前草稿）

本节取代下方“尚未创建目标资源”的历史进度，当前 Cloud 发布版本仍保持不变。目标为用户已有的 ECS Dify 1.17.1，经 `http://127.0.0.1:8081` 转发登录；三套应用已实际导入，均未发布：

| 用途 | ECS 目标 App ID | 状态 |
| --- | --- | --- |
| 主持 Chatflow | `b1f6f41d-eb34-4cba-b126-d08ca73052a3` | 17 节点草稿，换题语义测试待修复 |
| 情境 Workflow | `b68a7ef3-f411-49fe-9a9f-92bdfcf40ce4` | 26 节点草稿，环境/P0/HK28 测试通过 |
| 提问预演 | `695710b2-b79e-4d8f-ab2f-6cfc543e7674` | 5 节点草稿，雨伞 4 步预演通过 |

新经验库 `923e8e72-56cb-45c5-9eb4-486a6d5afed3`，文档 `ea3a4ca1-1efa-44a4-a412-8e94daf13a4c`：28 个完整分段，逐条与 Cloud 导出源内容比对一致、全部启用。情境两个检索节点均重绑，HK28 实测命中；保留经济索引/TopK3/关闭 rerank。目标 UI 的 overlap 最小值为 1，不是来源的 0；没有因此拆断记录。来源 HK10 自带四题/六题描述矛盾，暂忠实迁移、未擅自更改。

导入只改插件依赖为目标已安装 DeepSeek 0.0.25，四个模型节点仍是 `deepseek-flash` 和来源参数。来源/副本及 hash manifest：`tmp/alibaba-cloud/migrations/2026-10-19T14-55-54-826Z/`（忽略且权限 600）。没有创建目标 API Key、没有改本机 `.env.local` 或 Cloud 应用、没有发布或部署服务。用户只授权草稿迁移及虚构数据测试，后续修改规则、发布、端口/服务配置需按阶段确认。

重要失败：同一预览会话从海豚切到安全带后，再问“它是人造的吗”，模型错误回答“不是”。真实节点输入、清洗快照和模型系统提示均已正确换为安全带；明确问当前题后能答对，不能把失败归因于前端漏传。运行 `6e3c75a1-9cf0-4d9a-9d2f-f6701b931b4b`，尚未修正；不因 JSON/守卫通过就宣称语义通过。不要为绕过失败而改成每题新会话。新子对话优先查 [迁移与阻塞记录](../deploy/alibaba-cloud/README.md#目标草稿迁移结果2026-10-20) 和 [目标实测](TEST_SCRIPT.md#阿里云自托管-dify-草稿迁移2026-10-20)。

用户已明确选择暂不修正换题语义问题，先完成迁移记录；本轮没有更改目标主持草稿。发布及生产变更仍需分别确认。

本地全部 160 项测试通过。域名公共 NS/A 已于用户时区 10 月 20 日恢复，主域/www 均指向 `47.83.188.59`，尚无 HTTPS 上线验收。两个客户端转发曾断开；用户重连后 2222 专用密钥 `id` 已成功返回 root，8081 工作室刷新正常显示三套目标应用，未重启服务或改密钥授权。agent_backend 重启及 5003 全地址调试端口风险未修改。保留既有 Dify、卷和数据库，不重新安装、不重复导入资源。

## 历史：2026-10-19 阿里云迁移准备（未切换）

目标为香港 ECS 上已有的 Dify 1.17.1，保留原实例、数据卷与管理员账号；最新计划见 [阿里云迁移记录](../deploy/alibaba-cloud/README.md)。本轮实时核对三应用 Cloud 草稿/已发布 hash 一致，且已发布图与本地完整 DSL 一致，未修改 Cloud。正式无密钥导出补齐本地旧 YAML 缺失的 DeepSeek 0.0.24 插件依赖；4 个 LLM 节点维持 deepseek-flash 和原参数。

Cloud 主持经验库 28 条全部有效，HK10 与本地稿的标题/适用条件/示例存在差异；迁移源采用 Cloud 现状，本地 JSONL 未覆盖。Cloud 导出的知识库引用使用原实例加密，不可直接导入目标；准备工具输出来源备份与清空引用的导入副本，目标两个检索节点必须重绑新库后才发布。迁移源及 manifest 保存在 Git 忽略的 `tmp/alibaba-cloud/migrations/`。

本地 BFF 已兼容自托管 API origin 与末尾 `/v1` 的两种配置，保留上游 SSE、结构化回复及会话/局题保护；生产 Node 服务限制静态文件范围、关闭本地诊断入口、仅记录字段白名单日志并支持 M4A Range。尚未取得目标 SSH 入口和已认证 Console，未创建目标应用/知识库、未变更现有本机 Cloud Key、未上线。不要把当前 Cloud App ID 当作自托管实例 ID。

同日只读连接核对：用户已确认目标 SSH 为 `root@47.83.188.59:22`，但公网直连超时、本机 `2222` 转发未开启，现有 RSA 公钥是否已授权仍待验证。Dify 本机 `8080` 转发及公共状态接口正常；管理员/DeepSeek 已配置为用户确认，尚未读取认证配置。域名 `cabinplay.xyz` 的注册局 NS 已是 dns15/dns16.hichina.com，但存在 `clientHold`，公共 NS/A/www A 查询均为 NXDOMAIN；需在阿里云核对并解除具体锁定原因后重测。服务器和 Dify 均未修改，详细证据与主机指纹核对步骤见部署记录的“2026-10-19 只读连接检查”。

域名后续更新（`2026-10-19T14:33:18Z`）：用户已完成实名认证并提供邮箱验证通过截图，注册局 `clientHold` 已确认解除，NS 保持正确；公共主域/www A 查询暂仍 NXDOMAIN，待解析更新后复查。无需再次修改 NS 或提交认证；SSH 转发及授权验证仍待完成。

SSH 后续更新：用户开启本机 2222 转发、从 Workbench 核对主机指纹，并明确同意追加部署专用受限公钥；新密钥已成功登录 root。远端只读审计确认核心 Dify 镜像 1.17.1、主 API/数据库健康、DeepSeek 插件 0.0.25（源导出为 0.0.24），Node/Caddy 未安装。发现 agent_backend 因 ServerSettings 校验反复重启，以及插件调试端口 5003 全网卡绑定；未修复、未安装、未重启、未访问数据库。域名公共解析仍未生效，暂未部署。具体证据、风险边界和专用公钥指纹见部署记录“2026-10-19 远端只读审计”。

目标 Console 后续核对：用户已通过本机 8081 转发登录，浏览器可见工作室无应用、“所有知识库”无资料；DeepSeek 0.0.25 显示已配置一个凭证，`deepseek-flash` 已启用，未读取密钥值或做真实调用。ECS 直查权威 DNS 确认阿里主域/www A 均为 `47.83.188.59`，但 `.xyz` 上级权威仍 NXDOMAIN，待委派同步；不是单纯浏览器缓存。当前仍未导入/发布目标应用，下一阶段仅迁移草稿和隔离测试的具体范围待确认，不能直接开始生产部署。

## 2026-10-19 前端诊断与题号提示增量

本轮仅修改本地前端、开发服务及诊断白名单，没有读取、保存或发布 Dify 云端应用；下方三应用 hash 仍是先前已记录的版本，不代表本轮重新核验云端。未推送远程 Git、未部署 Vercel。

- 答对后换题新增本机 `POST /api/client-diagnostic`：将开始调度、等待原因和等待检查通过写入现有 `tmp/workflow-diagnostics.ndjson`，`phase=client_runtime`。只在页面健康状态为 `runtime=local` 时采集；同原因最多每 5 秒一条，按局/题关联服务端请求，不保存话术正文、乘客原话或谜底。详见 [前端运行诊断](DIFY_FALLBACK_DIAGNOSTICS.md#前端答对后未推进诊断2026-10-19)。
- “第 N 题”提示缺失已通过浏览器复现：状态及 3 秒计时已启动，但面板没有立即刷新。`startQuestionIntro()` 现即时渲染，保留原有放大动画、提示音、3 秒停留及其间隐藏倒计时/剩余提问次数的规则。首题、答对换题和超时换题三条路径验证通过。
- 本轮前端缓存版本为 `20261019-question-intro-render-v1`，验收地址为 `http://127.0.0.1:4187/`。更新开发服务接口后需重启对应 Node 进程；端口不同仍属于不同浏览器来源，会话存储不共享。具体测试命令及结果见 [测试记录](TEST_SCRIPT.md)。

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
| 每局开场串词（2026-10-22，本地） | `route=chat, operation=game_opening` → BFF校验首题未开始问答 → 现有Chatflow事件回应 | 准备页独立会话预取，感知“游戏即将开始”，15至25字；点击开始即计时，题号→提示正常展示，与串词并行。生成期限20秒，未就绪只在开题3秒内等候且不阻塞游戏；P0/换局/乘客提问丢弃，不改任何游戏或设备状态 |
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
