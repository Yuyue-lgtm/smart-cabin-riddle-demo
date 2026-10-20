# 旅途主持人：阿里云部署与 Dify 迁移

后续日常 Dify 维护统一使用 [测试与发布流程](../../docs/DIFY_ECS_ITERATION.md) 和 `node tools/dify.mjs`。独立测试三应用/知识库已创建，本机已切测试环境；网站仍保留原生产App ID。下文首次迁移中“本机Cloud未切换”的记录仅代表当时状态。

正式保存的无密钥工作流、知识库原文、环境绑定和版本说明见 [dify/](../../dify/README.md)。历史 `tmp/` 迁移源已归档为 [2026-10-20 基线](../../dify/releases/2026-10-20-migration-baseline/VERSION.md)，后续接手无需依赖临时目录；其中 ECS 文件仍是导入模板，不是当前发布图的重新导出。

**最新状态：2026-10-20 已获单独授权并上线 [https://cabinplay.xyz/](https://cabinplay.xyz/)。三套ECS应用已发布，5003已回环隔离，Node/Caddy与systemd已运行。完整当前配置、10次真实接口验收、备份/回退和已知问题见 [生产部署记录](../../docs/ALIBABA_CLOUD_PRODUCTION.md)。下方“尚未发布/未部署”等记录为本次上线前历史，不代表最新状态；Cloud和本机Cloud环境仍未变。**

同日授权修复：`agent_backend`的专用密钥长度错误已修复，仅重建该容器，复查running/0重启、其他容器未变，3应用10次真实BFF回归通过。私有备份及维护端口变为2223等信息见[Agent修复记录](../../docs/ALIBABA_CLOUD_PRODUCTION.md#agent-启动配置修复2026-10-20)。历史下文“Agent尚未修复”不再是当前状态。

上线前阶段快照（2026-10-20，后续已变更）：当时三套目标应用为未发布草稿，28 条经验已索引并重绑，隔离测试发现换题语义问题。后来用户批准按保留问题的范围上线，当前状态以顶部生产记录为准。原 `/opt/dify/docker`、卷、管理员账号及数据库均保留；旧的从零安装/Nginx 草案已移至 `LEGACY_INSTALL.md`，不能在这台已有实例上照搬执行。

## 本次新增的执行工具

这些工具分别针对已审批的首次部署或专项维护，不是通用覆盖更新脚本；下次遇到已有配置停止后应复核，不通过删除已有目录绕过保护：

- `secure-plugin-port.py`：备份Compose/.env，完整配置比对确保只改5003 host_ip，再仅重建plugin_daemon。
- `repair-agent-secret.py`：仅修复已确认的无效Agent Stub密钥启动循环；`--apply`前须单独获得生产变更授权。私有备份、原子改单字段、完整Compose比对、仅重建agent_backend和内部就绪校验；已经合规的密钥拒绝轮换，不输出密钥或原始环境。5项本地单元测试见`tests/test_agent_backend_repair.py`。
- `install-runtime.sh`：官方Node22包与SHA核验、官方Caddy stable APT；不执行整机升级或重装Dify。
- `install-demo.sh`：核验运行包与逐文件manifest、非root用户、私有环境文件、systemd和Caddy；已有服务目录即停止。
- `stage-secrets.cjs`：一次性本机回环表单，将UI中已授权生成的Key写入600临时文件，不打印、不缓存到浏览器；传输并比对正式配置后清理临时副本。不是产品接口，不上传到网站。
- `package-delta.mjs` / `assemble-release.py`：缓慢SSH转发下，复用现有公开GitHub指定提交的相同文件，差异走SSH，按本地manifest逐文件核验后重组；不执行下载仓库脚本。
- `verify-live.cjs`：显式运行才发送已批准的虚构测试数据；验证生产BFF三路API与会话/动作结构，不读取Key或真实聊天。未来重新执行前仍应确认测试范围。

## 目标环境

| 项目 | 目标 | 核对状态 |
| --- | --- | --- |
| ECS | `47.83.188.59`，香港，Ubuntu 22.04，2 核 / 8 GiB / 40 GiB | Ubuntu 22.04.5；上线前复查约22GiB磁盘、4.4GiB available内存 |
| 域名 | `cabinplay.xyz` | 主域及www HTTPS均200、TLS验证通过；HTTP308跳转 |
| Dify | `1.17.1`，`/opt/dify/docker`，主机 `127.0.0.1:8080` | 三套目标应用已发布，生产BFF真实调用通过；已知换题语义问题保留 |
| SSH | `root`，远端 `22`，当前本机 `2223` 客户端转发 | 原2222端口占用后切到2223，沿用既有核验指纹和专用密钥；转发断开不影响网站运行 |
| 公网 Web | Caddy → `127.0.0.1:4173` | Node22.23.3/Caddy2.11.7已安装，systemd启用；Dify管理/DB/5003不对外代理 |

本机对公网 8080、5432、6379 的连接均超时，仅证明该测试路径不可达；不能据此代替远端 Docker 端口绑定和安全组核对。

## 目标草稿迁移结果（2026-10-20）

**本节是发布前的历史快照，不是当前状态；已发布应用和Agent修复结果见本文顶部及生产记录。**

用户单独授权创建知识库、导入三套草稿、复用现有模型并测试，不授权发布或生产服务变更；另明确允许仅将虚构的海豚、雨伞、安全带及模拟状态发送至目标已配置的 DeepSeek 服务。没有使用真实乘客资料或聊天历史。

| 资源 | 自托管实例 ID | 当前状态 |
| --- | --- | --- |
| 主持人工作流 | `b1f6f41d-eb34-4cba-b126-d08ca73052a3` | Chatflow，17 节点，未发布 |
| 情景分析 v1 | `b68a7ef3-f411-49fe-9a9f-92bdfcf40ce4` | Workflow，26 节点，未发布 |
| 提问预演 | `695710b2-b79e-4d8f-ab2f-6cfc543e7674` | Workflow，5 节点，未发布 |
| 旅途主持人经验库 · 阿里云迁移 | `923e8e72-56cb-45c5-9eb4-486a6d5afed3` | 经济型索引，28 条全部可用/启用 |
| knowhow-source.md | `ea3a4ca1-1efa-44a4-a412-8e94daf13a4c` | 28 个完整分段，未拆断记录 |

迁移来源为 `tmp/alibaba-cloud/migrations/2026-10-19T14-55-54-826Z/`，含 source/import/target DSL 和两个 manifest，均 Git 忽略、权限 600。`prepare-target-imports.mjs` 校验源 SHA-256 后只将插件依赖改为已确认安装的 `langgenius/deepseek:0.0.25@32f56796c4f9c3949f2a8cde44a5912f347b5a141dd7daf100048aeefd5e6593`；工作流图和模型参数保持不变。目标接受 DSL 0.7.0。不要用生成器重建业务图，也不要再次导入产生重复资源。

情境节点 `3000000000010`（主持经验知识检索）及 `3000000000024`（揭晓后主持经验检索）已在 UI 重绑新库，保留 TopK=3、关闭 rerank。分段长度 1024，目标 UI 将 overlap=0 限制为最小值 1，与源不同；实际仍生成 28 个完整 JSON 分段。逐条读取 UI 并与来源 JSONL 的序列化内容指纹比对，HK01–HK28 全部一致、启用，HK28 已被真实测试检索命中。经济索引不调用 embedding，索引显示 0 tokens。

真实草稿测试结果及完整限制见 [测试记录](../../docs/TEST_SCRIPT.md#阿里云自托管-dify-草稿迁移2026-10-20)：

- 环境变化：`ready`、P1、申请主动回应，守卫通过；分析本身不输出主持话术。
- 急刹：本地安全分支所需的 `rule` / P0 / observation、无主动话术、无动作，不接管前端。
- 副驾未参与：检索 HK28，申请邀请协作且守卫通过。其 `usable_for_dialogue=false` 是防止邀请进入后续普通聊天缓存的既有规则，不是本次失败。
- 雨伞预演：4/4 步、`ready`，无校验错误或修复；前端仍只消费问题。
- 海豚首问“它是人造的吗”：回答正确。全局会话切至安全带后重复同问，错误回答“不是，它不是人造的”。节点日志已确认运行输入、清洗快照与实际系统提示词均是安全带，不能归因于前端漏传或旧快照。明确追问当前题后回答正确；格式守卫未检出这次语义错误。失败运行 `6e3c75a1-9cf0-4d9a-9d2f-f6701b931b4b`。尚未修改目标提示词修复，发布前必须再验证。

额外发现：来源 HK10 的 title/applicability/example 是四题门槛，但 scenario 和例子的 user 字段仍写六题。目标忠实保留源内容，未借迁移擅自修订；后续需单独核对实际统计规则再统一，不能只改目标其中一句。

公共 DNS 于 `2026-10-19T23:40:02Z–23:40:03Z`（用户时区 2026-10-20）复查：NS 正确，主域/www A 均返回 `47.83.188.59`，NOERROR、TTL 600，取代下方较早 NXDOMAIN 记录。尚未验证 80/443 公网访问及 HTTPS。

当前阻塞与下一步：用户已明确选择“暂不修改，先完成迁移记录”，主持换题语义问题保留，不能据后续“继续”默认为批准修复/发布。后续先复核资源及 agent_backend / 5003 风险，再另行确认发布、创建服务端 Key、部署 Node/Caddy 与端口隔离。未创建目标 App Key、未更改 `.env.local`、未把 Dify Console 或数据库暴露到公网。浏览器调试成功不等于目标 API/BFF/完整游戏验收通过。

连接最新变化：完成 28 条分段核对后，再打开 `/apps` 时 8081 返回 `ERR_EMPTY_RESPONSE`。2222 由本机 Alibaba 进程监听，但 SSH 仍在密钥认证前被远端关闭；这不是已确认的公钥授权失败。已请求重连两个客户端转发，不重启 ECS 或 Dify。此前成功测试及目标资源 ID 保留，通道恢复后从这些资源继续，不重复导入。

后续恢复：用户重连两个转发后，2222 专用密钥执行 `id` 成功，返回 `uid=0(root)`；8081 工作室刷新后也正常显示三套目标应用。没有变更密钥授权或重启任何服务。保留上段用于说明断线过程，不代表最新通道仍不可用。

## 2026-10-19 只读连接检查

后续更新：用户提供实名认证成功、联系人邮箱验证通过截图。`2026-10-19T14:33:18Z` 复查注册局 RDAP，状态仅余 `server transfer prohibited`、`add period`，此前 `client hold` 已消失，NS 未变。Google DNS 的主域及 www A 查询暂仍为 NXDOMAIN，尚不能宣称 A 记录已公开生效；等待更新后复查，不继续修改 NS 或重复提交实名认证。以下较早记录保留作为故障排查过程。

检查时间：`2026-10-19T14:15:52Z`。本节仅记录外部查询、本机端口及公钥指纹检查，没有安装软件、上传部署包、修改密钥授权、创建目标 Dify 资源或重启服务器服务。

- [注册局 RDAP](https://rdap.centralnic.com/xyz/domain/cabinplay.xyz) 返回已注册域名及 `client hold` 状态，登记 NS 与用户提供的 `dns15.hichina.com`、`dns16.hichina.com` 一致。Google DNS over HTTPS 查询主域 NS/A、www A 均为 `Status=3`（NXDOMAIN）。当前不能公开验证阿里云控制台中已填的两条 A 记录；解除 hold 后再检查生效值，不能将控制台记录等同于公共解析已成功。
- `clientHold` 会暂停解析；具体原因尚未确认。先到阿里云域名控制台的基本信息检查锁定提示、实名认证及联系人邮箱验证状态，按实际原因处理；不要仅因旧的 NS 不一致提示继续盲改 NS。见 [阿里云解除 ClientHold 指南](https://help.aliyun.com/zh/dws/support/how-to-unlock-a-domain-name-that-is-in-the-serverhold-or-clienthold-state)。普通转移保护锁不是本次解析故障的同义项，无需一并关闭。
- 本机 `127.0.0.1:2222` 返回 `ECONNREFUSED`，`127.0.0.1:8080` 可连接，Dify `/console/api/system-features` 返回 200。此公共接口没有提供可核实的版本字段，不据此宣称已验证 1.17.1、模型配置或管理员登录。匿名应用列表返回 401，认证资源尚未读取。
- 用户确认 SSH 为 `root@47.83.188.59:22`；安全组此前只允许 `104.249.174.132/32`，实际规则及本次出口尚未在 ECS 侧核对。优先使用阿里云客户端本地转发 `127.0.0.1:2222 -> ECS:22`，不要求开放 SSH 给所有公网地址。
- 本机现有 RSA 公钥为 4096 位，指纹 `SHA256:FtjQwXy7JPJc0WV84XvUab1He1TpI5HmzoRg1DZHPcw`。仅由公钥计算，没有读取私钥内容；尚不能证明该公钥已在 ECS 授权。

在已信任的 Workbench 终端可执行以下只读命令并提供结果；两条都只显示公钥指纹，不显示私钥：

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
ssh-keygen -lf /root/.ssh/authorized_keys
```

第一条用于独立核对初次 SSH 连接的主机身份，第二条用于比对本机 RSA 公钥是否已获授权。若文件不存在或没有匹配公钥，记录结果并另行确认授权方案，不自动追加密钥、不启用密码登录，也不跳过主机身份校验。转发与身份确认后，再运行 `audit-server.sh` 读取服务、资源及容器端口。

## 2026-10-19 远端只读审计

用户已通过 Workbench 独立确认主机 ED25519 指纹为 `SHA256:/OZ8Q9HyG6CdXTKmQXc2qgatJGWHL7yk8JR2MlK4Z3k`，与本机 2222 转发读取值相同。原本机 RSA 密钥公钥登录被拒绝；用户随后明确同意添加部署专用密钥，并在 Workbench 执行追加命令。新 ED25519 指纹为 `SHA256:fNqilHwpuLfie2a7sdFOGmTS+YrxJ2p4/jHYyywzQSo`，授权带 `restrict`，不允许该密钥做端口/agent/X11 转发或分配 PTY，但可执行已授权的部署命令。私钥仅在本机 Git 忽略的 `tmp/alibaba-cloud/` 中、权限 600，未上传；目录本身权限 700。公钥授权是本阶段唯一由用户执行的服务器配置变更；代理执行的后续命令全部只读。

已成功以专用密钥登录 `root`，通过 SSH 标准输入执行 `audit-server.sh`，没有上传脚本：

- 系统为 Ubuntu 22.04.5；根盘 40 GiB，约 15 GiB 已用、23 GiB 可用；内存 7.5 GiB，available 约 4.7 GiB，无 swap。资源是检查当时快照，不代表负载测试通过。
- `/usr/bin/docker` 存在；未在 PATH 发现 node、caddy、nginx；caddy/nginx/smart-cabin-demo 均 inactive，Demo 目录和对应 systemd/Caddy 配置不存在，80/443 未监听。尚未安装或启动任何新软件。
- Dify API、worker、web 的镜像均为 1.17.1；API、Postgres、sandbox 健康，其他核心容器运行中。`docker-agent_backend-1` 反复重启，退出码 1，后续读取时重启计数 175；仅提取日志分类，确认 `ServerSettings` 的 `ValidationError/value_error`，具体配置原因未确定，不输出原始日志或任何环境值，不擅自修复。不能称整个 Compose 全部健康。
- Dify nginx 仅发布 `127.0.0.1:8080/8443`；Postgres/Redis 未发布主机端口。插件 daemon 的调试端口 `5003` 则发布在 `0.0.0.0` 和 IPv6 全地址。UFW 为 inactive；这不等于安全组允许公网连接，实际安全组规则仍未取得。上线前必须核对 5003 的公网隔离；若需要调整 Compose 端口绑定和重启插件服务，先说明影响并取得用户确认。
- 已安装插件目录识别为 `langgenius/deepseek:0.0.25@32f56796c4f9c3949f2a8cde44a5912f347b5a141dd7daf100048aeefd5e6593`。Cloud 正式导出依赖 0.0.24；此处只确认版本差异，不视作兼容性通过，不自动降级、升级或替换节点模型。管理员和模型配置仍需从认证 Console 核对，不读取数据库。
- 认证后公共 DNS 复查主域和 www 仍 NXDOMAIN。SSH 验证完成不等于 DNS/HTTPS 可以上线；保持当前只读阶段，域名生效及具体生产变更确认后再部署。

## 2026-10-19 目标 Console 与权威 DNS 核对

用户开启新的 `127.0.0.1:8081 -> ECS:8080` 转发并自行登录；原本机 8080 转发一度返回空响应，但 ECS 本机状态接口仍为 200，不是 Dify 服务停止。2222 SSH 转发保持可用。

通过已登录浏览器的可见 UI 只读核对：

- 工作室显示“这里没有应用”。知识库切换到“所有知识库”后显示“这里没有知识库”，本轮没有创建资源。
- 模型供应商“深度求索”版本 0.0.25，显示 `API KEY 1`，未展开或读取密钥值；展开模型列表显示 `deepseek-flash`、`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`deepseek-v4-pro` 均启用。配置存在和开关启用不等于真实模型请求已验证。
- 源 DSL 锁定 0.0.24，目标已有 0.0.25。迁移建议先保留目标插件，用独立导入副本验证模型名及参数，不自动降级现有插件；任何依赖改写、导入、模型测试或发布均在下一阶段确认范围内，当前尚未执行。

公共 DNS 检查时间 `2026-10-19T14:51:18Z`，主域/www A 仍 NXDOMAIN。随后从 ECS 直接查询权威 DNS，回答均带 AA：

| 查询 | 结果 |
| --- | --- |
| `ns0.centralnic.net` 查询 `cabinplay.xyz NS` | NXDOMAIN，上级 `.xyz` 尚未提供委派 |
| `dns15.hichina.com` 查询 `cabinplay.xyz A` | NOERROR，`47.83.188.59`，TTL 600 |
| `dns16.hichina.com` 查询 `www.cabinplay.xyz A` | NOERROR，`47.83.188.59`，TTL 600 |

因此已确认阿里云权威记录正确；故障不只是某个本机浏览器缓存，也不能仅靠刷新网页解决。等待注册局解除 hold 后的委派同步，再复查上级 NS 和公共解析；当前不重复修改 A/NS，不启动 HTTPS 上线。若持续无委派，再联系注册商核对同步状态。

后续拟申请先独立执行 Dify 数据迁移：新建一套 28 条经验库、导入三套应用为草稿、重绑检索节点并做隔离测试；不覆盖 Cloud/现有资源、不发布、不安装或重启 ECS 服务。此范围和 Node/Caddy/端口绑定修复分开确认，不能把用户已登录视为全部生产变更授权。

## 分阶段清单

| 阶段 | 自动操作 | 验证与确认边界 |
| --- | --- | --- |
| 1. 源审计 | 读取 Cloud 已发布图、草稿、正式无密钥导出、28 条有效经验 | 三应用草稿/发布一致；本地图与发布一致；清单记录 hash |
| 2. 本地准备 | 生成迁移副本、无密钥运行包、Caddy/systemd 模板，修复 API 地址兼容及生产静态隔离 | 单元回归、隔离服务器请求、归档成员/哈希核对；不改 ECS |
| 3. 远端只读检查 | 核对 SSH 主机指纹、系统资源、磁盘、Node/Caddy、Docker 端口及已有应用 | 不读私钥/环境文件值，不执行 Compose up/down，不连接数据库 |
| 4. 新实例迁移 | 安装/复用匹配插件，新建知识库与三应用，配置模型、绑定依赖、测试后发布 | 先说明将创建哪些资源；已有同名应用或不同插件时先确认，禁止直接覆盖 |
| 5. 部署上线 | 放置运行包、专用用户、私有 Key 文件、systemd、Caddy/HTTPS | 先列出服务/端口变更和备份回退步骤并取得用户确认，再写入或重启 |
| 6. 公网验收 | 页面、三路 Dify、会话、事件、音频、结算 | DNS/HTTPS/私有端口检查及浏览器流程逐项记录 |

## 已核对的迁移源

Cloud 源是已发布的三套应用，不使用旧生成器重建业务图：

| 用途 | Cloud App ID | 图节点数 | 已核对发布 hash |
| --- | --- | --- | --- |
| 主持 Chatflow | `74bef8bd-22bd-4e19-91da-5e8d645dd8ed` | 17 | `5fd8948bda460cb725b10b271ddfa51c33976fc1a6bab66bcee9a3481ee3d6d0` |
| 情境 Workflow | `bc1ce5be-d5c5-4885-84c5-72c2c1f63d18` | 26 | `b3e1a2f11479a7b4aa9ac24dc001aa458b4a7df7e84aa7f18fd66f4219e9194a` |
| 提问预演 Workflow | `bf81cd44-a49f-4048-901f-e95e941dc429` | 5 | `78c269cb39c01529f7c71392ca14011e9e12a4c727130c62365147e52ea67a99` |

正式导出依赖 `langgenius/deepseek:0.0.24`（精确插件标识见迁移 manifest）。本地旧 YAML 的 dependencies 为空，因此迁移必须使用本次正式导出。4 个 LLM 节点都调用 `deepseek-flash`，主持主模型保留 thinking/low 与一次非思考格式重试，其他参数也按源保留。目标实例是否支持 DSL 0.7.0、是否已安装该插件和模型，需登录后逐项验证；不自动换模型或降低校验。

Cloud 知识库 `bc87e197-f268-4710-9697-5185726d0ce3` 使用经济型索引，28 条经验全部 enabled/completed；空行分段、1024 tokens、overlap=0。原库虽然记录 OpenAI embedding 元数据，但当前索引是 economy，两个检索节点均关闭 rerank，迁移先保留原检索方式。

Cloud 的 HK10 与本地同版本稿在 title/applicability/examples 有差异；本次迁移使用 Cloud 当前内容，保留本地原稿。正式导出还会加密 dataset ID，这种 Cloud 引用不适用于新实例。准备脚本将原引用放在来源备份及 manifest 中，导入副本的两个 dataset_ids 暂为空，必须重新绑定目标新库、核对 28 条完整分段后再发布。

在 Mac 项目目录重新生成源包：

```sh
node deploy/alibaba-cloud/prepare-migration.mjs
```

输出写入被 Git 忽略的 `tmp/alibaba-cloud/migrations/<时间>/`，文件权限 600：`host/situation/preview.source.yml` 是核对过的来源备份，`*.import.yml` 是目标导入副本，另含 `knowhow-source.md`、`knowhow-source.jsonl`、`manifest.json`。脚本只读取 Cloud；草稿/发布变化、非预期图差异或经验未完整索引时会停止，不写入 Cloud 或目标实例。

## 后端地址与会话

浏览器继续请求同源 `POST /api/workflow`。Chatflow 上游仍为 SSE，BFF 保留现有解析，再向前端返回结构化 JSON；现有浏览器端并非逐 token 展示。会话/user ID 及当前局题校验保持原实现。

目标实例创建应用后，需要配置全新的 App ID 与 API Key。生产 Key 仅写入 root 私有环境文件 `/etc/smart-cabin-demo.env`（600），不放进代码、上传归档或 Git：

```ini
DIFY_API_BASE_URL=http://127.0.0.1:8080
DIFY_CHATFLOW_APP_ID=目标主持应用ID
DIFY_CHATFLOW_API_KEY=目标主持服务端Key
DIFY_SITUATION_APP_ID=目标情境应用ID
DIFY_SITUATION_API_KEY=目标情境服务端Key
DIFY_PREVIEW_APP_ID=目标预演应用ID
DIFY_PREVIEW_API_KEY=目标预演服务端Key
```

BFF 统一拼接 `/v1`，同时兼容配置末尾已有 `/v1`，避免重复路径。Cloud 会话不能直接用于新实例；新域名是独立浏览器来源，正式验收应确认在该来源跨题、跨局、刷新仍复用目标实例会话。现有本机 Cloud `.env.local` 和管理连接器不自动切换。

## 发布包与服务模板

```sh
node deploy/alibaba-cloud/package-release.mjs
```

脚本仅收录实际运行的页面、脚本、样式、发布信息、Node 服务、API 模块和非隐藏 assets 文件，拒绝资源软链接；不使用整仓库打包。产物在 `tmp/alibaba-cloud/releases/`，含运行文件清单、逐文件 SHA-256、源提交及工作区脏状态；未提交改动也按实际内容打包。整个运行文件集约 44.5 MiB。

- `smart-cabin-demo.service.example`：专用用户、私有 EnvironmentFile、本机 4173、故障自动重启、只读系统及独立日志目录。正式安装前先确认目标目录和 Node 路径。
- `Caddyfile.example`：域名反代、压缩、2 MB 请求限制、180 秒上游响应头等待；不额外托管仓库文件。DNS 与 80/443 必须可达，才执行 [Caddy HTTPS](https://caddyserver.com/docs/automatic-https) 上线验收。
- `audit-server.sh`：只读输出资源、监听端口、服务状态、Dify 容器和 SSH 公钥指纹，不输出环境变量或 Docker inspect 的凭证。
- `nginx-smart-cabin-demo.conf.example`：保留为历史模板，本次不安装 Nginx/Certbot。

实际写入服务前，应保存已有配置、确认 80/443 无冲突。若需要调整 Dify 暴露端口/Compose 配置，先提交具体差异和重启影响取得确认；不能重建 Dify 或删除卷。Caddy 不代理 Dify Console/数据库到公网。

## 验证记录与待办

本轮已通过 160 项本地单元回归（包括三项目标导入副本测试、自托管三路地址、SSE 请求参数、会话保护、生产静态白名单、环境文件/后端源码与软链接隔离、M4A Range、请求大小和 UTF-8 分块处理）。受限沙箱首次运行无法监听隔离测试端口；允许本机测试监听后原代码全量退出码 0，不是业务回归。命令：`node --test --test-reporter=dot tests/*.test.cjs`。本地流程使用桩或隔离临时服务，不代表目标 Dify 或公网已验收。

上线验收还需：三套新应用真实调用、经济型知识库检索命中、环境变化串词、睡眠/唤醒、急刹安全暂停、玩家暂停/继续、换题与结算、刷新会话复用、背景音乐/主持音效、HTTPS 与公网私有端口隔离。

当前产品沿用输入框模拟口述，没有麦克风识别或实时语音链路；本次按现有交互验收。若“语音交互”指另有麦克风接入，应先明确入口，不能标记为已测试。
