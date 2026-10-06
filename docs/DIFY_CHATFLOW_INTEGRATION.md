# Dify 实时主持 Chatflow

## 会话与状态

主持人使用现有 Chatflow 应用 `74bef8bd-22bd-4e19-91da-5e8d645dd8ed`。浏览器将一个 Dify `conversation_id` 和稳定的 `user_id` 保存在 `localStorage`，新局和重新打开同一来源链接都继续使用它。不同域名/端口、浏览器配置文件或清理站点数据会建立新会话；不同访客不会共享会话。

Chatflow 启用最近 10 轮的对话记忆，Dify 保留完整会话记录。跨很多局后应监测 token 与时延；如增长明显，再增加滚动摘要变量，而不是更换 `conversation_id`。

Chatflow 草稿包含字符串会话变量 `cabin_snapshot`。它保存最近一次车速、外部环境、目的地、驾驶员/乘客状态与游戏状态快照。前端状态变化时通过 Dify 会话变量 API 静默更新；这类同步不调用模型、不触发主持人话术。下一次事件或聊天请求会同时带当前精简输入和该会话快照，当前输入优先。

两类调用并行工作：

- 状态变化：静默同步 `cabin_snapshot`；速度普通变化不要求主持人发言。
- 重要事件：在座舱状态变化时立即调用 Chatflow。环境变化调用时点仍是右侧座舱背景刚变化；Chatflow 返回的话术不等中控屏延迟切换，也不在前端额外暂存。返回后进入前端 P1 仲裁；若当前正在播报，等待当前话术结束，等待期间新的环境 P1 覆盖旧环境 P1。

中控屏背景继续按既有逻辑延迟 2 秒切换。优先级由前端单点计算并传入 `event.priority`；Chatflow 回显优先级与决策记录，前端继续负责 P1 队列、P0 安全兜底、气泡、动画和计时器。

## 动作权限

Chatflow 只能提出有类型的动作计划，不能直接操作浏览器 UI。第一版前端执行白名单只有：

- `music.set_enabled`：权限设计允许所有乘客、所有游戏状态请求。当前守卫按明确的开/关表达确定布尔参数，覆盖模型可能返回的相反方向；“不要关闭音乐”不授权改变状态。前端执行并记录结果，全状态端到端验收见测试文档。
- `ambient_light.play_preset`：答对时的 `cabin-correct-light` 只作为 Chatflow 执行计划展示；实际仍由前端答对逻辑触发，不根据模型动作执行。

车内照明灯、空调和其它动作不在白名单。提示/线索请求不能授权模型泄露谜底或隐藏提示；输出守卫负责拦截。

## 感知、决策、执行输出

实时 Chatflow 输出：

- `perception`：信号来源、融合结论、置信度。
- `decision_trace`：规则层或模型层、命中规则、前端传入优先级、决策、守卫状态、提示拦截状态。
- `execution`：白名单动作计划、执行时序与降级方式。前端另记录实际执行结果。

P0 安全暂停/答对/超时/整局结束走确定性规则分支；其余事件经导演模型与输出守卫。前端保留急刹立即暂停兜底。超速仅在车速从 `<=120` 进入 `>120 km/h` 时触发一次 P1；主驾疲惫/睡着持续超过 15 秒后触发沿用的疲惫事件等级。

`输入标准化与 P0 预判` 负责解析输入、整理上下文并计算 `is_p0`；`P0 规则分支` 只读取该布尔值，将流程路由到确定性响应或模型节点。两者分别承担业务计算与流程分流。

## API 代理

前端只请求同源 `/api/workflow`。服务端使用 `DIFY_CHATFLOW_API_KEY`（兼容 `DIFY_API_KEY` 和按 app ID 配置的 `DIFY_WORKFLOW_API_KEYS`），密钥不放进浏览器。

普通请求代理到 Dify `POST /v1/chat-messages`，将紧凑 JSON 放进 `query`，并传入持久 `conversation_id` 与 `user_id`。静默同步由服务端代理调用：

- `GET /v1/conversations/{conversation_id}/variables?user=...`
- `PUT /v1/conversations/{conversation_id}/variables/{variable_id}`

请求体只写入 `cabin_snapshot` 的 JSON 字符串。当前快照输入上限为 12 KB。

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

2026-10-06 本次更新后回读的草稿 hash 为 `09cc8c7695fb31628c5c93b4cb943add596dd4d094ec34bc51941c8433bc15a7`，应用 ID 保持不变；本次操作未发布。该 hash 是当次验证记录，下次更新前必须重新读取，不能直接复用。运行 API 使用已发布版本，发布后再验收会话变量、事件和动作的完整链路。
