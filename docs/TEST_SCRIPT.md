# 测试与体验脚本

## 游戏暂停权限、六题进度与控制器可用性（2026-10-19）

见 [游戏暂停权限与六题配置](GAME_CONTROL_AND_SIX_ROUNDS.md)。本次 `node --test tests/*.test.cjs` 共153项通过；Chrome游戏控制流程覆盖玩家暂停/继续、倒计时和自动时间轴剩余时间、六点布局、睡眠事件期间环境/车速按钮、手动暂停模拟禁用，以及第六题结束。另复验完整模拟冻结和多事件FIFO。主持人 Chatflow 已发布并读回，hash `5fd8948bda460cb725b10b271ddfa51c33976fc1a6bab66bcee9a3481ee3d6d0`；真实接口用独立测试会话，8个云端场景与74个代码节点守卫用例通过。没有部署 Vercel。

## 应景题开场串词（2026-10-18）

新增12项回归，全部142项本地单元测试通过：实际匹配题每题一次，普通题/第1题不加开场，不播放思考，不扣次数、不新增事实/设备。P3在高优先级话术后等待，超出开题6秒或乘客已提问则丢弃；P0/环境再次变化/换题取消旧结果，失败不补兜底。BFF拒绝不匹配主题、错误来源/P0、已有问题等非法操作；正确请求只调用一次Chatflow、不经过情境Workflow。已取消网络请求不得写回旧会话ID。

```sh
node --test tests/*.test.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/environment-round-intro-browser.cjs
LIVE_INTRO=1 PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/environment-round-intro-browser.cjs
```

浏览器验证正常显示、一次性、乘客先问/P0先到时拒绝晚返回。真实发布API三种环境通过，约4.1–4.6秒；真实Chrome→本地BFF→Chatflow显示通过。最后一条命令使用真实Chatflow（其余事件与预演为桩）。未修改Dify云端应用，未部署线上；4186本地服务已重启，刷新脚本缓存`20261018-environment-round-intro-v1`。详细运行ID见 [ENVIRONMENT_AWARE_RIDDLES.md](ENVIRONMENT_AWARE_RIDDLES.md)。

## 下一题应景选题（2026-10-18）

详见 [ENVIRONMENT_AWARE_RIDDLES.md](ENVIRONMENT_AWARE_RIDDLES.md)。13项新增单元回归与Chrome真实控件桩测试：第一题中连续切雨天/雪景，只请求雪人新预演；当前题题面、谜底、已问次数和事实不变。答对进入雪人题，模拟计划与Chatflow快照同题；再切雨天，超时后进入雨伞题。已出过雪人后再切雪景则选择未出的草原，不重复雪人。完整10题序列不重复，最后一题不请求第11题。预演未完成也按时开题，旧结果晚到不能覆盖新计划，暂停与重置清理正确。

```sh
node --test tests/*.test.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/environment-riddle-browser.cjs
```

130项本地单元回归通过；浏览器检查桌面/小窗口显示和未来谜底不泄露，完整暂停与多事件队列回归通过。网络使用桩，不代表云端预演生成质量验证。不改Dify应用或BFF协议，未部署线上。

## 暂停模拟全界面冻结（2026-10-18）

详见 [SIMULATION_FREEZE.md](SIMULATION_FREEZE.md)。游戏中显示主持/乘客气泡、重要事件、彩带、倒计时红光并发起延迟回复，点击“暂停模拟”后等待6.5秒：三分区截图像素完全一致，气泡不消失、倒计时和序列帧不前进、背景不切换、异步回复不更新面板，音乐与Web Audio暂停。恢复后保持剩余时长并应用有效回复；结算入场暂停5秒也逐像素一致。急刹安全暂停中的手动暂停不消耗4.5秒恢复时间。

```sh
node --test tests/*.test.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/simulation-freeze-browser.cjs
```

117项单元回归及Chrome浏览器测试通过，新增5项时钟/任务/异步等待测试。浏览器网络均使用桩，不调用真实Dify；未部署线上。

## 揭晓期间急刹恢复回归（2026-10-18）

真实体验日志：第2题 `round_timeout` 于 `2026-10-18T11:06:24.342Z` 发出，420ms后收到 `hard_brake`。两个后台请求均200成功，分别为 `10f5c3d5-5d62-4a22-9af4-0fe88b49755a`、`26fc5eb5-deff-464a-879f-c2be8f882596`。卡住来自前端：急刹清除了揭晓后的下一题计时器，恢复时又无条件改为playing，但该题倒计时已清除、时间轴已结束，导致无法继续。

修复：`safetyResumeContext` 保存原局/题、游戏状态和揭晓显示；连续急刹保留最初状态，恢复回调核对当前局/题/P0代次及自身计时器。4.5秒后恢复原状态，已揭晓的题继续揭晓并重新安排下一题，不重开旧题或重复记分；准备页不进入无倒计时playing。新P0或重置取消旧恢复任务。

新增4项单元回归先复现失败，修复后92项本地测试全部通过。浏览器完整事件链覆盖超时、急刹、4.5秒恢复揭晓、随后自动进入下一题并启动新倒计时；截图 `tmp/safety-reveal-recovery.png`。本次只改前端，不修改Dify/知识库/代理，不部署Vercel。旧页面需刷新加载 `20261018-safety-reveal-recovery-v1` 脚本。

```sh
node --test tests/*.test.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/cabin-policy-browser.cjs
```

## 座舱情境协同增量（2026-10-18）

1. 输入“关闭副驾灯光”：承接气泡显示时才关闭副驾分区，不出现睡眠音量/空调提示，不扣提问次数。输入“把灯关了”先澄清；否定/假设/谜题描述不触发控制。
2. 输入“我好冷”“还有多久到”“换个主题”：婉拒未开放能力，题号、已确认事实及问题次数不变，倒计时继续自然流逝而不重置；不虚构控制成功或ETA。
3. 输入“给我一点提示”“太难了”：只复述本题真正展示的题面/问答，不能泄露未问属性、预演回答或答案；已确认事实不清零。
4. 普通提问等待主持回答时点击“临时事件打断”：计时冻结4.5秒，恢复后接原问题，只计一次；急刹/重置取消旧恢复。没有导航事件。
5. 有效入睡必启关怀，睡着和醒来仍等待主持承接气泡才执行，睡眠提示为“空调：用户记忆值”，不得显示关闭；灯光恢复睡前设置，不强制开启。连续两名乘员入睡，第二名也必须收到独立关怀动作。点击“主驾分心”，感知显示“主驾状态：分心”，不回退成“收到座舱事件”。
6. 点击“主驾分心”“主驾疲惫”：情境分析和主持都能识别，仅安全提醒，不邀请主驾通过游戏提神。

```sh
node --test tests/*.test.cjs
python3 tests/cabin-policy-guard.py tmp/dify-import/cabin-policy
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/cabin-policy-browser.cjs
node tools/dify-workflow-mcp/scripts/verify-cabin-policy-api.mjs
```

本轮88项本地回归、35项代码规则、22项睡眠守卫及浏览器测试通过；最终草稿14次主持与5次情境真实运行通过。云端最终状态和运行ID见 [座舱情境协同](CABIN_SCENARIO_POLICY.md) 和 [Dify 当前状态](DIFY_CURRENT_STATE.md)。下面按日期保留旧版本记录，睡眠空调记忆值等旧口径不代表当前状态。

当前 Dify 发布状态以 [Dify 当前状态与子对话交接](DIFY_CURRENT_STATE.md) 为准。本文件按时间保留旧版本回归；历史测试中关于 `sync_state`、本地问题回退和连接器认证的描述不代表当前行为。

主持人出现固定兜底时，保存 BFF 返回的 `diagnostic`、`workflow_run_id`、`message_id`；若 `diagnostic.status=reason_unavailable`，按 [主持人兜底诊断](DIFY_FALLBACK_DIAGNOSTICS.md) 回查 Dify 节点执行记录。HTTP 200 不能视为话术通过守卫，也不能把无原因码的固定话术归因于某条具体规则。

## 分区睡眠关怀回归（2026-10-18）

1. 进入游戏后点击“有人睡着”：乘客先切换睡眠状态，主持人动作未返回前不关灯、不显示设备设置。
2. 主持人选择 `cabin.apply_sleep_comfort` 后必须描述灯光、空调、分区音量。只在此气泡真正显示的同一次渲染中，对目标座位显示Figma关灯效果、“分区音量：0”和“分区空调：用户记忆值”。空动作列表不执行。
3. 情境静默仍请求主持人设备决策；有设备动作则必须伴随话术，无动作保持静默。验证气泡等待P1或1.5秒最短展示保护时设备保持原状，融合决策面板记录等待和实际模拟回执。
4. 乘客醒来时关灯和分区设置保持不变；主持人返回 `cabin.restore_sleep_comfort` 且恢复气泡实际显示时才撤去效果。重置直接清除，换背景不清除，多区互不干扰。错座位、启用前已醒来、恢复前又睡着、过期或P0后的动作不能生效。

```sh
node --test tests/*.test.cjs
python3 tests/cabin-sleep-comfort-guard.py tmp/dify-import/sleep-comfort/candidate.json
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/cabin-sleep-comfort-browser.cjs
node tools/dify-workflow-mcp/scripts/verify-sleep-comfort-api.mjs
```

当前81项本地回归、22项代码守卫、9次云端草稿运行和浏览器事件链通过；真实发布API经本地BFF在同一会话完成睡眠关怀与醒来恢复。最终hash与运行记录见 [SLEEP_COMFORT.md](SLEEP_COMFORT.md)。

## 副驾未参与邀请回归（2026-10-18）

前端构建情境 Chatflow 输入时，`passenger_inactive` 必须保留 `participation` 快照及其 `version`。Dify 清洗快照不得删除该字段。完整状态应由情境 Workflow 检索HK28并申请邀请，Chatflow交接守卫通过；参与状态缺失、版本不匹配、乘员睡着、拒绝邀请或近期已参与时应静默/拒绝，不显示兜底话术。

```sh
node --test tests/dify-participation.test.cjs
python3 tests/dify-situation-dialogue-guard.py
python3 tests/host-experiences-guard.py
node tools/dify-workflow-mcp/scripts/verify-host-experiences.mjs
node tools/dify-workflow-mcp/scripts/verify-situation-dialogue-api.mjs
```

云端28条经验全部 `completed` 且启用。实测情境运行 `468a70ca-6ebc-4dac-9ab3-29b7e799f3f0` 检索到HK28，Chatflow运行 `571949ca-1ed8-4461-92bf-b3cfadee0b5c` 守卫通过；本地4186 BFF测试确认完整链路与同会话。已发布的Chatflow hash为 `82e349e574044651877dbee7f9860613a6ef6e97165f63c723c3bfa58de6ee72`，情境Workflow hash为 `ed4d1159c4ce13d6d9a09361f7cf4bc7cf192c8406155083f4379bb8082f728e`。不部署Vercel。

## 情境分析后自动接续Chatflow（2026-10-17，当前行为）

协议与源文件见 [情境串行路由](SITUATION_DIALOGUE_ROUTING.md)。本地56项JavaScript回归、Python守卫检查、Chrome串行时序与成就反馈两项浏览器回归、13项Dify真实草稿运行已通过。已发布API通过6次真实同源请求验证同一会话中的“环境→Chatflow→普通问题→再次换环境→Chatflow”，P0仅后台记录。

```sh
node --test tests/*.test.cjs
python3 tests/dify-situation-dialogue-guard.py
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/dify-environment-browser.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/host-experiences-browser.cjs
node tools/dify-workflow-mcp/scripts/update-situation-dialogue.mjs verify
node tools/dify-workflow-mcp/scripts/verify-situation-dialogue-api.mjs
```

API脚本使用独立测试用户，不使用真实玩家会话。最后一次发布API测试中两次环境串词全链路约8～9秒；纯分析约2.6～3.7秒，Chatflow约5秒，不包含气泡排队。零模型规则分支消除分析模型/检索等待，串行网络与生成耗时仍存在。日志以同一`event_id`串联两次请求，第二步标记`operation=situation_reply`。13项草稿验收还覆盖P1零模型零检索、疲惫未达阈值静默、睡眠分析、成就检索及表达、普通问答与提示拒绝。

`tests/dify-situation-live-browser.cjs`另以真实Chrome页面调用已发布两应用，仅拦截预演以避免干扰；实测从点击切换隧道至显示自然串词约9.9秒，事件ID一致、会话已保存、游戏状态未改变、未播放思考动画、无页面错误。截图位于忽略目录`tmp/situation-dialogue-live.png`。

`verify-host-experiences-api.mjs`也已适配串行协议并通过3次发布API请求：HK12真实检索分析、Chatflow成就串词、揭晓期间主动夸奖。同一会话持续复用，成就串词采用HK12且不泄露谜底。

## 环境本地P1与P0后台通知（2026-10-17，历史行为，已被串行方案替代）

环境变化改为前端先生成短句并进入P1仲裁，同时异步调用情境Workflow。返回仅更新决策面板，不再播放候选串词、应用动作或写入Chatflow情境缓存。BFF取消4500ms环境代播兜底，失败如实返回，不影响本地串词。P0直接抢占普通气泡，急刹本地4500ms恢复，后台返回只存记录。

验证命令为 `node --test tests/*.test.cjs` 与下面的Chrome环境脚本。42项JavaScript测试通过，覆盖网络挂起/失败仍本地播报、静默情境结果正常回传、迟到模型内容不覆盖气泡/游戏、P0立即暂停和4500ms恢复、同环境不播报、连续切换旧结果失效及已有问答恢复。

Chrome实测本地环境话术约292ms出现，此时后台请求仍挂起；已有普通气泡时约1540ms后展示环境话术，随后恢复原回答。收到携带另一条话术及summary状态的模拟云端输出后，本地气泡和playing状态均保持正确。无页面错误，截图 `tmp/environment-priority.png`。这些为本地及接口模拟验证，本次没有改动或发布云端Workflow，也未部署Vercel。本地4186服务已重启加载新BFF。

## 环境P1快速播报回归（2026-10-17早期版本，已由上节替代）

```sh
node --test tests/*.test.cjs
node tools/dify-workflow-mcp/scripts/test-parallel-host.mjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/dify-environment-browser.cjs
node tools/dify-workflow-mcp/scripts/test-parallel-cloud.mjs environment
```

39项JavaScript及16项Workflow节点/图测试通过。新增覆盖环境串词在1500ms保护后让位、恢复延后回答、P0清空、低优先级情境请求不使环境结果失效、同类旧结果丢弃、BFF环境失败短句及其他事件静默。Chrome实际页面约1541ms切换到环境话术，之后恢复原乘客回答，无页面错误；截图 `tmp/environment-priority.png`。页面接口使用模拟返回以稳定验证时序，不算云端端到端测试。

云端草稿三种环境（高速/城区/隧道）均为一次LLM、零检索、request_proactive_speech=true；暂停及同环境不调用模型。单次LLM耗时分别约2.20/1.77/1.72秒，非端到端时延。对应运行ID为 `44c92c09-44f9-46f9-8bee-a43c18f413b9`、`ce67c287-6ee6-40fc-ab30-e4086c9e7097`、`bff3df89-7680-40b3-9d56-2588d296661e`。已发布情境hash `2d68d3c2aaa7a82e6de01e8e01e967c6f6d53c4411c5ced5130f903619e982e0`。

重启本地4186服务后，发布API经BFF的一次实际请求触发4500ms超时兜底，约4558ms返回“我们驶上高速啦。”，带原局/题/环境/事件标识且P1申请发言；此结果验证超时路径，不能当作模型响应成功。其他事件不会套用环境兜底。

另外直接调用发布API并回查原始节点执行详情，通过运行 `f7beb077-c22d-45f6-a490-c61d47d7426d` 确认实际发布版也是一次LLM、零检索、P1且申请发言，返回“我们驶进城区啦，夜色正好，继续玩。”；API调用加节点详情回查共约5055ms，此总耗时不等于前端显示时延。前端/BFF本轮增量仍仅在本地生效，未部署Vercel。

## 思考动画生命周期回归（2026-10-17）

```sh
node --test tests/*.test.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/dify-preview-browser.cjs
```

先用回归测试复现：新回复气泡的最短展示保护会把已开始的思考动画切到说话动画，但残留的思考标记又会在后续渲染时启动思考。修复后，34 项本地 JavaScript 测试通过，其中 7 项专门覆盖：新气泡不打断已开始的思考；孤立标记不能启动思考；快回复取消计时；迟到图片不播放；事件、取消和旧请求不触发；原气泡的 1500ms 保护；连续请求不重复启动旧序列。

代理日志只能确认请求/回复及守卫结果，不记录浏览器逐帧动画；不能仅凭没有额外网络请求就断定某次动画的具体起因。浏览器回归通过拦截接口稳定重现返回时机，不调用云端 Dify，检查回复期间自然播完，以及气泡到期后持续重绘 7 秒不再进入思考。

## 答对后卡住诊断回归（2026-10-19）

```sh
node --test tests/dify-environment.test.cjs tests/local-diagnostics.test.cjs
```

本组 12 项回归通过，覆盖答对后的下一题等待门槛诊断，以及本机 NDJSON 对诊断字段的脱敏白名单。开发服务已验证 `/api/health` 与新增诊断接收接口。实际体验卡住时，按当前 `game_id` 查看 `tmp/workflow-diagnostics.ndjson` 中 `phase=client_runtime` 记录；`client_diagnostic.blockers` 指明仍未解除的等待项，`wait_duration_ms` 表示等待持续时间。字段含义及瞬时状态边界见 [本机运行诊断](DIFY_FALLBACK_DIAGNOSTICS.md)。这些诊断不直接清空队列或强制切题；本组测试不构成对旧卡住会话根因的最终证明。

## 题号提示显示回归（2026-10-19）

```sh
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright TEST_DEMO_URL=http://127.0.0.1:4187/ node tests/question-intro-browser.cjs
node --test tests/environment-round-intro.test.cjs tests/dify-environment.test.cjs tests/environment-riddle-selection.test.cjs
```

修复前浏览器测试复现：`questionIntro.active=true`，但面板仍显示题目提示。`startQuestionIntro` 只设置状态和 3 秒结束计时，没有立即 `render()`；没有其他状态刷新时，题号整段时间不可见。修复为启动题号提示时立即渲染，保留原有放大动画、提示音和 3 秒时长。Chrome 浏览器验证首题、答对换题、超时换题三条路径，包含 2380×1120 与 1024×768 窗口：题号实际可见，期间倒计时和剩余提问次数隐藏，结束后恢复题目提示和两项控件；无页面脚本错误。截图在忽略目录 `tmp/question-intro-round-{1,2,3}.png`。相关 35 项本地测试通过；浏览器接口全部模拟，不调用云端 Dify。

## 安全前缀与一次修复回归（2026-10-17，当时的连接器状态）

```sh
node --test tests/dify-preview.test.cjs tests/dify-preview-prefetch.test.cjs tests/dify-round-context.test.cjs tests/dify-diagnostics.test.cjs
python3 tests/dify-preview-guard.py
```

本地 20 项 JavaScript 测试及 8 项 Python 守卫测试通过，覆盖：连续安全前缀；拒绝坏步骤及后缀；只修复一次；固定前缀不可改写；修复期间可使用单步计划；失败保留已用步骤和覆盖事实；P0 不取消修复；重置取消并隔离迟到结果；乘客气泡最短等待 800ms。主计划剥离预演回答，但修复上下文保留供守卫重验；实际主持回答继续走实时 Chatflow。

随后将乘客气泡到主持人回复的最短展示窗口调整为 `1500ms`，并为所有主持人气泡增加 `1500ms` 最短可见保护；该增量目前完成语法与 diff 检查，未重新运行测试套件。

当时的控制台连接返回 401，候选未保存或发布；这是该轮测试时的连接状态，不代表当前连接状态。云端预演修复仍需先读取现有草稿，确认是否已保存/发布，再用首步拒绝、部分拒绝、修复成功及失败路径验证。

## 提前一道题预演回归（2026-10-17）

```sh
node --test tests/dify-preview-prefetch.test.cjs tests/dify-preview.test.cjs tests/dify-round-context.test.cjs
PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/dify-preview-browser.cjs
```

浏览器脚本使用本地 `http://127.0.0.1:4186/`，可通过 `TEST_DEMO_URL` 指定其他端口，先启动本地服务。所有 `/api/workflow` 请求在脚本中拦截，不调用云端模型。

本轮 14 项前端/BFF 回归及 Chrome 页面检查通过。重点覆盖：准备页请求首题；在首题和下一题预演均挂起时仍能开题和启动倒计时；没有有效预演时不模拟乘客；真实玩家问题仍发往 Chatflow 并触发思考；未来题结果不能装入当前题；晚到计划保留已覆盖事实并跳过已问问题；进入下一题复用缓存且只预取再下一题；结算页预取下一局首题并在继续挑战时复用；更换准备页首题后取消旧请求；P0 保留预演但暂停时只缓存。

刷新规则经确认改为准备第 1 题新局，仍保留全局 Dify 会话和用户 ID。下面较早记录中的“刷新恢复题号”是当时行为，本轮浏览器检查以新规则为准。截图保存在本地忽略目录 `tmp/preview-chat-thinking.png`、`tmp/preview-ready.png`。这些检查验证前端并发与时序，不证明 Dify 云端预演的内容或发布状态已通过验收。

## 全局会话与换题回归（2026-10-17）

本地自动回归：

```sh
node --test tests/dify-preview.test.cjs tests/dify-round-context.test.cjs
node tools/dify-workflow-mcp/scripts/test-parallel-host.mjs
```

覆盖跨题/新局/刷新复用会话、旧存储迁移、旧题迟到响应不能覆盖会话、当前题历史与进度筛选、BFF 原话与快照分离、边界字段不可覆盖当前范围、结构化范围不匹配时拒绝返回。

经授权后，用独立的 Dify 草稿测试会话执行：

```sh
node tools/dify-workflow-mcp/scripts/test-parallel-cloud.mjs round
```

使用虚构“安全带→海豚”两题：先记住“小橙”称呼、揭晓首题，保持会话 ID 切到第二题，确认“它是人造的吗”按海豚回答，同时仍记住称呼。检查实际模型输入、`host_result.context_scope`，不能只检查前端传出的字段。该命令调用草稿，不代表发布 API 已验证。

本轮结果：6 项前端/BFF 测试、13 项 Chatflow/情境规则测试通过；Chrome 实际启动、刷新恢复题号、重置保留会话、聊天传边界且无页面异常通过。云端草稿的四轮连续回归通过：记称呼、揭晓首题、按第二题回答、跨题记住称呼。此前失败的模型非 JSON/直接说出谜底行为通过结构化输出修复，守卫未放宽。

当时发布后经本地 BFF 连续五轮验证跨题/跨局记忆；该轮发布 API 未暴露 `host_result`，BFF 标记 `context_verified=false`。后续可靠性版本的三次 API 验证均为 `context_verified=true`，以 [兜底诊断记录](DIFY_FALLBACK_DIAGNOSTICS.md) 为较新证据。测试报告文件位于 Git 忽略目录，不能作为子对话的唯一交接材料。

## 使用目的

每次修改代码、接入 Workflow、调整 UI、增加时间轴或模拟乘客能力后，都按本文检查一遍，避免后续功能变多后出现状态错乱、流程断裂或体验失真。

## 测试环境

推荐横屏窗口：

- 1280 x 720
- 1920 x 1080

当前外层舞台为 `1940 x 1100`，缩放比例取窗口宽度比与高度比的较小值，并整体居中；验收重点是横屏下完整显示、整体不变形、不局部错位。窄屏只检查整体缩放不溢出，不代表已经设计了独立移动端布局。

公网验收：

```text
https://smart-cabin-riddle-demo.vercel.app
```

公网验收结果记录在 [PUBLIC_ACCEPTANCE_REPORT.md](./PUBLIC_ACCEPTANCE_REPORT.md)。

本地运行：

```bash
node dev-server.cjs
```

访问：

```text
http://localhost:4173
```

本地健康检查：

```text
http://localhost:4173/api/health
```

## 快速冒烟测试

用于每次小改后快速确认没有大问题。

### 1. 页面加载

步骤：

1. 打开页面
2. 观察三分区是否正常显示

预期：

- 左上显示中控屏，内容区比例为 16:9
- 左下显示手动控制区
- 右侧显示座舱与环境模拟区
- 右侧显示融合决策面板
- 本地代理联调时可通过 `/api/health` 检查版本和代理状态
- 手动控制区不出现 Workflow 代理配置
- 手动控制区底部固定显示 `副驾` 输入，不是下拉框
- 无明显遮挡
- 页面不出现滚动条
- 页面按窗口宽、高共同约束等比例缩放并居中，允许留黑边
- 中控屏初始为 `.screen-ready`：显示 Logo、规则和开始按钮，不显示“游戏待开始”的题目面板
- 改变窗口尺寸后仍可完整看到三个区域，音乐开关等按钮可以响应
- 控制台无未捕获异常，尤其不能出现 `structuredClone` 的 `DataCloneError`

2026-10-06 启动故障回归：Chrome 已验证 `1920 x 1080`、`1440 x 900`、`1024 x 768`、`390 x 844`，检查舞台边界、resize 监听、准备页显隐和音乐按钮绑定；HTTP 与直接打开本地 HTML 均通过。修复前，默认状态中的 Promise 导致 `structuredClone` 失败，缩放与准备页渲染均未执行。此次浏览器回归没有调用云端模型，也未验证 Safari。

Chatflow 本地校验已覆盖 8 个节点/8 条边、变量引用、Python 代码执行、P0 分支、提示请求拦截和动作白名单；状态同步代理已通过模拟 Dify 响应的 GET/PUT 路径测试。云端草稿已回读确认，但发布后的真实会话同步、模型时延以及各游戏状态下的音乐请求仍需端到端验收。

融合决策真实性回归（`20261006-trace-v2`）：Chrome 四种上述窗口尺寸检查输入事实、具体选择和回执逐项分行、整体缩放及区域不重叠。覆盖气泡实际排队/显示/结束/P0 阻止低优先级话术、环境新事件替代旧事件、过期环境回复不显示、旧回执不污染新面板；音乐用测试播放器分别模拟拒绝播放、成功、旧 Promise 晚于关闭返回；答对灯检查模拟开始/结束/取消。无未捕获异常。测试不调用云端模型，不代表 Safari、真实媒体自动播放或发布后模型时延已经验收。

可复现命令：

```sh
python3 tools/dify-workflow-mcp/scripts/test-host-trace.py
# 需已有本地 Demo 服务与 Playwright；可设置 PLAYWRIGHT_MODULE、CHROME_PATH、DEMO_URL。
node tools/dify-workflow-mcp/scripts/test-trace-browser.cjs
```

Python 8 项回归覆盖事实摘录、环境前后值、回复方式选择、提示拦截、校验失败、音乐授权计划、缺失输入不补“正常”和 P0 分支。仍需发布云端草稿后测试真实 API：新版三栏不再出现固定 100% 置信度、`passed`、通用执行时序；旧接口未发布新版时必须显示缺少决策记录，不编造解释。

### 2. 开始模拟

步骤：

1. 点击 `开始模拟`

预期：

- 游戏从 `游戏待开始` 进入进行中
- AI 主持人气泡出现开场话术
- 主持人话术面向车内乘客，不出现“点击按钮”“时间轴”等出戏表达
- 谜底仍隐藏

### 3. 用户提问

步骤：

1. 手动控制区底部固定显示 `副驾`
2. 在输入框输入：`它是车上的东西吗？`
3. 点击 `发送提问`

预期：

- 副驾头顶出现气泡
- 提问数从 `0/15` 变为 `1/15`
- AI 主持人给出回答
- 游戏状态保持 `进行中`

### 4. 模拟乘客动作

步骤：

1. 触发一次模拟乘客请求，或等待时间轴触发模拟乘客发言

预期：

- Workflow 返回 `passenger_action`
- 对应乘客头顶出现气泡
- AI 主持人对该发言作出回应
- 不应出现睡着乘客主动发言
- 不应在暂停状态下出现模拟乘客主动提问
- 不应由 Workflow 模拟 `副驾` 发言，副驾只代表真实用户

### 5. 时间轴事件

步骤：

1. 点击 `场景切换` 切换黄金体验线
2. 点击 `开始模拟`
3. 等待至少一个事件发生

预期：

- 页面显示当前黄金体验线名称
- 车速、环境、乘客状态或车辆事件自动变化
- 事件变化会同步到座舱区和 Workflow 输入

### 6. 急刹打断

步骤：

1. 点击 `急刹打断`，或等待时间轴触发急刹

预期：

- 游戏状态变为 `已暂停`
- AI 主持人说安全提醒
- 除 `继续模拟` 和 `重置模拟` 外，其他控制不可用
- 模拟乘客不再主动发言
- 急刹后前端会自动恢复游戏状态

### 7. 暂停与重置

步骤：

1. 点击 `暂停模拟`
2. 观察按钮变为 `继续模拟`
3. 点击 `重置模拟`

预期：

- 暂停后除 `继续模拟` 和 `重置模拟` 外其他手动控制不可用
- `重置模拟` 在暂停状态下仍可点击
- 重置后当前黄金体验线回到待开始状态

### 8. 忙时输入排队

步骤：

1. 在 Workflow 正在返回时，立刻输入另一条问题
2. 点击 `发送提问`

预期：

- 输入框和发送按钮不置灰
- 当前座位气泡和互动记录能正常更新
- 新输入不会丢失
- 上一轮 AI 回复完成后，队列中的问题继续提交
- 不出现 AI 连续自发多条无关回复

### 9. 猜对答案

步骤：

1. 输入：`答案是安全带`
2. 点击 `发送提问`

预期：

- 游戏状态变为 `猜对`
- 谜底显示为 `安全带`
- AI 主持人给出 MVP 或胜利话术
- 对应乘客座位氛围灯亮起
- 播放答对音效

### 10. 主持人动画与题目倒计时

步骤：

1. 点击 `开始模拟`，观察主持人默认状态
2. 触发一次需要思考的提问，观察主持人动画和气泡
3. 触发答对状态，观察答对动画与音频
4. 进入游戏中页面后分别观察新题开始、倒计时和最后 10 秒状态

预期：

- 默认主持人使用透明 Sprite Sheet 循环播放，不出现黑色背景
- 主持人思考时播放 `host-thinking` 一次并隐藏说话气泡，结束后回到默认状态
- 答对时播放 `host-yes` 一次，并与 `host-yes.mp3` 同步；动画不会循环或闪回黑帧
- 比心状态播放 `host-heart` 一次
- 新题先显示“第 N 题”约 3 秒，期间不显示倒计时环和剩余提问数
- 题目倒计时总时长为 90 秒，圆环从 12 点顺时针消退，环宽为 8px
- 剩余 10 秒内中控屏边缘红色闪烁；90 秒结束且无人答对时自动进入下一题
- 题目开始 10 秒后出现答案字数提示，并播放 600ms 的放大动画
- 在 Chrome 和 Safari 中检查圆环位置、方向、圆心和线宽一致

## 分享体验脚本

用于模拟部门同事打开链接后的体验。

### 体验目标

用户无需演示者辅助，也能完成一局 AI 猜谜。

### 推荐流程

1. 打开页面
2. 观察默认座舱和当前时间轴
3. 点击 `开始模拟`
4. 用户提问一次
5. 等待或触发模拟乘客参与
6. 等待时间轴触发一次环境或车辆状态变化
7. 继续提问或猜答案
8. 完成一局

### 预期体验

- 用户知道自己可以输入问题或答案
- 其他乘客会自然参与
- AI 主持人不会只回复用户，也会回应模拟乘客
- 时间轴事件让车程有变化
- 事件打断不会导致游戏状态崩溃

## 比赛讲解脚本

适合比赛现场 3 分钟展示。

### 开场讲法

```text
这是一个可分享体验的智能座舱 AI 猜谜 Demo。用户可以作为车内乘客参与游戏，其他乘客由系统模拟。车速、环境、乘客状态和车辆事件会通过时间轴自动发生，AI 主持人基于这些上下文控场。
```

### 演示步骤

1. 展示三分区

```text
左边是中控屏和手动控制区，右边是座舱与环境模拟区。中控屏负责游戏主持，右侧座舱负责表现乘客、环境和融合决策。
```

2. 点击 `开始模拟`

```text
AI 会根据当前座舱状态和谜底主题开场。
```

3. 用户提问

输入：

```text
它是车上的东西吗？
```

讲法：

```text
用户发言、车辆状态、环境状态、乘客状态和游戏状态会一起进入 Workflow。
```

4. 触发或等待模拟乘客发言

讲法：

```text
为了让分享体验更真实，其他乘客不是固定剧本，而是由 Workflow 根据当前游戏状态生成一个 passenger_action。
```

5. 触发时间轴事件

讲法：

```text
多模态感知信息通过时间轴自动发生，比如车速变化、天气变化、有人睡着或主驾疲惫。
```

6. 点击或等待 `急刹打断`

讲法：

```text
急刹是高优先级车辆事件，会立即中断游戏。AI 从主持人切换成安全提醒，模拟乘客也停止发言。
```

7. 等待自动恢复

```text
风险解除后，游戏继续，AI 仍然保留上下文。
```

8. 输入答案

输入：

```text
答案是安全带
```

讲法：

```text
猜中后，AI 揭晓谜底并给出情绪价值。后续同一套座舱状态、时间轴和模拟乘客机制可以复用到其他游戏插件。
```

## Workflow 测试

配置真实 Coze/Dify 接口后执行。

### 1. 开场请求

步骤：

1. 点击 `开始模拟`

预期：

- Workflow 收到 `trigger_type = event`
- `event.type = start_game`
- 页面展示 Workflow 返回的 `ai_reply_text`

### 2. 用户提问请求

步骤：

1. 输入：`它是活的吗？`
2. 点击 `发送提问`

预期：

- Workflow 收到 `trigger_type = chat`
- `player_input` 正确
- `game.question_count` 正确
- 页面展示 Workflow 返回结果

### 3. 模拟乘客请求

步骤：

1. 触发模拟乘客发言

预期：

- Workflow 收到 `trigger_type = simulation`
- `interaction.simulation_request.enabled = true`
- Workflow 最多返回一个 `passenger_action`
- 页面正确展示该乘客发言

### 4. 时间轴事件请求

步骤：

1. 启动时间轴
2. 等待一次事件触发

预期：

- Workflow 收到 `trigger_type = event`
- `event.source = timeline`
- `timeline.current_event` 正确
- 页面按返回结果更新

### 5. 急刹请求

步骤：

1. 点击或等待 `急刹打断`

预期：

- 页面立即暂停
- Workflow 收到 `event.type = hard_brake`
- Workflow 返回 `game_status = paused`
- `passenger_action = null`
- 页面保持暂停态
- 前端随后自动恢复游戏状态

### 6. 猜对请求

步骤：

1. 输入当前谜底
2. 点击 `发送提问`

预期：

- Workflow 返回 `is_correct = true`
- Workflow 返回 `show_answer = true`
- 页面揭晓谜底

## 状态组合测试

### 高速安全模式

步骤：

1. 点击车速 `100` 或 `120`

预期：

- 座舱提示高速安全相关状态
- 主驾参与降低
- 模拟乘客不应频繁选择主驾

### 雨天环境

步骤：

1. 点击 `城区雨天白天` 或等待时间轴切换到雨天

预期：

- 右侧背景更新为雨天
- 前端立即显示本地环境 P1 短句
- 待开局时下一题可切到雨天相关谜底
- 环境事件调用情境 Workflow 更新决策面板，不调用 Chatflow 生成环境话术
- 中控屏背景独立延迟 2 秒切换，切换时重要事件显示区保持可见

### 静默状态同步与超速边沿（历史协议，sync_state 已停用）

步骤：

1. 本节仅用于旧版状态同步记录；当前版本直接随情境事件请求发送快照
2. 在 `110 -> 121 -> 125 km/h` 间调速，再降到 `120` 后升到 `121`

预期：

- 普通速度变化不调用模型；首次越过 120 km/h 的边沿产生一次情境事件
- 第一次进入 `>120` 时触发一次 P1；超速期间后续调整不重复触发
- 回到 `<=120` 后再次进入超速区可触发新事件
- 情境事件请求携带最新车速、环境和乘客状态快照；后台分析本身不显示气泡

### 主驾持续疲惫

步骤：

1. 触发主驾疲惫，并在 15 秒内恢复
2. 再触发疲惫状态并保持超过 15 秒

预期：

- 状态视觉立即更新，但 15 秒内恢复时不主动播报
- 持续超过 15 秒后只主动触发一次疲惫事件，沿用现有事件优先级
- 恢复正常会取消尚未触发的计时器，并静默同步快照

### 自然语言动作白名单

步骤：

1. 任意游戏状态下输入“把背景音乐打开”，再输入“关闭音乐”
2. 输入“打开车内照明灯”或“把空调调低”
3. 答对一题

预期：

- 音乐开关由 Chatflow 识别、输出守卫校验、前端执行，并在执行面板显示结果
- 车内照明灯和空调动作不执行
- 答对计划显示 `cabin-correct-light`，实际灯效仍只由前端答对逻辑触发
- P0 决策层显示 `rule`，普通 Chatflow 回复显示 `llm`

### 乘客睡着

步骤：

1. 让时间轴触发某乘客睡着，或点击 `有人睡着`

预期：

- 对应乘客状态变为睡着
- AI 话术避免 cue 该乘客
- 模拟乘客系统不选择该乘客主动发言

### 快到目的地

步骤：

1. 点击或等待 `快到目的地`

预期：

- AI 进入绝杀局话术
- 游戏保持可继续

## 每题批量逻辑提问链

步骤：

1. 在浏览器 Network 面板中清空请求。
2. 点击开始模拟，检查同源 `/api/workflow` 请求的 `route=preview`、`event.type=start_game`、`round_question_plan_request.generate_host_replies=false`。
3. 确认 BFF 主计划不含 `host_reply_text`；完整计划至少 2 步，新协议 `partial` 安全前缀可为 1 步。题号和倒计时不等待预演完成。
4. 等待两个模拟乘客提问槽位自动播放。
5. 副驾手动问一个与后续步骤相同方向的问题。
6. 触发急刹，确认可以立即打断当前思考态。

新增的渐进提问检查：

- 第1问只问通用类别/普遍属性，第2问问宽泛场景，第3问问一般用途，第4问只问非独有的使用特征；四步计划结束时仍应留下多个候选答案。第5问起才可逐渐引入具体线索。
- 逐步核对每一步的 `expected_answer` 与谜底、提示是否一致；实际主持人回答来自实时 Chatflow，不能补充下一步才应该问到的线索。
- 后一步必须依赖前一步；后续问题应在主持人给出前一问的预测回答之后自然接续。
- 以“雨伞”为例，前四问不应直接问下雨挡雨、折叠收纳；前 3 问的明确线索泄露由输出守卫检查，第 4 问的宽泛程度仍需在草稿测试中人工核对。无效计划不使用本地问题池，该时间轴乘客提问直接跳过。
- 普通有效计划仍只在每题开始时生成一次；每位模拟乘客发问仍请求一次实时主持 Chatflow。

2026-10-17 云端预演**草稿**冒烟：在 Dify 调试页将题目原始 JSON 传给 `input_payload`，不要把上一次 `workflow_output` 再作为输入。分别用“雨伞”和“钥匙”测试四步计划，已观察到 `ai_reply_text=""`、4 个步骤、`debug.validation_errors` 为空。还需在发布后复测运行 API、逐题播放和前四问的语义宽泛度；主持人 Chatflow 的发布回归不能代替这项验收。

预期：

- 模拟乘客的问题呈现逐步缩小范围的逻辑关系。
- 实际座位只会从主驾、左后、右后中选择，并使用该座位人设对应口吻。
- 有效提问链不重复预演；不完整计划按新协议最多发一次后缀修复，每个模拟问题仍请求实时主持 Chatflow。
- 真实副驾提问仍会新增 Workflow 请求。
- Workflow 返回 `covered_fact_keys` 后，模拟链跳过同一事实方向。
- 急刹立即进入安全暂停，不等待预演或实时主持回答；迟到预演及修复只缓存，恢复并匹配目标题后才使用，不覆盖 P0 状态。
- 删除或破坏返回计划后，不模拟该次乘客提问；页面和游戏流程保持可用，不使用本地问题池。

## 回归检查清单

每次提交前确认：

- 页面能打开
- 三分区比例正确
- 左下手动控制区没有遮挡
- 右侧座舱区没有遮挡
- 开始模拟可用
- 用户发送提问可用
- 提问数会增加
- 用户乘客气泡会显示
- 模拟乘客发言可显示
- 每一道题都会抽取一条单题黄金时间轴
- 连续两题不会使用同一条单题时间轴
- 单题时间轴内至少出现两次模拟乘客提问
- 自动提问座位只会是主驾、左后或右后，不会是副驾
- 高速或主驾疲惫时，自动提问不会选择主驾
- 睡着座位不会被选择为自动提问者
- Workflow 输入包含 `selected_seat`、`selected_persona`、`personas` 和 `speaker_source`
- 每题开场输入包含 `round_question_plan_request`
- 有效计划包含有序 `steps` 和人物 `variants`；前端不依赖 `host_reply_text`
- 有效计划播放普通模拟问题时逐问请求实时 Chatflow，不再使用预生成主持回答
- 回退路径的时间轴模拟提问请求设置 `suppress_passenger_action=true`
- 真实用户问题返回的 `covered_fact_keys` 会让计划跳过重复事实
- 时间轴可切换或重置
- 时间轴事件能触发状态变化
- 急刹会暂停
- 暂停时不能继续提问
- 暂停时模拟乘客不主动发言
- 急刹后可自动恢复
- 猜对会揭晓谜底
- 猜对乘客座位氛围灯会亮起
- 答对音效可播放
- Workflow 返回异常时页面不崩

## 分享前最终检查

分享给部门前建议准备：

- 一个公网链接
- 一个固定 Workflow 版本
- 一个默认时间轴
- 一个默认谜题或题库入口
- 一个接口异常提示方案
- 一个比赛现场备用版本
- 一组固定输入文本

固定输入建议：

```text
它是车上的东西吗？
答案是安全带
```

固定事件建议：

```text
急刹打断
快到目的地
```

## 常见故障与处理

### Workflow 没反应

检查：

- 接口地址是否正确
- 接口是否支持跨域
- 是否需要鉴权
- Workflow 是否返回 JSON

处理：

- 对外体验显示 AI 服务繁忙
- 开发环境可切换 Mock 或查看调试信息

### 模拟乘客太假

检查：

- 是否重复问问题
- 是否连续同一人发言
- 是否太早猜中
- 是否在暂停时发言

处理：

- 调整发言意图权重
- 增加已问问题约束
- 增加座位冷却时间

### 时间轴事件冲突

检查：

- 手动事件是否覆盖时间轴
- 时间轴是否在暂停状态仍触发普通发言
- 高优先级事件是否正确打断

处理：

- 优先保证 P0/P1 事件
- 普通模拟乘客事件在暂停时跳过

### 控制区遮挡

检查：

- 浏览器窗口是否过矮
- 是否低于 1280 x 720

处理：

- 放大窗口
- 使用 16:9 屏幕

## 2026-10-17 副驾参与邀请回归

- 本题随机时间轴不再含 `cue_real_user` 或固定的 `passenger_inactive` 步骤；23秒/40秒不再必然出现固定邀请。
- 副驾连续20秒未发言、对话空闲2.5秒且剩余时间大于15秒时，上报一次 `route=situation / passenger_inactive`；不请求 Chatflow，不直接显示本地邀请。
- Workflow返回主动邀请时以P4显示，默认6秒；选择静默时不补话术。
- 正在问答、存在排队输入、环境串词待播、睡眠、暂停、明确想独立思考、最后15秒均不发起邀请。
- 请求返回前出现真实或模拟乘客的新问题、换题或其他新发言时，旧邀请不会替换新对话。
- 邀请结果10秒失效，回显活动版本，不进入后续聊天情境缓存。

验证命令：

```sh
node --test tests/*.test.cjs
node tools/dify-workflow-mcp/scripts/test-parallel-host.mjs tmp/dify-import/participation/situation-candidate.yml
node tools/dify-workflow-mcp/scripts/test-parallel-cloud.mjs participation
```

本次27项前端/BFF测试、15项工作流节点测试通过；云端草稿的有效参与机会、睡眠、拒绝邀请和近期发言四种情况通过。模型实测可选择主动邀请或静默，而非强制到点发言。发布API通过本地4186代理验证了新版本字段与10秒有效期，清醒用户返回有效分析，睡眠用户静默跳过。对应运行分别为 `a77245b9-9100-485b-bef7-6d7a877b7336`、`0dca8387-27ee-4862-b4ac-a57ceb6eebab`，未使用真实玩家会话。

## 2026-10-17 主持回复结构与单次重试回归

- 本地 `node --test tests/*.test.cjs` 共43项通过；工作流节点测试19项通过。覆盖结构化结果优先、仅思考文本不能作为回答、旧JSON文本兼容、重试耗尽、提示拒绝、P0旁路与诊断日志自动定位。
- 关闭思考的试验候选出现过换题属性误判，因此没有发布；最终候选保留 `deepseek-flash`，使用 `thinking=true / reasoning_effort=low / response_format=json_object / max_tokens=4096`。
- 云端验收入口为 `node tools/dify-workflow-mcp/scripts/verify-dialogue-reliability.mjs`。从三次实际失败运行读取原始输入，每条重放三次，检查最终结构、基础属性回答与承接语不主动加线索。
- 草稿故障注入：首次截断应触发一次重试并恢复；首次模型异常应通过默认输出进入重试；两次均截断应停止请求，记录 `retry_exhausted` 并清空事实推进。测试结束恢复原配置；故障注入不会发布。
- Dify可能将模型异常但随后已恢复的运行标记为 `partial-succeeded`。验收同时要求有完整自然回复、有效最终守卫结果、仅一次重试及首个模型异常记录，不能只凭运行标签判断失败或成功。
- 同一会话验证称呼记忆、“安全带”揭晓后切换“海豚”、新题人造属性判断与提示婉拒；只有最终自然回复进入Answer。
- 验证报告与原始测试轨迹保存于忽略目录 `tmp/dify-import/dialogue-reliability/`；发布脚本要求报告hash与当前云端草稿一致。最终发布与接口验收记录见 `docs/DIFY_FALLBACK_DIAGNOSTICS.md`。

## 2026-10-17 主持经验v2回归

- `node --test tests/*.test.cjs`：49项通过，含真实成绩、门槛、连胜中断、偏好、P0失效与换题等待。
- `python3 tests/host-experiences-guard.py`：实际候选图代码与守卫通过。
- `node tools/dify-workflow-mcp/scripts/test-parallel-host.mjs`：19项通过；环境测试按当前云端后台分析分支校验，兼容历史快速分支。`test-host-knowhow.mjs`通过27条经验的字段与历史单模型守卫回归。
- `node tools/dify-workflow-mcp/scripts/verify-host-experiences.mjs`：7项真实Dify草稿运行通过，覆盖个人六题、两连胜、少夸、P0、揭晓中请求夸奖、普通问答和拒绝提示；验证hash与发布hash一致。
- `tests/host-experiences-browser.cjs`：Chrome真实DOM验证P0结束后成就气泡出现、期间不换题，以及主动夸奖不被下一题开场顶掉；路由响应使用协议一致的模拟数据。截图`tmp/host-experiences-feedback.png`已检查。
- `node tools/dify-workflow-mcp/scripts/verify-host-experiences-api.mjs`：独立测试用户经真实本地BFF调用已发布应用，两项通过；成就采用HK12且不缓存、不执行动作，揭晓中聊天正常回应夸奖且不重复揭晓。
- 知识库实际27条分段均completed且enabled。运行报告、原始轨迹、云端备份与发布回执位于忽略目录`tmp/dify-import/host-experiences/`。最新版本和接入范围见[主持经验库v2](HOST_EXPERIENCES_V2.md)。

## 2026-10-18 三应用结构化回复可靠性回归

最新配置、发布hash和原始运行证据见 [可靠性修复](DIFY_RELIABILITY_20261018.md)。本节取代此前JSON模式/原生Schema开启的配置记录。

- 本地 `node --test tests/*.test.cjs`：64项通过；`python3 tests/dify-preview-guard.py`：13项通过；情境表达及主持经验专项守卫通过。
- `tests/dify-graph-contract.py`：三应用共18个代码节点编译、函数参数/输出类型、变量引用/可达性及共享事件/乘员定义检查；思考文本不能通过、字段冲突进入重试、参与邀请版本和睡眠保护均通过。
- `node tools/dify-workflow-mcp/scripts/verify-structured-reliability.mjs`：最终hash对应49次真实草稿运行通过，44次正常运行无节点异常/空回复/固定兜底，5次注入验证双模型有效、内容冲突修复、首次截断/异常恢复和双次截断安全结束；注入图已恢复。
- 原环境失败输入连续6次首次输出有效，强制重试时首次与重试真实输出分别有效。其余覆盖普通问答、提示婉拒、多环境、超速、疲惫、睡眠、目的地、邀请、成就、音乐、P0、三道预演、跨题记忆及新局同会话。
- 三应用发布并读回后，`node tools/dify-workflow-mcp/scripts/verify-structured-reliability-api.mjs`：13次真实BFF请求通过，全部主持模型回复首次有效；预演安全前缀经一次修复达到ready。修复使用返回的 `preview_repair`，不从已去掉主持回答的展示计划组装。
- 真实浏览器：`PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/dify-situation-live-browser.cjs`。环境串词约5853ms可见，无页面错误；情境/主持使用真实发布API，只有预演测试桩。截图 `tmp/situation-dialogue-live.png` 已检查，真实预演由API测试覆盖。
- 常规日志区分最终文本格式失败、内容字段冲突、无效交接和无有效回复；真实模型异常同时检查嵌套 `outputs.error_message`。`diagnose-chatflow-run.mjs --latest --cloud` 可自动读取最近异常及原始节点，不需要手动找运行ID。

全部详细测试轨迹保存在忽略目录 `tmp/dify-import/structured-reliability-v2/`。有限样本不代表供应商永无异常；保持一次重试、最终守卫和可定位的原因码。没有部署Vercel或提交Git；本地服务4186已加载本轮BFF改动。

## 2026-10-18 入睡必启关怀与分心感知增量

- 最新要求：有效入睡且尚未启用关怀时必须启用，分区关灯、音量0、空调调至“用户记忆值”；仍等主持气泡开始显示才执行。覆盖早先自主选择和关闭空调规定。
- `node --test tests/*.test.cjs`：92项通过。
- `python3 tests/cabin-policy-guard.py tmp/dify-import/cabin-policy`：37项通过。
- `python3 tests/cabin-sleep-comfort-guard.py tmp/dify-import/cabin-policy/dialogue-candidate.json`：37项通过，包含空动作/空模型/不完整话术/错误空调说明修复，以及过期、已醒、暂停、重复启用保护。
- `tests/cabin-sleep-comfort-browser.cjs`：浏览器验证设备等待话术、P1排队、四区独立、用户记忆值显示、醒来、重置、环境切换和两种窗口尺寸通过；截图仍位于 `tmp/cabin-sleep-comfort-*.png`。
- 最终草稿14次主持和5次情境真实运行通过，发布版本与验证hash一致。发布API通过 `verify-sleep-comfort-api.mjs` 和 `verify-cabin-policy-api.mjs` 复测：连续两名睡眠乘员均得到动作和记忆值话术，同一会话醒来恢复，以及情境/主持均显示 `driver_state=分心`。
- 真实睡眠主持run：`aee3d17c-c9be-4c84-b34c-d0760fa42969`；第二名：`4f11cb1e-4f8b-4db0-9810-41d9cafb00cc`；醒来恢复：`5d1ee6b1-5695-4456-b68c-a5443ae01610`。完整记录在 `tmp/dify-import/sleep-comfort/api-verification.json` 和 `tmp/dify-import/cabin-policy/api-verification.json`。
- HK05更新4.1，28条经验仍完成索引并启用；仅同步该条，保留其他云端经验。同步命令支持 `node tools/dify-workflow-mcp/scripts/update-host-experiences.mjs knowledge --ids=HK05`，避免覆盖云端其他人工改动。
- 前端缓存版本为 `20261018-required-sleep-memory-v1`；本地地址仍为 `http://127.0.0.1:4186/`。Dify两应用已发布，预演不改；未部署Vercel、未创建Git提交。

## 2026-10-18 多名乘员手动醒来修复

- 真实日志 `775027b2-1774-4c8c-bc65-d56f1813a795` 与 `31f7902a-bf3c-4ded-a341-42464fc8a6f2` 的节点输入：两次手动醒来均为 `seat=rearRight`，当时左后仍睡着，第二次右后已经清醒且只剩左后关怀启用。根因是按钮绑定硬编码，不是模型拒绝恢复。
- 改为每次重新从睡眠状态选目标，优先选中的睡眠座位，否则后排右、后排左、副驾、主驾；无人睡着只提示、不发事件。设备恢复仍走原主持话术流程。
- `tests/cabin-policy.test.cjs` 新增三项：连续两名醒来、选中座位优先/忽略清醒座位残留关怀、实际按钮绑定发送不同座位及无人时不发送。
- 浏览器复测命令：`PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/manual-wake-browser.cjs`，通过真实按钮及4秒冷却验证先右后、再左后醒来，第三次不发重复事件。
- 缓存版本 `20261018-manual-wake-target-v1`。本次增量只改前端，不需要修改Dify发布版本。

## 2026-10-18 多事件优先级队列

- 规范见 [HOST_EVENT_QUEUE.md](HOST_EVENT_QUEUE.md)。非P0不打断当前气泡，等待者按P1→P2→P3→P4、同级FIFO处理；真实乘客排队问题以P2参与排序。新思考动画也不能提前隐藏当前气泡。
- 事件按“类型＋目标”合并，睡着/醒来共享同一座位键，不同座位独立。环境只保留最新。只校验事件自身依赖，无关状态变化不使其丢失；轮到生成时需要刷新快照则重取分析和签名交接，不放宽BFF校验。
- P0保留未完成事件意图，清空旧模型结果与待播话术；恢复后或新题开始重新分析。旧分析/旧模型比替代请求更晚返回时，也不能将新任务标成失败。重置、新局、整局结束取消旧局待办。
- `node --test tests/*.test.cjs`：107项全部通过，覆盖原功能及本次新增：逆序分析返回、同级FIFO、慢P1优先、两个座位独立、同座位睡醒替换、环境变化不取消关怀、P0恢复、交接过期刷新、动作去重、普通回答保留及跨题保护、真实问题FIFO、思考不能提前隐藏旧气泡。
- 浏览器 `tests/multi-event-queue-browser.cjs` 通过：当前回答结束→P1环境回应→左后关怀→右后关怀，三次生成的顺序正确，两个设备动作各一次；`tests/cabin-sleep-comfort-browser.cjs` 原四区/醒来/时序/窗口尺寸回归通过。截图 `tmp/multi-event-queue.png` 已检查。
- `tests/dify-situation-live-browser.cjs` 真实已发布情境→Chatflow→浏览器验证通过，环境回应约8607ms，只有预演使用桩，无页面异常。本次未修改Dify图或发布hash、BFF协议，未部署Vercel、未提交Git。
- 最新前端缓存版本 `20261018-event-priority-queue-v1`；控制台筛选 `[situation-event]` 或查看 `state.workflow.situationEvents` 可按事件ID查询排队、生成、显示、完成或取消原因。

## 2026-10-18 优先级在融合决策面板展示

- 感知显示实际观察和同时发生的事件，不将优先级当作传感信息；决策显示P0–P4前端优先级标签和等待/先行/FIFO原因；执行显示当前回应、接下来前两项和更多待办数量，原有设备回执保留。
- `node --test tests/*.test.cjs`：112项全部通过，新增5项覆盖分阶段空状态、P1回应与P2双座位FIFO、取消后移除旧待办、P0保留待办及不相信模型自报优先级。
- 浏览器：`PLAYWRIGHT_MODULE=/Users/diaoxuanyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node tests/decision-priority-browser.cjs`，验证2380×1120和1024×768窗口，标签不溢出，P1/P2等待说明、P0即时处理、重置后隐藏标签和执行内容均通过。
- 截图 `tmp/decision-priority-desktop.png`、`tmp/decision-priority-small.png` 已检查。显示版本 `20261018-priority-panel-v1` 同时更新脚本/样式缓存，不改Dify规则、不部署线上、不提交Git。
