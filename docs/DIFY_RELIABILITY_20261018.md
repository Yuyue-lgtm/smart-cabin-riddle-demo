# Dify 回复可靠性修复（2026-10-18）

本文记录真实失败追踪、最终配置及回归证据。云端发布状态和 hash 以 [当前状态](DIFY_CURRENT_STATE.md) 为入口；任何后续写操作仍需实时读取草稿，不能拿历史 hash 覆盖新的修改。

## 查到的问题

原环境事件的情境运行 `8dc71fe7-2872-4663-869c-400ae88e7f67` 正常申请发言，但 Chatflow 运行 `27ae6d6c-1661-4aa4-84d4-6b671a2cfcee` 的主模型和重试模型均因 `<think>` 内容无法解析为结构化回复而异常。事件关联、局、题、情境版本及有效期都通过，失败来自生成与解析路径。

对本地 2026-10-17 起的 324 条完成记录及 12 个代表性云端运行检查发现：136 个聊天请求中，5 个在重试后恢复、3 个重试耗尽、4 个情境回应被跳过；122 个情境请求和66个预演请求没有 HTTP 错误。抽查的10次模型节点异常都属于结构化解析失败；抽查未发现 Python 代码节点崩溃。这批记录混合人工体验和自动测试，不是线上失败率统计。

扩大回归还发现以下独立原因，不能只靠关闭思考解决：

| 原因 | 证据与后果 | 本次处理 |
| --- | --- | --- |
| 推理与最终输出混在原生 JSON 解析前 | `<think>` 被当成 JSON，主模型和重试重复失败 | `reasoning_format=separated`；只把最终 `text` 交给代码解析 |
| 提供商 JSON 模式偶尔返回纯空白 | 非思考候选的连续对话也曾两次返回空白；原生解析直接异常 | 不启用提供商 `response_format=json_object`，也关闭 Dify LLM 节点的原生提前解析；最终文本仍必须通过同一份 JSON Schema |
| 自然语言 Memory 导致格式漂移 | 模型回答“不是。”，内容正确但没有 JSON 包装 | 模型本轮 query 模板末尾增加应用格式约束；Dify 保存的实际玩家 query 仍为原话，不把座舱快照写进聊天历史 |
| JSON 语法正确但字段互相冲突 | `invite_collaboration` 配 `target_seat=null`，原来只在最终守卫拒绝，没有重试 | 在重试判断前复用最终守卫；格式、内容或动作字段校验失败都最多修正一次 |
| 云端嵌入代码与源文件不同步 | Chatflow 漏了 `passenger_inactive`，守卫的清醒状态表缺少“普通”等实际状态 | 同步共享定义；系统事件清空“当前发言者”；邀请同时检查当前参与版本、清醒状态与作用域 |
| 错误信息被包装 | `node.error=Unknown error`，实际原因在 `outputs.error_message` | BFF和诊断脚本同时读取两处，并只在本地常规日志中保存原因分类 |

## 最终运行方式

主持人继续使用 `deepseek-flash`。主模型保留 `thinking=true / reasoning_effort=low`，重试模型使用 `thinking=false`；两者 `max_tokens=4096`，推理与最终文本分离。关闭思考的试验候选出现过自相矛盾的属性回答，因此没有用它作为最终主模型配置。

情境判断模型和预演模型显式关闭思考，不再依赖提供商的默认值；输出上限分别为4096和6144。情境与预演的模型调用异常最多在节点内重试一次。它们的业务输出格式、守卫、预演安全前缀及一次修复规则继续沿用。

主持人调用链：

```text
主模型最终 text（reasoning_content 不参与解析）
  -> 清理完整思考标签/代码围栏；拒绝未闭合思考与无效 JSON
  -> dialogue-output.schema.json 校验
  -> 复用最终内容与动作守卫预检
  -> 有效：直接进入最终守卫
  -> 无效：一次重试，附带具体校验原因
  -> 两次仍无效：明确记录 retry_exhausted，按原规则静默或请乘客重问
```

关闭 LLM 节点原生提前解析，不代表接受任意文本：`intent`、`reply_mode`、`strategy`、座位、动作类型、布尔值、必填字段及额外字段仍由相同的 JSON Schema 校验。推理段、空白、裸句、缺字段及越权回复都不能直接作为成功结果。最终谜底、提示、动作、当前题及 P0 保护继续执行；预检没有执行任何 UI 或车辆动作。

主模型不叠加节点内重试，通常一次调用，异常最多两次。最终守卫与预检来自同一份代码，避免分别维护两套条件。只有最终自然语言 Answer 进入聊天记忆，模型失败内容和中间 JSON 不作为新的对话轮次。

## 维护入口

- `scripts/lib/structured-reliability.mjs`：在最新云端图上定点修改；同步共享定义、模型设置、模型输入格式约束和预检节点。补丁可重复执行，不叠加包装层。
- `workflows/host/src/dialogue_model_output.py`、`dialogue_retry_result.py`：最终 JSON Schema 与守卫预检、两次尝试及原因码。
- `workflows/host/src/dialogue_event_input.py`：系统事件无当前发言者；参与邀请校验版本与清醒状态。
- `workflows/parallel/host-dialogue-v4.yml`、`cabin-situation-v1.yml`，以及 `workflows/preview/question-preview-v1.yml`：发布后读回的图。
- `scripts/audit-workflow-reliability.mjs`：汇总本地记录并抽查原始云端节点。
- `scripts/diagnose-chatflow-run.mjs --latest --cloud`：自动定位最近异常、读取真实错误和历史运行图，不需要玩家提供运行 ID。

可复用命令（相对于项目根目录）：

```sh
node tools/dify-workflow-mcp/scripts/update-structured-reliability.mjs status
node tools/dify-workflow-mcp/scripts/update-structured-reliability.mjs prepare
node tools/dify-workflow-mcp/scripts/update-structured-reliability.mjs save
node tools/dify-workflow-mcp/scripts/verify-structured-reliability.mjs
node tools/dify-workflow-mcp/scripts/update-structured-reliability.mjs publish
node tools/dify-workflow-mcp/scripts/update-structured-reliability.mjs sync-local
node tools/dify-workflow-mcp/scripts/verify-structured-reliability-api.mjs
```

保存前检查最新 hash；发布只接受与当前三份草稿 hash 完全相同的通过报告。故障注入仅在草稿上执行，并在 `finally` 中恢复原图；正式发布不包含注入配置。测试使用独立会话，不重置真实玩家的全局会话。测试中断后只有草稿 hash 一致才可 `--resume`，哈希变化必须重测。

原始测试和回读备份保存在忽略目录 `tmp/dify-import/structured-reliability-v2/`（0600），不提交密钥或原始模型内容。

## 验收范围

最终三个草稿已发布并读回，当前hash：

| 应用 | 发布hash |
| --- | --- |
| 主持 Chatflow | `6b6a6df4123bb8cf3ade495e8a728ad75b90d04d8914fc710aa0a122031cd29c` |
| 情境 Workflow | `35bfd41d09c9447886f035462cec387b3d7d0c516499e2e149d1b3cfec48c1a0` |
| 提问预演 Workflow | `78c269cb39c01529f7c71392ca14011e9e12a4c727130c62365147e52ea67a99` |

最终草稿回归49次通过：44次正常运行没有模型节点异常、空回复或固定兜底，5次故障注入符合恢复或安全结束预期。原失败环境输入连续6次首次调用有效；强制经过重试分支时，首次和重试各自的真实模型输出均通过校验。

发布后经本地4186代理的13次真实API请求通过，覆盖环境分析/表达、属性问答、称呼记忆、跨题及新局同会话、副驾邀请、P0后台分析和预演。所有模型生成的主持回复首次有效；普通答对走确定性分支。预演首次保留2个安全问题，使用BFF的完整 `preview_repair` 信封后一次修复为4个，状态 `ready`，对应运行 `9369d84f-f037-4b9b-9e46-793f39bca199`、`68969fb0-24d7-4000-ab89-8bf81e17ac48`。测试脚本最初误用移除主持回答的展示计划组装修复请求，导致 `accepted_prefix_invalid`；已改为与浏览器相同的修复协议，不修改业务守卫。以后修复仍允许以安全 `partial` 结束，不无限重试，也不降低安全标准。

真实浏览器联调环境串词约5853ms，页面无脚本错误，主持人话术实际可见。此项主持和情境使用已发布API，预演使用测试桩；真实预演由上面的API验证另行覆盖。截图 `tmp/situation-dialogue-live.png` 已检查。报告分别为 `verification.json`、`published-api-verification.json` 和 `historical-audit.json`。

云端回归覆盖原失败环境输入反复重放、属性问答、提示婉拒、承接语、多个环境切换、超速、疲惫、睡眠、目的地、参与邀请、P0、正确答案规则、跨题会话与称呼、音乐动作、三道预演及其修复。另强制验证两个模型都有效、字段冲突修正、首次截断恢复、两次截断后安全结束、首次模型异常后恢复。

本地回归覆盖64项前端/BFF测试，13项预演守卫测试，18个云端代码节点的编译/函数参数/输出类型与变量引用检查，以及思考段隔离、字段冲突、参与版本、睡着/未知乘员保护等专项检查。前端执行列现在区分格式错误、内容字段冲突、事件交接失效和没有有效回复。

有限回归证明本次输入与配置下的行为，不保证提供商永不超时、返回空内容或产生语义错误。保留一次重试、最终守卫和可关联的原因记录，避免将这类问题掩盖成固定安抚话术。

本轮没有提交Git或部署Vercel前端/BFF；Dify三应用的发布独立生效。本地服务已重启，测试地址 `http://127.0.0.1:4186/`。

参考：[Dify 推理分离字段定义](https://github.com/langgenius/dify/blob/main/web/app/components/workflow/nodes/llm/types.ts)、[DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[DeepSeek JSON模式及空内容说明](https://api-docs.deepseek.com/guides/json_mode/)。
