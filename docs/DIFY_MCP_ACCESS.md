# Dify MCP 接入验收

验收时间：2026-10-22。此次只修复共享 API 的 MCP 入口和服务说明，不发布、不改写六套工作流、模型或知识库内容。

## 能力与环境

- Dify 原生 MCP 提供应用执行，不提供工作流编辑。工作流草稿写入经已登录的 Console API 完成。
- 当前 Codex `dify-test` 绑定测试主持人应用。另五套 MCP 通过 HTTP 协议独立验收，并非已全部注册到 Codex。
- 六套服务说明已注明应用 App ID、测试/正式身份、知识库 ID 与能力边界；原端点、启用状态及参数配置保留。
- `X-Env: PRODUCTION` 来自实例级 `DEPLOY_ENV`，不能据此判定调用的是正式应用。测试与正式应用共用实例，必须核对 App ID 和知识库绑定。
- 官方说明：https://docs.dify.ai/en/self-host/deploy/configuration/environments

## 验收结果

| 应用 | 测试版 | 正式版 |
| --- | --- | --- |
| 主持人 | MCP 调用通过；草稿写入、回读、恢复通过 | MCP 调用通过；草稿写入、回读、恢复通过 |
| 情景分析 | MCP 返回 ready；草稿写入、回读、恢复通过 | MCP 返回 ready；草稿写入、回读、恢复通过 |
| 提问预演 | MCP 返回 ready，4 步；草稿写入、回读、恢复通过 | MCP 执行成功，但内容校验仍 partial，2/4 步；草稿写入、回读、恢复通过 |

正式预演首次及一次补全均命中 `early_question_clue_leak_3`、`early_reply_clue_leak_3`，保留前两步且未覆盖已接受内容。这是预演生成质量问题，不是 MCP 连接或写入权限失败；此次未擅自修改正式工作流，不能将其内容验收标为通过。

所有写入测试仅临时修改开始节点说明并立即恢复。原有未发布草稿保留，六套已发布内容保持不变。Codex 原生测试主持人工具也已在用户批准后真实调用成功。

证据位于项目私有 `tmp/dify-ecs/`，不应上传包含完整工作流快照的目录：

- 写入与恢复：`2026-10-22T06-47-33-229Z-access-audit/report.json`
- 服务说明更新：`2026-10-22T07-26-25-915Z-mcp-labels/report.json`
- 六套运行：`mcp-audit-2026-10-22T07-36-42-179Z.json`
- 补丁与事务测试：`2026-10-22T07-20-45-416Z-mcp-session/report.json`
- 最终只读复核：`2026-10-22T07-20-45-416Z-mcp-session/final-verification.json`

## MCP 事务补丁

Dify API 镜像：`langgenius/dify-api:1.17.1`。原 MCP 控制器在外层事务上下文中调用会自行提交的应用生成器，后续数据库访问触发 closed transaction。补丁改为普通 Session 生命周期，并在成功返回前提交；异常由 Session 关闭时回滚。

源补丁：`deploy/alibaba-cloud/dify-mcp-session.patch`。测试：`tests/dify-mcp-session.py`，覆盖生成器内部提交后继续访问、正常返回持久化和异常回滚；原代码复现失败，补丁代码三项通过。

持久化方式：仅在 API 服务挂载 `/opt/dify/local-patches/mcp-session/mcp.py` 到 `/app/api/controllers/mcp/mcp.py:ro`，文件权限 0644。未重建 worker、数据库等服务。

已部署模块 SHA-256：`85619e12e31145f75ef92debd5c99d05c1501c1a0650d5951539297ebee70d78`。

服务器回退备份：`/root/cabinplay-backups/2026-10-22T07-20-45-416Z-mcp-session/`。必要时恢复其中的 `docker-compose.yaml` 到 `/opt/dify/docker/docker-compose.yaml`，再运行：

```bash
docker compose -f /opt/dify/docker/docker-compose.yaml config --quiet
docker compose -f /opt/dify/docker/docker-compose.yaml up -d --no-deps api
```

回退将移除该挂载并恢复镜像内原控制器。后续如修改了 Compose 配置，必须先审阅差异，不可直接覆盖更新后的配置。升级 Dify 前应复核上游实现并重新测试，不能让旧控制器挂载覆盖新版本代码。
