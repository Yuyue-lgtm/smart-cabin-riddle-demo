# 本机与阿里云 Dify 连接

## 当前连接方式

本地 Demo、Dify 管理与 API 统一使用固定入口 `http://127.0.0.1:8081`。SSH 直接连接 ECS 公网 `47.83.188.59:22`，转发到 **ECS 本机** `127.0.0.1:8080`；不再依赖阿里云客户端 Session Manager，也不再临时切换到18081等端口。

SSH 由 Mac 的用户级 launchd 管理：登录后启动，进程退出后自动重连，15秒保活、连续3次无回应退出并重新连接。服务名 `xyz.cabinplay.dify-tunnel`，只监听本机回环地址。使用现有 `~/.ssh/id_rsa` 公钥认证和已独立核验的 ECS ED25519 指纹，不关闭主机校验。

公网22的安全组仅放行当前 Mac 出口 IP/32。**更换网络或出口IP改变时，仍须更新这条来源规则**；自动重连不能越过安全组。Mac关机或休眠会停止本机联调，线上 `https://cabinplay.xyz/` 和 ECS Dify 持续独立运行。

管理端8080/8443、插件5003继续仅绑定ECS回环，数据库不开放公网；没有重新部署Dify、修改数据库或发布工作流。

## 日常使用

项目根目录执行：

```sh
node tools/dify.mjs dev
```

启动前自动检查并恢复已安装隧道，核验三套测试应用Key后才启动 `http://127.0.0.1:4175/`。日常无需手动开SSH终端或阿里云客户端。控制台登录会话与服务端API Key独立；维护登录过期不等于游戏API失效。

```sh
node tools/dify.mjs doctor
node tools/dify.mjs smoke
```

`doctor` 无模型消耗：检查本地环境映射、Dify HTTP服务、维护会话自动刷新、三个API Key、4175测试环境和线上正式绑定。报告保存在 `tmp/dify-ecs/doctor.json`，失败阶段明确标识；因隧道失败而未执行的鉴权检查标记为跳过，不误报为Key失效。

`smoke` 要求4175已启动，使用独立虚构用户和安全带/雨伞数据，真实调用测试应用验证问答、会话延续、环境分析→主持串词、P0静默、睡眠/醒来动作及提问预演。会消耗少量模型额度，不发布应用；结果保存在 `tmp/dify-ecs/smoke-latest.json`。

## 隧道维护

```sh
node tools/dify.mjs tunnel status
node tools/dify.mjs tunnel restart
node tools/dify.mjs tunnel stop
node tools/dify.mjs tunnel start
```

`stop` 卸载本次登录的后台任务，已安装文件保留；`start`重新加载。首次安装或更新安装配置使用 `node tools/dify.mjs tunnel install`。`--via-client`仅作为明确选择的备用模式，仍依赖客户端2222，不是默认稳定入口。

配置：`~/Library/LaunchAgents/xyz.cabinplay.dify-tunnel.plist`。运行日志与已核验主机公钥保存在 `~/Library/Application Support/Cabinplay/`，避免后台任务因macOS的Documents目录隐私保护而无法启动。文件仅本机使用，不含API Key或密码。

## 本次故障证据

2026-10-20本地日志出现 `DIFY_CHATFLOW_PROXY_ERROR / HTTP502 / 6ms`，未产生Dify运行ID；本机配置使用8081而该端口没有监听。阿里云客户端日志另连续返回WebSocket `403`，其2222虽监听却在SSH握手前关闭。该链路错误不能归因为模型输出或主持守卫。

现已增加脱敏的 `proxy_failure`：失败阶段、API origin、错误类型和底层网络错误码，保留应用ID/关联ID。`diagnose-chatflow-run.mjs --latest`直接显示这些信息；不保存密钥或请求正文。修复了新增日志分支的一处变量作用域错误，并用模拟ECONNREFUSED覆盖实际异常路径。

本轮已核验：直接SSH认证成功、后台隧道HTTP可用、Dify容器健康、三测试Key与维护会话可用、本地和线上环境绑定正确。真实测试应用10次BFF请求全部HTTP200、主持守卫通过、预演ready/4步；问答约2.4–2.6秒，环境分析约0.9秒、随后串词约3.1秒。使用独立测试用户，没有覆盖玩家会话。

主动SIGKILL已管理的SSH进程后，launchd在约1712ms恢复新进程并通过DifyHTTP探测。验收文件：`tmp/dify-ecs/smoke-latest.json`、`tunnel-recovery.json`、`doctor.json`。该测试验证进程退出后的自动恢复，未伪称已经测试真实Mac重启、长时间断网或更换网络；来源IP改变仍需更新安全组。

185项Node完整回归和`git diff --check`通过。手动唤醒的旧测试夹具补齐被动暂停恢复按钮桩；服务端网络异常分支有独立回归，验证底层ECONNREFUSED被完整记录且不会再次抛出变量错误。
