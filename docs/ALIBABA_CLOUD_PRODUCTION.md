# 阿里云生产部署记录

## 2026-10-20 测试环境与统一发布

已在现有实例创建独立三套测试应用及测试知识库，本地 `.env.local` 切到测试环境（4175），Cloud仅保留历史；正式App ID和Key继续使用原值。完整入口、权限边界与命令见 [DIFY_ECS_ITERATION.md](DIFY_ECS_ITERATION.md)。Mac关机不影响此处线上服务。

已真实执行 `node tools/dify.mjs release --publish`，发布版本 `2026-10-20T05-17-33-943Z-ecs`。相对原正式版，三套业务图、模型参数和知识库内容均无差异；这次用于验证测试/正式发布机制。测试与正式草稿各12次真实BFF回归及各自HK28实际检索节点验证通过，公开网站发布后10次请求全部200、预演ready/4步。未重启网站/Dify容器、未修改数据库、未部署网页代码、未提交或推送Git。

| 应用 | ECS 发布图回读 hash |
| --- | --- |
| 主持 | `d357550934c9db7c8fe195bc356fc44fb66f45a91859e0ce6955f904b8d7ef90` |
| 情境 | `c4433accfa39e7c44c1e095b2e6cd70ba50e89d4a97a2eadffce2740fc961ca9` |
| 预演 | `2062de0b9cd123bc9e7401a222453d159551d859c516650493fed3c9e04e60bb` |

本次真实备份及差异：[release.json](../dify/releases/2026-10-20T05-17-33-943Z-ecs/release.json)；公开请求运行ID：[public-verification.json](../dify/releases/2026-10-20T05-17-33-943Z-ecs/public-verification.json)。旧迁移基线仍保留；下文“未取得目标发布hash/本机Cloud未切换”只代表首次上线时的历史状态，不再作为当前维护结论。

## 当前入口（2026-10-20）

- 主域：[https://cabinplay.xyz/](https://cabinplay.xyz/)
- www：[https://www.cabinplay.xyz/](https://www.cabinplay.xyz/)
- 健康接口：[https://cabinplay.xyz/api/health](https://cabinplay.xyz/api/health)

用户已明确批准发布三套 ECS 草稿、创建独立服务端 Key、安装 Node/Caddy、部署 HTTPS 和 systemd；另批准仅重建插件容器以隔离 5003，并选择网站直接公开、不加访问密码。**已记录的换题语义问题暂不修复，保留在本次发布版本中。** Cloud 应用、本机 Cloud `.env.local`、游戏产品逻辑没有改动。

## 生产拓扑

`浏览器 HTTPS → Caddy → 127.0.0.1:4173 Demo BFF → 127.0.0.1:8080/v1 自托管 Dify → 已配置的 DeepSeek`

| 项目 | 已部署配置 |
| --- | --- |
| ECS | `47.83.188.59`，香港 Ubuntu 22.04.5 |
| Node | 官方 `v22.23.3` linux-x64，下载 SHA-256 通过；`/usr/local/bin/node` 链接到 `/opt/node-v22.23.3-linux-x64/bin/node` |
| Caddy | 官方 stable APT 包 `2.11.7`，双域名 HTTPS、HTTP 308 跳转、自动证书管理 |
| Demo | `/opt/smart-cabin-demo`；`smartcabin` 非登录系统用户运行，仅监听本机 4173 |
| 服务 | `smart-cabin-demo.service`、`caddy.service` 均 active/enabled；Demo `Restart=on-failure` / 3 秒 |
| API Key | `/etc/smart-cabin-demo.env`，`600 root:root`，由 systemd 读取后传给进程，浏览器无 Key |
| Dify | 保留 `/opt/dify/docker` 及现有卷/管理员/数据库；nginx 仅本机 8080/8443 |
| 插件调试 | 5003 改为仅 `127.0.0.1`；Caddy admin 2019 也只监听本机 |
| 访问保护 | 按用户选择不加密码；公开 `/api/workflow` 会消耗模型额度，目前没有新增限流/计费保护 |

Dify 管理端仍通过阿里云客户端 `本地8081 → ECS8080` 访问，未代理到公开域名；SSH 当前通过 `本地2223 → ECS22`（此前为2222，客户端报告端口占用后改为2223）。继续使用此前核验的服务器主机指纹，不因本地端口变化跳过校验。关闭 Mac 的转发不影响已部署网站；它只影响管理/后续维护连接。

## Dify 生产应用

| 用途 | 目标 App ID | 本轮证据 |
| --- | --- | --- |
| 主持人工作流 | `b1f6f41d-eb34-4cba-b126-d08ca73052a3` | UI 已发布，正式 API SSE 结构与会话测试通过 |
| 情景分析 v1 | `b68a7ef3-f411-49fe-9a9f-92bdfcf40ce4` | UI 已发布，环境/P0/睡眠/唤醒正式 API 通过 |
| 提问预演 | `695710b2-b79e-4d8f-ab2f-6cfc543e7674` | UI 已发布，雨伞正式 API 4/4 步 ready |

知识库 `923e8e72-56cb-45c5-9eb4-486a6d5afed3`，28 条已核对，两个情境检索节点重绑；沿用 DeepSeek 0.0.25 与原模型参数。Cloud ID/hash 只作迁移来源，不是这些目标应用的发布 hash；本轮未取得目标发布图的独立 hash，不能把导入文件 SHA 说成发布图回读 hash。

主持图中“旧代理需先适配新输出”的注释是历史说明。发布前已核实当前 BFF 从 `node_finished.outputs.host_result` 读取结构、Answer 仅自然语言，补充相应契约回归；随后生产真实调用证实 `context_verified=true`、守卫 passed，不能改回旧的 JSON Answer 解析。全局同源会话方案保留；Cloud conversation_id 不可跨实例使用，新公开来源独立建立会话。

## 发布与备份

本地可随 Git 管理的业务资料见 [Dify 版本库](../dify/README.md)：完整 Cloud 来源 DSL、ECS 迁移导入模板、28 条经验原文、环境映射及 SHA-256。当前 [基线](../dify/releases/2026-10-20-migration-baseline/VERSION.md) 来自已有迁移材料，不含凭证，也不替代服务器私有备份或 ECS 发布图回读。

- Release：`2026-10-20T01-11-17-680Z-deef2a97388a`。
- 源提交 `80868801854f5d541b2959b33770ee6bd16718b3`，工作区包含未提交的迁移/后端适配；生产并非该提交的纯净检出。本轮没有提交或推送 Git。
- 运行清单：105 文件，46,653,913 bytes；服务目录中的 `deployment-manifest.json` 记录逐文件 hash。该 manifest 不在静态白名单内。
- Mac 客户端 SSH 转发全量上传太慢，已取消该次 SCP；采用现有公开 GitHub 提交 `d7b9873cdc0e713af48f6c654961353950fbcc9b` 的 92 个未变文件 + SSH 传输的 13 个差异文件（约 3.2MB）重组。只复制白名单文件、不执行下载仓库脚本，105 文件均与本地 SHA-256 一致。
- 本地原包 SHA：`1797a36caf306f8ef651533ffb7a4c5de523e66847d73f3e53e2b54070f917cb`。
- 差异包 SHA：`1ee65cdfa44d47bc7319ace710c7f9be14fb3a747d0033d460f0250c31274ad3`。
- ECS 重组包 SHA：`f880e25a748151c43ddbc1130f453f6853d43f2e9b331a619e11e57cb810d38b`。gzip 容器元数据不同，原包/重组包 hash 不同，但逐文件 hash 相同。
- 插件备份：`/root/cabinplay-backups/20261020T011448Z-plugin`，包含原 Compose/.env，目录700、文件600；不对外提供下载。
- Demo 备份：`/root/cabinplay-backups/20261020T014359Z-demo`，保留安装后原始 Caddyfile 与暂存位置。
- 插件覆盖文件：`/opt/dify/docker/docker-compose.override.yaml`，只对 plugin_daemon 的 ports 使用 `!override`。应用前对比完整 Compose，确认唯一差异为 5003 的 host_ip，随后仅 `up --no-deps --force-recreate plugin_daemon`；其他 Dify 容器启动时间未变。
- 临时密钥通过一次性回环表单、SSH 加密传输；不进入工具输出、静态包或 Git。完成正式环境文件比对后清理本机/远端临时副本，正式 `/etc/smart-cabin-demo.env` 保留。

部署脚本见 [部署目录](../deploy/alibaba-cloud/README.md)。`install-runtime.sh` / `install-demo.sh` 是首次安装脚本，检测已有目录/配置会停止，不是后续覆盖更新脚本。下次更新应先生成新 release、备份当前服务文件和 manifest，再确认切换，不重复创建知识库或重装 Dify。

## 验收证据

主域和 www HTTPS 均返回200，TLS 验证值0；HTTP 返回308并跳转HTTPS。公网 `.env.local`、`.git/config`、后端 JS、开发服务源码、本地诊断入口、`/console/api/apps`、`/v1` 均404；背景音乐 Range 0–99 返回206 / 100bytes。生产健康接口显示三目标 App ID 配置正确；`local_diagnostics.enabled=true` 指服务端仍写脱敏日志，不表示公网开放本地诊断入口。

全部161项本地单元回归通过。`verify-live.cjs` 使用独立虚构测试用户 `ecs-acceptance-1792460683754-fictional-user`，安全带/雨伞及模拟座舱状态，经生产 BFF 调用正式 API，10 个请求全部200：

| 检查 | 时长 | Dify run ID |
| --- | --- | --- |
| 乘客提问 | 2240ms | `a60c67b1-fe3f-478f-8554-32a3ba4992fc` |
| 同一会话续聊 | 2334ms | `859c3942-b691-4998-9b01-e2324a77fbef` |
| 环境分析 | 872ms | `2d966e94-173b-464b-aa59-8baa0826a0e1` |
| 环境 Chatflow 串词 | 2404ms | `fe866621-b922-48fc-9bed-285c3cd32807` |
| 急刹 P0 旁路 | 615ms | `1aa679af-218b-4c2b-9a31-1474b4ed3e8d` |
| 入睡分析 | 7277ms | `4d1294c0-0021-4f86-bc37-6a75dbed5dce` |
| 入睡话术与关怀动作 | 3686ms | `89f74619-8d38-4b56-85b6-b788f4ab27ce` |
| 醒来分析 | 1958ms | `9e799ce9-a588-4821-8601-2c280012bbed` |
| 醒来话术与恢复动作 | 2313ms | `25bfd4bf-19e0-472e-b36a-526bae465347` |
| 雨伞四步预演 | 2191ms | `c5138684-2766-45a5-afa4-97e0bca85e93` |

主持回复验证：结构化 host_result、当前局/题/scene 范围、guard passed、自然文本不含谜底/内部字段；续聊 conversation_id 相同。环境有有效签名交接；P0 无主动话术及交接；睡眠/唤醒分别包含目标后排右的 apply/restore 动作。预演 ready / 4步，前端输出不含 host_reply_text。测试只验证接口建议，不假称已操作真实车辆设备。

浏览器已取得线上准备页实际截图，人物/背景及三分区有显示；后续读取控件的自动化连接超时，未完成线上点击流程、刷新持久化、六题到结算、听音或桌面/移动完整回归，不能声称全部端到端通过。公网测试来自当前网络及ECS，不代表已覆盖中国大陆各运营商链路。当前产品仍用输入框模拟口述，没有新增麦克风识别。

本机实际截图：`tmp/alibaba-cloud/production-ready-20261020.jpg`；去除黑色留边、保留完整三分区内容的截图为 `tmp/alibaba-cloud/production-ready-content-20261020.jpg`。两者均Git忽略，不是Figma或本地页面的替代图；临时验收视口已恢复默认。

## 已知问题与维护边界

1. Dify迁移调试会话中，同一会话换题后重复属性问句曾沿用旧回答。前端/BFF已有当前题边界、当前题历史过滤和过期请求拦截，且线上前端与本地一致；6项换题本地回归通过。但范围校验不验证回答真伪；尚未通过真实前端完整换题链路复现或排除，不能直接判断已有保护失效。用户明确选择暂不修正；失败运行和节点证据保留，不得用新部署/API成功抹去此项。
2. `agent_backend` 启动配置错误已获授权修复，详见下节。其内部接口和三路工作流回归通过；未测试新 Agent 沙箱完整执行链，不能把本次验收等同于所有 Agent 功能验收。
3. 来源 HK10 四题/六题描述矛盾仍保留；需结合实际统计规则另行统一。
4. 睡眠链路首次上线验收约11秒，Agent修复后该次样本约4.3秒；两次单样本不能证明Agent修复带来性能提升，或代表稳定延迟。可后续分析模型/检索节点，本轮未改业务策略。
5. 本地 Cloud 管理连接器没有迁移成 ECS 连接器。后续子对话务必先确认目标 ID/实例，旧 `update-*.mjs` 默认可能操作 Cloud，不能直接沿用发布命令。

查看服务仅需已有 SSH 授权；不在聊天里粘贴环境文件、完整模型 payload 或原始 Docker 环境：

```sh
systemctl status smart-cabin-demo caddy --no-pager
curl -s http://127.0.0.1:4173/api/health
journalctl -u smart-cabin-demo --since '10 minutes ago' --no-pager
```

回退需另行确认：首次上线无旧 Demo release，可停止新 Demo、恢复备份 Caddyfile 后验证/加载；不要删除 Dify 数据卷、恢复整个数据库或直接套用旧安装方案。后续有用户数据后更不能重跑首次安装脚本。5003 回退只涉及本轮 override 与插件容器，恢复全网卡监听会降低隔离，必须重新确认，不自动执行。

## Agent 启动配置修复（2026-10-20）

用户确认“检查密钥用途、备份配置、仅重建必要容器并回归三应用”后执行。日志根因：`DIFY_AGENT_SERVER_SECRET_KEY must decode to exactly 32 decoded bytes`。有效Compose中原值解码为36字节，不满足1.17.1要求的无填充base64url编码32字节。该密钥用于Agent Stub短期JWE连接令牌；不是Dify数据库、模型凭证或应用API Key的密钥。官方代码在启动时即校验，原配置不能正常签发这类令牌；另检查API的configs/core/services Python源码，没有此变量的直接引用。未读取或修改数据库。

- 修复工具：[repair-agent-secret.py](../deploy/alibaba-cloud/repair-agent-secret.py)。仅用于已确认的无效密钥启动循环；密钥已合规时拒绝执行，不能作为常规轮换脚本使用。
- 服务器本机生成 `secrets.token_urlsafe(32)`，原子更新 `/opt/dify/docker/.env` 中唯一的该变量。未输出密钥，未改其他密钥、工作流图、发布版本或游戏逻辑。
- 私有备份：`/root/cabinplay-backups/20261020T022744Z-agent-secret`，目录700，`.env`、Compose/override及无密钥`receipt.json`均600；正式`.env`也为600。
- 完整Compose前后比对只允许这一变量变化。因原Compose共享`.env`，8个服务定义会包含新值，但实际仅执行 `docker compose up -d --no-deps --pull never --force-recreate agent_backend`。其他运行容器的ID及重启次数均未变，不为刷新未使用的变量而重启其他服务。
- `agent_backend` 于 `2026-10-20T02:27:45Z` 启动；`02:30:03Z`复查仍running、重启次数0、启动后ValidationError计数0。实际镜像的`ServerSettings()`及解码32字节断言通过。
- 从API容器访问 `http://agent_backend:5050/openapi.json` 返回200且标题匹配。5050没有发布到宿主机；不是新建公网管理接口。此版本未以不存在的`/health`路由作为健康判据。
- 主域、www、公开`/api/health`均200；三应用仍配置正常。161项本地Node回归及5项修复脚本单元测试全部通过。生产服务单元测试首次因沙箱监听限制退出，授权回环监听后原样重跑通过，未为此更改代码。

修复后通过生产BFF发送虚构安全带/雨伞与模拟座舱数据，独立用户 `ecs-acceptance-1792463299360-fictional-user`，共10请求均200：

| 检查 | 时长 | Dify run ID |
| --- | --- | --- |
| 乘客提问 | 2201ms | `f402b05f-a07c-4bd9-a948-d5aedad85e18` |
| 同会话续聊 | 2312ms | `f05756ff-a968-4b62-b320-de4cbed9d55f` |
| 环境分析 | 864ms | `1a3b61d7-04d4-4ea7-9f38-06595e2e93f4` |
| 环境串词 | 2289ms | `5e8be7f2-094d-4456-b9c0-2d8604026d39` |
| 急刹P0后台通知 | 682ms | `03c6daa1-4e06-45cf-a3bc-86222ea25762` |
| 入睡分析 | 1815ms | `ae746e1d-37f3-41f7-8c8f-0773b1db7233` |
| 入睡话术/动作 | 2498ms | `6fafced8-b5fb-4a8a-8cb3-ba9e1e2662f4` |
| 醒来分析 | 1422ms | `8375a53a-d319-4617-8e7d-0487e68902bb` |
| 醒来话术/动作 | 2276ms | `33eabbd6-a58c-4cc3-a808-ec5774f7134e` |
| 雨伞预演 | 2079ms | `679b1f35-41d8-4dcc-830b-482ae3380201` |

验证沿用上线验收断言：当前作用域、结构化守卫、同会话复用、有效情境交接、P0不申请主动回应、睡眠/醒来动作及预演ready/4步。没有据此宣称解决换题语义问题或完成真实设备控制/浏览器听音验收。

回退材料已保留，不自动套回旧`.env`：备份中该密钥仍无效，恢复会重新引发启动失败。若后续确需回退，应另行确认仅回退本次字段和Agent容器，不能恢复整套数据库/卷或撤销5003隔离。未提交或推送Git。
