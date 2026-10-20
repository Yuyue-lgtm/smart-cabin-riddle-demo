# 历史部署草案

本文为早期从零安装及 Nginx 方案的历史记录。当前 ECS 已有 Dify 1.17.1，不要执行本文中的 Dify 克隆、复制环境文件或重新安装步骤。当前迁移和 Caddy 上线流程以 [README.md](README.md) 为准。

本项目是无构建步骤的静态前端加 Node.js Dify BFF。建议在阿里云同一台 ECS 上运行 Demo 和自托管 Dify：生产流量由 Nginx 接收，Node 只绑定 `127.0.0.1:4173`，Dify API 通过本机地址访问；Dify Key 只放在 Demo 服务的服务器环境文件中。

## 先决定地域和域名

要让中国大陆用户稳定访问，优先选阿里云中国大陆地域 ECS，并使用自己的域名。域名解析到中国大陆服务器对外提供服务前需要完成 ICP 备案；服务器在香港或海外则不需要 ICP 备案，但大陆用户的访问表现可能不同。若域名已在其他服务商备案，迁到阿里云通常还需要办理接入备案。具体要求以阿里云备案控制台及主体所在地管局审核为准。

若还没有域名，先注册并完成实名认证。若已有域名，先确认备案主体、备案号和接入服务商状态。阿里云当前要求用于备案的 ECS 是符合备案条件的中国内地实例；购买规格和备案资格以控制台实时显示为准。

## 创建 ECS

建议使用 Ubuntu 24.04 LTS 和固定公网 IPv4。若 Demo 与 Dify 同机，建议从 4 vCPU / 8 GiB 起步；Dify 官方 Docker Compose 最低要求为 2 CPU / 4 GiB，此外还要给 Node、Nginx 和系统留资源。若先只部署 Demo，2 vCPU / 2 GiB 通常足够，之后可扩容或迁移到独立 Dify 实例。

安全组入方向只开放：

- TCP 80、443：来源 `0.0.0.0/0` 和 `::/0`。
- TCP 22：来源限制为你当前的固定公网 IP，不要长期对全网开放。

Node 的 4173 和 Dify 的 8080 端口不加入公网安全组。Node 只监听本机回环地址，由 Nginx 转发；Dify 管理页面通过 SSH 隧道访问。

## 准备代码和服务器

先 SSH 登录 ECS，创建专用服务账号和代码目录：

```sh
sudo useradd --system --user-group --home-dir /opt/smart-cabin-demo --create-home --shell /usr/sbin/nologin smartcabin
sudo install -d -o smartcabin -g smartcabin /opt/smart-cabin-demo/tmp
```

安装基础软件和 Node.js 22 LTS：

```sh
sudo apt update
sudo apt install -y ca-certificates curl nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version
```

版本应为 `v22.x`。项目使用 Node 自带模块，没有 `npm install` 或构建步骤。

从 Mac 上传仓库文件（在项目目录执行；将 `ubuntu` 和 IP 换成实际 SSH 用户与 ECS 公网 IP）：

```sh
tar -czf /tmp/smart-cabin-demo.tar.gz \
  --exclude='./.git' --exclude='./.env' --exclude='./.env.*' \
  --exclude='./node_modules' --exclude='./tmp' --exclude='./dist' .
scp /tmp/smart-cabin-demo.tar.gz ubuntu@ECS公网IP:/tmp/
ssh ubuntu@ECS公网IP 'sudo tar -xzf /tmp/smart-cabin-demo.tar.gz -C /opt/smart-cabin-demo --no-same-owner && sudo chown -R smartcabin:smartcabin /opt/smart-cabin-demo && rm -f /tmp/smart-cabin-demo.tar.gz'
```

该归档不包含本地密钥、Git 历史或诊断日志。每次更新可重复这三条上传命令，再重启 systemd 服务。

## 配置 Dify Key

### 在 ECS 自托管 Dify

按[阿里云 Docker 安装指南](https://help.aliyun.com/zh/ecs/user-guide/install-and-use-docker)安装 Docker Engine 和 Docker Compose v2，并安装 Git。Dify 官方快速启动要求 Compose v2.24.0 或更新版本。之后从 Dify 官方仓库检出一个固定版本到 `/opt/dify`，不要直接跟随未验证的 `main`：

```sh
sudo apt install -y git
DIFY_TAG='替换成已验证的Dify版本标签'
sudo git clone --depth 1 --branch "$DIFY_TAG" https://github.com/langgenius/dify.git /opt/dify
cd /opt/dify/docker
sudo cp .env.example .env
sudo nano .env
```

在 Dify `.env` 中将 `EXPOSE_NGINX_PORT=8080`，并检查 Dify 默认密钥、数据库密码和 `SECRET_KEY` 已更换为随机强值。Dify Nginx 通过主机 8080 端口提供 Console/API；不要在阿里云安全组开放 8080。启动：

```sh
sudo docker compose up -d
sudo docker compose ps
```

建议先用 SSH 隧道打开 Console，再初始化管理员：

```sh
ssh -L 8080:127.0.0.1:8080 ubuntu@ECS公网IP
```

浏览器访问 `http://127.0.0.1:8080/install`。建议先在 Dify Cloud 分别导出主持人 Chatflow、情境 Workflow、提问预演 Workflow 的 DSL，再导入自托管实例。导入后需要重新配置模型供应商凭证、逐个发布应用并获取新的 App ID 和 API Key；如果工作流引用知识库或插件，还要在新实例里迁移/重建对应资源。Dify Cloud 的会话记录不会随 DSL 一起迁移。

Demo 服务通过 `http://127.0.0.1:8080/v1` 调用同机 Dify API。导入应用、配置模型并完成 API 调用验证后，再配置 Demo 的环境变量。

### 配置 Demo 的 Dify 连接

在 ECS 创建仅 root 可读的 `/etc/smart-cabin-demo.env`，填入自托管 Dify 的 API 地址、三个新 App ID 和服务端 API Key：

```ini
DIFY_API_BASE_URL=http://127.0.0.1:8080/v1
DIFY_CHATFLOW_API_KEY=自托管实例的主持人Chatflow_Key
DIFY_CHATFLOW_APP_ID=自托管实例的主持人App_ID
DIFY_SITUATION_API_KEY=自托管实例的情境Workflow_Key
DIFY_SITUATION_APP_ID=自托管实例的情境App_ID
DIFY_PREVIEW_API_KEY=自托管实例的提问预演Workflow_Key
DIFY_PREVIEW_APP_ID=自托管实例的提问预演App_ID
```

设置权限：

```sh
sudo chown root:root /etc/smart-cabin-demo.env
sudo chmod 600 /etc/smart-cabin-demo.env
```

这些 Key 不能提交到 Git，也不要放进 Nginx 配置或前端文件。Dify 自托管 API 和 Demo 位于同一台机器时使用回环地址；如果后来拆成两台 ECS，应改为同一 VPC 内的私网地址，并仅允许 Demo 服务器访问 Dify API 端口。

## 启动 Node 服务

复制并启用本目录的 systemd 模板：

```sh
sudo cp deploy/alibaba-cloud/smart-cabin-demo.service.example /etc/systemd/system/smart-cabin-demo.service
sudo systemctl daemon-reload
sudo systemctl enable --now smart-cabin-demo
sudo systemctl status smart-cabin-demo --no-pager
curl -fsS http://127.0.0.1:4173/api/health
```

健康检查应显示 `runtime: production`、`workflow_proxy.configured: true`，且三个应用均已配置。该检查只验证 Key 是否存在，不代表 Dify 网络请求一定成功。

查看运行日志：

```sh
sudo journalctl -u smart-cabin-demo -n 100 --no-pager
```

## 配置 Nginx 和域名

复制 `nginx-smart-cabin-demo.conf.example` 到 Nginx 站点目录，把其中的 `YOUR_DOMAIN` 换成你的域名，再链接到 `sites-enabled`：

```sh
sudo cp /opt/smart-cabin-demo/deploy/alibaba-cloud/nginx-smart-cabin-demo.conf.example /etc/nginx/sites-available/smart-cabin-demo
sudo nano /etc/nginx/sites-available/smart-cabin-demo
sudo ln -s /etc/nginx/sites-available/smart-cabin-demo /etc/nginx/sites-enabled/smart-cabin-demo
sudo nginx -t
sudo systemctl reload nginx
```

在域名 DNS 添加 A 记录指向 ECS 公网 IPv4。完成 ICP 备案/接入备案后再正式将域名解析到大陆 ECS。HTTP 可访问后，用 Certbot 申请并自动配置 HTTPS 证书：

```sh
sudo certbot --nginx -d YOUR_DOMAIN
```

之后用 `https://YOUR_DOMAIN` 验收，不要把裸 IP 当正式分享链接。

## 更新发布

把新版本文件同步到 `/opt/smart-cabin-demo`，保留 `/etc/smart-cabin-demo.env`，然后重启服务：

```sh
sudo systemctl restart smart-cabin-demo
sudo systemctl status smart-cabin-demo --no-pager
curl -fsS https://YOUR_DOMAIN/api/health
```

发布后检查主页、`/api/health`、图片和音频资源、背景音乐、游戏问答、环境事件、暂停/继续和结算页。浏览器同源存储按域名隔离：改成新域名之后，旧 Vercel 域名里的 Dify `conversation_id` 和用户 ID 不会自动迁移。

## 本项目的生产运行边界

- systemd 设置 `RUNTIME_ENV=production`；健康接口会报告 production，前端不会向本机诊断接口上报，`/api/client-diagnostic` 在生产环境返回 404。
- 服务端工作流诊断仍通过 systemd journal 输出；本地 `tmp/workflow-diagnostics.ndjson` 文件只保存经过字段白名单过滤的诊断数据。
- 同机部署时，Dify API 通过回环网络访问，避免 Demo 服务器跨境请求 Dify Cloud。模型推理仍由 Dify 配置的模型供应商执行；若要减少跨境依赖，还需选择在中国大陆可稳定访问的模型服务，并验证时延。
- 从 Dify Cloud 迁移会更换 App ID、API Key 和会话后端；新域名也会形成新的浏览器来源，旧来源的 `conversation_id`/用户 ID 不会自动迁移。先完成应用导入及真实请求验收，再切换公开域名。
- 单实例部署不提供自动故障切换。后续需要更高可用时，再增加负载均衡、第二实例和集中日志。
