# 服务部署上线手册（初始部署参考）

> 此为初始部署模板，部分章节记录早期双通道、采购和初次建库安排，不能直接覆盖现网。当前采用Qwen3.6-Flash每图单次、PostgreSQL/Redis及本地持久图片，0001–0003迁移已应用；现网配置与回退先看[最新交接](会话交接-2026-10-31.md)。不再采购或配置传统OCR，不因本模板删除数据、重建数据库或重启暂缓备份项目。

> 本文基于仓库内 `README.md`、`package.json`、`Dockerfile`、`docker-compose.yml`、`deploy/nginx.conf`、`.env.example`、`docs/architecture.md`、`docs/acceptance.md` 以及 `src/lib/config.ts` 提炼，命令可直接复制执行。

---

## 0. 技术栈与运行形态识别结论

| 项目 | 结论 | 依据 |
| --- | --- | --- |
| 应用框架 | Next.js 16.4.2（App Router，含 Route Handlers + Server Actions） | `package.json`、`next.config.ts` |
| 运行时 | Node.js **>= 22.5**（推荐 24，Dockerfile 用 `node:24-bookworm-slim`） | `package.json engines`、Dockerfile |
| 语言/包管理 | TypeScript 5.9 + npm（`npm ci`，锁文件 `package-lock.json`） | `package.json` |
| 数据库 | PostgreSQL 17（生产）/ PGlite 嵌入式（仅本地无 `DATABASE_URL` 时） | `docker-compose.yml`、`src/lib/prisma.ts` |
| ORM | Prisma 7.10.1（`prisma-client` generator，driver adapter `@prisma/adapter-pg`），迁移目录 `prisma/migrations/0001_init` | `prisma/schema.prisma`、`prisma.config.ts` |
| 缓存/队列 | Redis 7 + BullMQ 6，队列名 `ocr`，Worker 并发 2 | `scripts/worker.ts`、`docker-compose.yml` |
| 进程形态 | **两个进程必须同时运行**：Web（`next start`）与 OCR Worker（`tsx scripts/worker.ts`） | `package.json scripts`、`docker-compose.yml` |
| 监听端口 | 容器内/进程内 **3000**（Next 默认，`EXPOSE 3000`） | Dockerfile、`deploy/nginx.conf`（反代 127.0.0.1:3000） |
| 健康检查 | `GET /api/health` → `{ok:true,database:"up"}`，失败返回 503 | `src/app/api/health/route.ts`、compose healthcheck |
| 对象存储 | 阿里云 OSS（`STORAGE_DRIVER=oss`，私有 Bucket + 签名直传）或 `local` 本地目录 | `src/server/storage.ts`、`.env.example` |
| 外部 AI/OCR | 阿里云表格 OCR（`ocr-api.cn-hangzhou.aliyuncs.com`）+ 百炼 Qwen-VL（`OCR_MODE=aliyun`） | `src/lib/config.ts`、README |
| 认证 | 微信服务号网页授权（可选）+ 员工号/密码登录，12 小时会话（jose JWT，依赖 `SESSION_SECRET`） | README、`src/server/auth.ts` |
| 上传限制 | 单张图片 **≤ 15MB**，`serverActions.bodySizeLimit=8mb`，Nginx 建议 80MB | `src/app/api/uploads/local/route.ts`、`next.config.ts`、`deploy/nginx.conf` |
| 系统服务依赖 | PostgreSQL、Redis、（可选）Nginx、certbot | 全仓从上到下一致 |

**关键生产约束（代码里硬校验，`src/lib/config.ts::assertProductionConfig`）**：
当 `NODE_ENV=production` 且 `DEMO_MODE=false` 时，**`SESSION_SECRET` 必须 ≥ 32 位且不能是模板占位值**，否则进程直接抛错启动失败。

---

## 1. 需要你确认的清单（缺失信息）

请按序号回复，未回复的部分我已在 §2 按默认假设给出可执行方案：

1. **目标服务器 IP / 是否已有可用 ECS**：SSH 地址、端口（默认 22）、登录方式（root / sudo 用户 / 密钥文件）。
2. **操作系统与版本**：默认按 **Debian 12 (bookworm)**（阿里云镜像亦可）撰写；如为 Ubuntu 22.04/24.04、Alibaba Cloud Linux 3、CentOS 7 需告知（包管理器与 NodeSource 源不同）。
3. **域名与 ICP 备案**：是否已备案域名（如 `delivery.xxx.com`）？能否做 A 记录解析到该服务器？**微信服务号 H5 强制要求已备案域名 + HTTPS**，无备案域名只能走 IP + 自签证书做内网验收，不能接入微信。
4. **HTTPS 证书来源**：Let's Encrypt（certbot，需服务器可出网且 80 端口可被验证）/ 阿里云免费证书（下载 Nginx 版 pem+key）/ 已有证书文件路径。
5. **部署形态**：Docker Compose（推荐，仓库已自带）/ 裸机 systemd 直跑 Node。
6. **数据库与 Redis 位置**：Compose 内置容器 / 阿里云 RDS + 云 Redis（生产推荐，且 **ECS 与 RDS 需同地域同 VPC**）。
7. **OSS Bucket**：是否已创建私有 Bucket、地域、AccessKey（需具备 `PutObject/GetObject` 最小权限）；如暂不用 OSS，则用 `local` 磁盘存储，但**容器重建时挂载卷必须保留**。
8. **正式识别开关**：是否已有阿里云 OCR + 百炼 DashScope 密钥并已充值/开通？否则只能先 `OCR_MODE=mock` 试运行（README 明确 Mock 结果不计入验收）。
9. **是否允许直接上生产**：是否需要先灰度/试运行（`DEMO_MODE=true`）？**生产必须 `DEMO_MODE=false`**，否则系统会在每次启动写入演示账号与演示单据。
10. **网络出口限制**：服务器能否访问 `api.github.com`/`registry.npmjs.org`（构建依赖）、阿里云 OCR/DashScope 公网 Endpoint？内网环境需改用内网 Endpoint 或镜像源。
11. **资源规格**：README 建议 ECS 2 vCPU / 4 GB；是否已有 GPU/CPU 更高配置（不影响部署，仅影响 OCR 吞吐）。
12. **数据备份要求**：RDS 自动备份保留 30 天、月度加密快照归档 OSS 是否已配置（验收清单第 6 条要求）。

---

## 2. 默认假设（未确认时按此执行）

| 项 | 假设值 |
| --- | --- |
| 操作系统 | Debian 12 bookworm，root 登录 |
| 部署目录 | `/opt/delivery-audit`，代码子目录 `app/` |
| 运行方式 | Docker Compose（内置 PostgreSQL 17 + Redis 7 + Web + Worker） |
| 对外端口 | 仅 80/443（Nginx），3000 仅绑定 `127.0.0.1` |
| 域名 | `delivery.example.com`（部署前替换为真实域名） |
| 证书 | certbot 自动签发 Let's Encrypt |
| 存储 | `STORAGE_DRIVER=oss`（未备 OSS 则回落 `local`，见 §4 步骤 5） |
| OCR | 先 `mock` 试运行，验收前切 `aliyun` |
| 镜像 | 本地构建（不推远端仓库） |

---

## 3. 方案 A（推荐）：Docker Compose 上线，编号步骤

> 下文 `$DOMAIN`、`$SERVER_IP`、密码等请按实际情况替换。所有脚本已随文档生成在 `deploy/` 目录。

### 步骤 1 · 服务器基础环境准备

登录服务器后执行（脚本：`deploy/server-bootstrap.sh`，默认 Debian/Ubuntu）：

```bash
# 本地终端：上传脚本（Windows PowerShell）
scp -r D:\codex\gysycl\deploy root@$SERVER_IP:/opt/delivery-audit/deploy

# 服务器端
chmod +x /opt/delivery-audit/deploy/*.sh
bash /opt/delivery-audit/deploy/server-bootstrap.sh
```

脚本完成的事情等价于手工执行：

```bash
apt update && apt -y upgrade
apt -y install curl ca-certificates gnupg git rsync tar ufw nginx certbot python3-certbot-nginx chrony jq

# Docker 官方源（Debian）
install -m0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker chrony
docker compose version   # 需 >= v2.20

# 目录规划
mkdir -p /opt/delivery-audit/{app,deploy,backups,certs,logs}

# 防火墙：只放通 22/80/443，3000 不对外
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable && ufw status
```

> **阿里云用户注意**：除系统防火墙外，还必须在 **ECS 安全组** 放行 80/443（入方向），**不要放行 3000/5432/6379**。Alibaba Cloud Linux 3 请改用 `dnf install` 并从阿里云镜像安装 Docker CE。

### 步骤 2 · 代码上传 / 拉取

当前工作区已纳入本地 Git；版本节点见 [CHANGELOG](../CHANGELOG.md)。截至 2026-10-29 未配置远程仓库，实际试用部署仍使用经过核对的源码包；将来建立授权远程仓库后才适用方式二。下面是首次部署示例；更新现有试用站点时，以[实际维护说明](deployment-2026-10-29/上线与维护说明.md)的备份和更新步骤为准。

```bash
# 方式一：本地打包上传（推荐，本机为 Windows PowerShell）
# 注意排除本地产物：node_modules / .next / .data / .npm-cache / docs 截图
tar --exclude=node_modules --exclude=.next --exclude=.data --exclude=.npm-cache \
    --exclude=.git --exclude=*.tsbuildinfo -czf app.tar.gz \
    -C /d/codex/gysycl .
scp app.tar.gz root@$SERVER_IP:/opt/delivery-audit/

# 服务器端解包
cd /opt/delivery-audit && rm -rf app && mkdir -p app && tar -xzf app.tar.gz -C app
```

```bash
# 方式二：远端 git 仓库（若已建立）
git clone <你的仓库地址> /opt/delivery-audit/app
# 后续更新： cd /opt/delivery-audit/app && git pull --ff-only
```

### 步骤 3 · 编写生产环境变量

```bash
cp /opt/delivery-audit/app/.env.example /opt/delivery-audit/.env
# 或使用随文档提供的模板：deploy/env.production.example
vi /opt/delivery-audit/.env
```

必填项说明（完整清单见 `deploy/env.production.example`）：

| 变量 | 生产值 | 说明 |
| --- | --- | --- |
| `APP_URL` | `https://delivery.example.com` | 微信回调与绝对链接基址，**必须与最终访问域名完全一致（含 https）** |
| `SESSION_SECRET` | `openssl rand -base64 48` 生成 | **≥ 32 位**，生产安全校验强制项 |
| `POSTGRES_PASSWORD` | 强随机 | Compose 内置库密码，改后需同步 `DATABASE_URL` |
| `DATABASE_URL` | `postgresql://delivery:<pwd>@postgres:5432/delivery_audit` | 用 RDS 时替换为 RDS 内网地址，**ECS 与 RDS 同 VPC** |
| `REDIS_URL` | `redis://redis:6379` | 云 Redis 时替换为内网地址 |
| `DEMO_MODE` | `false` | **生产必须 false**；true 会写入演示账号/单据 |
| `OCR_MODE` | `aliyun`（验收前）/ `mock`（试运行） | mock 结果为假数据，不计入验收 |
| `ALIYUN_ACCESS_KEY_ID` / `SECRET` | RAM 子账号最小权限 | 仅 OCR 权限 |
| `ALIYUN_OCR_ENDPOINT` | `ocr-api.cn-hangzhou.aliyuncs.com` | 内网可选 `ocr-api-vpc.cn-hangzhou.aliyuncs.com` |
| `DASHSCOPE_API_KEY` | 百炼 API Key | Qwen-VL 通道 |
| `QWEN_VL_MODEL` | `qwen-vl-max-latest` | 保持默认 |
| `STORAGE_DRIVER` | `oss` | 无 OSS 时填 `local`（图片存命名卷 `uploads`） |
| `OSS_*` | Bucket / Region / Endpoint / AK | Bucket 必须私有；CORS 允许来源填 `https://<域名>`，方法 PUT/GET，允许头 `Content-Type` |
| `WECHAT_APP_ID` / `SECRET` | 服务号凭据 | 未配置时仍可员工号密码登录 |
| 微信模板通知 | 用户于2026-10-30取消 | 新代码不再读取模板ID，不发送消息；Notification历史记录保留，无迁移 |
| `CROSS_PRICE_TOLERANCE` 等 | 默认 0.10 / 0.10 / 2 / 3 | 业务阈值，与验收清单一一对应 |

生成密钥：

```bash
openssl rand -base64 48     # SESSION_SECRET
openssl rand -base64 24     # POSTGRES_PASSWORD
```

### 步骤 4 · 构建并首次启动

```bash
cd /opt/delivery-audit/app
cp ../deploy/docker-compose.override.yml ./docker-compose.override.yml  # 端口绑定 127.0.0.1 + 自动重启 + 日志轮转

docker compose --env-file /opt/delivery-audit/.env \
  -p delivery -f docker-compose.yml -f docker-compose.override.yml up -d --build
```

- `app` 容器启动命令为 `npx prisma migrate deploy && npm start`，**迁移在启动时自动执行**（`migrations/0001_init`）。
- 健康检查命中 `/api/health` 之前 `worker` 不会启动（compose 依赖 `service_healthy`）。
- 首次构建约需几分钟（sharp / prisma 引擎较大）。

### 步骤 5 · 验证服务

```bash
docker compose -p delivery ps                      # app/worker 应为 healthy/running
docker compose -p delivery logs -f app             # 实时日志
curl -i http://127.0.0.1:3000/api/health           # 期望 200 {"ok":true,"database":"up"}
```

### 步骤 6 · 创建管理员账号并初始化主数据

```bash
docker compose -p delivery exec app env \
  ADMIN_EMPLOYEE_NO=admin ADMIN_PASSWORD='<至少8位强密码>' ADMIN_NAME='系统管理员' \
  npm run create-admin
```

> `DEMO_MODE=false` 时系统不会自动写入演示账号，**必须执行本步**。随后用该账号登录 → 「合同主数据」新增项目点 → 创建项目采购/主管/财务账号 → 导入供应商、原材料、项目合同价。

### 步骤 7 · Nginx 反向代理

```bash
# Debian 12 自带 nginx 1.22：配置已使用旧的 `listen 443 ssl http2`
# 若你的 nginx >= 1.25.1，可改为 `listen 443 ssl;` + `http2 on;`
# CentOS/RHEL：改为 /etc/nginx/conf.d/delivery.conf，并删除 sites-enabled 符号链接
mkdir -p /var/www/html /etc/nginx/sites-enabled
cp /opt/delivery-audit/deploy/nginx-production.conf /etc/nginx/sites-available/delivery
sed -i "s#__DOMAIN__#delivery.example.com#g" /etc/nginx/sites-available/delivery
ln -sf /etc/nginx/sites-available/delivery /etc/nginx/sites-enabled/delivery
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable --now nginx && systemctl reload nginx
```

配置要点（已内置）：HTTP→HTTPS 301、`client_max_body_size 80m`（覆盖单图 15MB × 5 页）、`proxy_read_timeout 180s`（OCR 回调等待）、`X-Forwarded-Proto https`（Next 据此判定 https 会话 Cookie）、静态资源缓存、`/api/health` 不记访问日志。

### 步骤 8 · 域名解析与 HTTPS

```bash
# DNS：A 记录 delivery.example.com -> 服务器公网 IP（阿里云/万网解析，国内域名需已备案）
# 确认解析生效
dig +short delivery.example.com

# 签发证书（需 80 端口对公网开放）
certbot --nginx -d delivery.example.com --agree-tos -m you@example.com --redirect

# 自动续期检查
systemctl status certbot.timer
certbot renew --dry-run
```

无域名时的临时方案（**仅限内网验收，不能接微信**）：

```bash
mkdir -p /etc/nginx/certs && openssl req -x509 -nodes -newkey rsa:2048 -days 90 \
  -keyout /etc/nginx/certs/privkey.pem -out /etc/nginx/certs/fullchain.pem \
  -subj "/CN=$SERVER_IP"
# 并在 nginx 配置中把 server_name 改为 _ ，跳过 server-block 的 301 跳转
```

### 步骤 9 · 微信服务号配置（可选但上线需做）

1. 公众号后台「设置 → 公众号设置 → 功能设置」配置**网页授权域名**为你的备案域名。
2. 环境变量写入 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`。
3. 自定义菜单链接指向 `https://<域名>/api/auth/wechat/start`。
4. 不申请本系统模板或类目、不填写模板ID。仅接入菜单与微信登录，保留客如云原有菜单、模板和第三方授权。取消通知源码需部署后才在线上生效，详见[当前公众号待办](公众号接入详细流程与待办-2026-10-29.md)。
5. 重启容器生效：`docker compose -p delivery up -d app worker`。

---

## 4. 方案 B（备选）：裸机 systemd 直跑 Node

适用于不允许装 Docker 的环境。需自行准备外部 PostgreSQL 与 Redis。

```bash
# 1) 运行时
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -   # Node 22 LTS（>=22.5 即可）
apt-get install -y nodejs build-essential python3
node -v && npm -v

# 2) 代码与依赖
useradd -r -m -s /bin/bash deliv 2>/dev/null || true
mkdir -p /opt/delivery-audit/{app,.data/uploads,logs}
chown -R deliv:deliv /opt/delivery-audit
su - deliv -c "cd /opt/delivery-audit/app && npm ci"

# 3) Prisma 客户端 + 生产构建 + 迁移
su - deliv -c "cd /opt/delivery-audit/app && npx prisma generate && npm run build && npx prisma migrate deploy"

# 4) systemd 守护（EnvironmentFile 方式加载环境变量，避免明文进 unit）
cp deploy/systemd/delivery-web.service   /etc/systemd/system/
cp deploy/systemd/delivery-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now delivery-web delivery-worker
systemctl status delivery-web delivery-worker
journalctl -u delivery-web -f
```

unit 文件关键项已配置：`Restart=always`、`RestartSec=5`、`EnvironmentFile=/opt/delivery-audit/.env`、`WorkingDirectory=/opt/delivery-audit/app`、`Environment=NODE_ENV=production PORT=3000`、日志写入 systemd journal 并限制体积。

> 裸机方案下 Web 建议仍只监听 `127.0.0.1`（Next 16 默认 `0.0.0.0`，可在 Nginx 侧用防火墙限制，或用 `HOSTNAME=127.0.0.1 npm start` 绑定本机）。

---

## 5. 日志查看与故障排查

### 5.1 常用命令

```bash
# 容器态
docker compose -p delivery logs -f --tail=200 app
docker compose -p delivery logs -f --tail=200 worker
docker compose -p delivery logs      postgres redis
docker stats

# Nginx
tail -f /var/log/nginx/delivery.access.log /var/log/nginx/delivery.error.log

# 裸机态
journalctl -u delivery-web -f --since "10 min ago"
journalctl -u delivery-worker -f
```

### 5.2 故障对照表

| 现象 | 可能原因 | 处置 |
| --- | --- | --- |
| `app` 容器反复重启，日志报「生产环境配置错误：… SESSION_SECRET」 | `DEMO_MODE=false` 但 `SESSION_SECRET` < 32 位或用了占位值 | 重新生成 ≥32 位密钥，`docker compose up -d app` |
| `/api/health` 返回 `{"ok":false,"database":"down"}` 503 | `DATABASE_URL` 写错 / RDS 白名单未放行 ECS / 迁移未执行 | `docker compose exec app npx prisma migrate deploy`；检查 RDS 白名单与安全组 |
| 容器日志 `prisma migrate deploy` 报 P3009（migrate found failed migrations） | 上次迁移中断 | `docker compose exec postgres psql -U delivery -d delivery_audit -c "select * from _prisma_migrations;"` 定位后 `npx prisma migrate resolve --rolled-back <name>` |
| 上传超过 15MB 报 413 | Nginx 或图片本身超限 | 确认 Nginx `client_max_body_size 80m`；系统限制单图 15MB（代码硬限制） |
| 上传图片后一直「识别中」 | Worker 未运行 / Redis 不通 | `docker compose ps worker`；`logs -f worker`；确认 `REDIS_URL` |
| 识别失败率高的 4xx/5xx | 阿里云 OCR 或 DashScope 密钥/额度问题 | 先看 worker 日志，再核对 `ALIYUN_*`、`DASHSCOPE_API_KEY` 与 Endpoint 地域一致性 |
| 微信授权回调报 redirect_uri 错误 | `APP_URL` 与公众号网页授权域名不一致 | 统一域名（含 https、无末尾斜杠）后重启 app |
| 登录成功后立刻掉登录 | Cookie 未带 Secure / X-Forwarded-Proto 缺失 | 确认 Nginx 传了 `X-Forwarded-Proto https` |
| 图片 403 | OSS Bucket 非私有或 CORS 未配 | README 要求：Bucket 私有 + 来源限制为域名 + PUT/GET |
| 页面 502 Bad Gateway | app 未监听 3000 / 容器未健康 | `ss -lntp | grep 3000`、`docker compose exec app curl -i localhost:3000/api/health` |
| 磁盘将满 | 本地 `uploads` 卷或 Docker 日志堆积 | `docker system df`；清理 `/var/lib/docker/containers/*/*-json.log`；改用 OSS |
| OCR 队列积压 | Worker 并发不足（默认 2）或失败重试风暴 | 调 `scripts/worker.ts` concurrency 或扩容 worker 容器副本 |

### 5.3 上线自检脚本

```bash
DOMAIN=delivery.example.com
curl -sS https://$DOMAIN/api/health | jq .
curl -sS -o /dev/null -w '%{http_code}\n' https://$DOMAIN/login
docker compose -p delivery ps
```

---

## 6. 更新与回滚

### 6.1 标准更新流程（脚本 `deploy/deploy.sh`）

```bash
cd /opt/delivery-audit
# 1) 先把新代码放到 /opt/delivery-audit/app（同 步骤 2）
bash deploy/deploy.sh
```

脚本按序执行：**记录当前镜像 id 用于回滚 → `pg_dump` 备份数据库到 `backups/` → `docker compose build` → `up -d`（容器内自动跑 `prisma migrate deploy`）→ 轮询 `/api/health` 直到 200 → 失败自动调用rollback**。

手工等价命令：

```bash
cd /opt/delivery-audit/app
docker compose -p delivery exec postgres \
  pg_dump -U delivery -d delivery_audit | gzip > /opt/delivery-audit/backups/db-$(date +%F-%H%M).sql.gz

docker compose --env-file /opt/delivery-audit/.env -p delivery \
  -f docker-compose.yml -f docker-compose.override.yml up -d --build

curl -fsS http://127.0.0.1:3000/api/health
docker image prune -f
```

> **迁移风险提示**：上线前请对新增 SQL 做向前兼容检查。若迁移不可逆，务必先执行上面的 `pg_dump`；回滚后若 schema 已变更，需要用备份恢复（见 6.3）。

### 6.2 应用回滚（代码/镜像层面，推荐）

```bash
cd /opt/delivery-audit
bash deploy/rollback.sh
```

原理：`deploy.sh` 每次部署前把当前运行的 app/worker 镜像 id 写入 `.rollback-app` / `.rollback-worker`；`rollback.sh` 通过 `deploy/docker-compose.rollback.yml` 中的 `image: ${APP_IMAGE}` 覆盖 `build:`，以 `--no-build` 方式重启旧镜像。

指定历史版本：

```bash
APP_IMAGE=delivery-app:20261023-1030 WORKER_IMAGE=delivery-worker:20261023-1030 \
  bash deploy/rollback.sh
docker images | grep delivery   # 查看可用版本标签
```

回滚后验证：

```bash
docker compose -p delivery ps
curl -sS http://127.0.0.1:3000/api/health
docker compose -p delivery logs --tail=100 app
```

### 6.3 数据库回滚（仅在迁移破坏兼容性时）

```bash
# 停服，避免写入漂移
docker compose -p delivery stop app worker

# 恢复指定备份
docker compose -p delivery start postgres
zcat /opt/delivery-audit/backups/db-2026-10-23-1000.sql.gz \
  | docker compose -p delivery exec -T postgres \
      psql -U delivery -d delivery_audit -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" -

docker compose -p delivery start app worker
```

> 该操作会清空并重建 schema，**必须先二确认**；如已接入 OSS，原图不受影响。

裸机方案回滚：重新解包旧版本 tar 到 `app_new/` → `npm ci` → `prisma generate` → `npm run build` → 切换软链或直接覆盖 → `systemctl restart delivery-web delivery-worker`。

---

## 7. 运维与安全基线

1. **备份**：RDS 每日自动备份保留 30 天；自部署 PostgreSQL 建议每日 `pg_dump` 定时任务：
   ```bash
   0 3 * * * docker compose -p delivery -f /opt/delivery-audit/app/docker-compose.yml exec -T postgres \
     pg_dump -U delivery -d delivery_audit | gzip > /opt/delivery-audit/backups/db-$(date +\%F).sql.gz
   ```
   并每月把加密快照传至 OSS 归档（保存 5 年）。
2. **最小权限**：OSS/RDS/RAM 均使用子账号，仅授予必需权限；数据库与 OSS AK 不要写入镜像。
3. **密钥管理**：`.env` 权限 `chmod 600`，且**不要提交进代码仓库**（`.gitignore` 已排除）。
4. **监控告警**：对 `/api/health`、OCR 队列积压、OCR 失败率、5xx 与数据库连接数配置告警（阿里云 SLS/ARMS 或 Prometheus + Alertmanager）。
5. **日志轮转**：Docker 已在 override 中配置 `json-file max-size=20m max-file=5`；Nginx 走系统 logrotate。
6. **端口收敛**：仅 80/443 对外，3000/5432/6379 一律不得出现在安全组放行列表。
7. **验收前置**：正式识别必须在 ≥30 张真实脱敏手写单盲测集上达到各字段 95% 准确率（见 `docs/acceptance.md`），Mock 不计入。

---

## 8. 附：一次成型的命令时序（假设信息全部按 §2）

```bash
# ① 环境
bash /opt/delivery-audit/deploy/server-bootstrap.sh
# ② 代码
cd /opt/delivery-audit && rm -rf app && mkdir app && tar -xzf app.tar.gz -C app
# ③ 环境变量
cp deploy/env.production.example /opt/delivery-audit/.env && vi /opt/delivery-audit/.env
cp app/deploy/docker-compose.override.yml app/docker-compose.override.yml 2>/dev/null || cp deploy/docker-compose.override.yml app/
# ④ 构建启动（含自动迁移）
cd /opt/delivery-audit/app && docker compose --env-file ../.env -p delivery \
   -f docker-compose.yml -f docker-compose.override.yml up -d --build
# ⑤ 健康检查
curl -fsS http://127.0.0.1:3000/api/health
# ⑥ 管理员
docker compose -p delivery exec app env ADMIN_EMPLOYEE_NO=admin ADMIN_PASSWORD='******' \
   ADMIN_NAME='系统管理员' npm run create-admin
# ⑦ Nginx + HTTPS
sed "s#__DOMAIN__#你的域名#g" deploy/nginx-production.conf > /etc/nginx/sites-available/delivery
ln -sf /etc/nginx/sites-available/delivery /etc/nginx/sites-enabled/delivery && nginx -t && systemctl reload nginx
certbot --nginx -d 你的域名 --agree-tos -m 你的邮箱 --redirect
# ⑧ 外部验证
curl -fsS https://你的域名/api/health
```

---

## 9. 本次随文档生成的配套文件

| 文件 | 用途 |
| --- | --- |
| `docs/deployment.md` | 本文件，完整部署方案 |
| `deploy/server-bootstrap.sh` | 服务器环境初始化（Docker/Nginx/certbot/防火墙/目录） |
| `deploy/env.production.example` | 生产环境变量模板（含注释） |
| `deploy/docker-compose.override.yml` | 端口收敛到 127.0.0.1、自动重启、日志轮转、资源限制 |
| `deploy/docker-compose.rollback.yml` | 回滚专用覆写（按镜像 tag 启动） |
| `deploy/deploy.sh` | 一键更新部署（备份 → 构建 → 迁移 → 健康检查） |
| `deploy/rollback.sh` | 一键回滚到上一版镜像 |
| `deploy/nginx-production.conf` | 生产 Nginx 配置（HTTPS/80MB/长超时/安全响应头） |
| `deploy/systemd/delivery-web.service` | 裸机方案 Web 进程守护 |
| `deploy/systemd/delivery-worker.service` | 裸机方案 OCR Worker 守护 |

## 10. 现有演示服务器接入OSS（2026-11-02）

本节用于当前服务器的存储接入，不执行前文的初始化、建库或全量配置替换。**2026-11-03已完成OSS接通、12个旧图片文件原键迁移及app/worker切换**，详见[当前维护与验收](OSS接入与维护-2026-11-03.md)和[发布记录](releases/2026-11-03-oss-storage.json)。下面10.1至10.7保留配置/迁移流程，勿在现有环境重复执行初始化。用户已购买一年500G OSS，订单规格与实际抵扣仍未核验。网络地域封禁和DNS出站限制依用户要求以后实施，见[待办](上线前待办清单-2026-10-28.md)。

当前确认：ECS地域为华东1（杭州）`cn-hangzhou`，网站来源为`https://42.121.106.105`，配置文件为`/opt/delivery-audit/.env`；运行中的app/worker均使用OSS桶`saldhcy-docs-20261102`，本地旧图卷作为副本保留。数据库仍在原服务器，旧本地卷备份任务不能覆盖未来OSS新增图片。镜像和迁移以最新交接为准，不使用本手册开头的旧版本快照。

### 10.1 核对已购资源包

进入阿里云费用中心的资源包/资源实例管理，查看已购OSS订单详情，记录以下信息：

| 项目 | 对应配置 |
| --- | --- |
| 产品 | 确认为OSS存储包，不是CDN流量包或仅下行流量包 |
| 有效期与规格 | 一年、500G，以订单显示为准 |
| 地域 | 覆盖杭州或中国内地通用；若仅其他地域，不直接在杭州建桶并假设可抵扣 |
| 存储类型 | 与实际对象类型一致；通常先选标准存储，须以订单为准 |
| 冗余类型 | 标准本地冗余LRS包匹配LRS桶；同城冗余ZRS包匹配ZRS桶 |

容量包是账单抵扣额度，不会给ECS增加500G磁盘，也不会在用满后自动停止上传。请求、外网流出、跨地域复制及历史版本等费用须另核对；不要为省钱直接把对象转为资源包未覆盖的类型。订单到期不等于授权删除数据。

### 10.2 创建私有Bucket

阿里云控制台 → 对象存储OSS → Bucket列表 → 创建Bucket：

- 名称：取一个全局唯一名称，例如`gysycl-docs-20261102-自定后缀`，示例名称不能保证可用。
- 地域：资源包覆盖杭州时选择华东1（杭州）。资源包范围不符时先处理地域匹配，再继续。
- 存储类型、冗余类型：按10.1核验结果填写。不要直接接受与资源包不符的默认值。
- 读写权限：私有；开启“阻止公共访问”。
- 服务端加密：可选OSS完全托管SSE-OSS，不必为本轮接入另开KMS密钥服务。
- 不设置到期删除或自动转归档规则，不开传输加速/CDN；一年是容量预算周期。
- 建议开启版本控制用于误删恢复；历史版本也占容量，尚未设定自动清理。版本控制不等于独立异地备份。

Bucket不必提前建立年度目录，应用上传时会生成`documents/YYYY/MM/UUID.jpg`等对象键。当前代码尚未按项目点创建目录；项目访问权限由应用数据库控制。

### 10.3 配置浏览器跨域CORS

2026-11-02重新核对阿里云当前官方文档，入口为：**OSS控制台 → Bucket列表 → 点击具体Bucket名称 → 数据安全 → 跨域设置 → 创建规则**。此前写为“权限控制 → 跨域设置”的菜单路径错误，已修正。此为官方文档核验，不表示已登录用户控制台确认其菜单显示。

若菜单难以定位，官方另提供以下地址格式。杭州桶将`YOUR_BUCKET_NAME`换成真实名称，在已登录阿里云的浏览器打开：

```text
https://oss.console.aliyun.com/bucket/oss-cn-hangzhou/YOUR_BUCKET_NAME/data-security/cors
```

先确认已进入具体Bucket详情，不是在OSS概览、资源包订单或Bucket列表页面。如果账号无权查看/设置，使用账号管理员配置，或给配置人员授予仅此桶的`oss:GetBucketCors`和`oss:PutBucketCors`权限，资源范围为`acs:oss:*:*:YOUR_BUCKET_NAME`（桶级，不带`/documents/*`）。10.4中的应用RAM账号只有日常图片读写权限，不具备管理CORS权限；不因菜单问题给应用账号增加全量管理权限。

| 字段 | 本项目当前值 |
| --- | --- |
| 来源Origins | `https://42.121.106.105`，不带末尾斜杠或页面路径 |
| 允许方法 | `PUT`；如后续浏览器直接读图再增加`GET`、`HEAD` |
| 允许Headers | `Content-Type` |
| 暴露Headers | `ETag`、`x-oss-request-id`，便于排查 |
| 缓存时间 | 600秒 |
| 返回Vary: Origin | 如控制台提供则勾选 |

以后实际启用`https://www.dhcy.top`等域名，再把真实来源单独加入。不要把域名规划状态当成已经启用，也不使用任意来源`*`替代配置。跨域是浏览器校验，不代替Bucket私有权限或RAM授权。

浏览器向签名URL发送PUT，预检OPTIONS由OSS处理；无需为浏览器上传授予匿名写权限。图片查看当前仍通过应用`/api/files`鉴权后读取OSS，不需要开放公共读。

不依赖菜单的备用方式是当前ossutil 2.x API命令，由已有管理凭据的配置人员执行。先读取并保存原配置；仅确认`NoSuchCORSConfiguration`才按无规则处理，权限或网络错误不能当作空配置。新建专用桶时可将以下内容保存为`cors-configuration.xml`；如已有其他规则，必须合并保留：

```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://42.121.106.105</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>Content-Type</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-oss-request-id</ExposeHeader>
    <MaxAgeSeconds>600</MaxAgeSeconds>
  </CORSRule>
  <ResponseVary>true</ResponseVary>
</CORSConfiguration>
```

以下命令依次读取、设置、复核；第一条成功读取后先审阅再执行设置，不把三条直接作为忽略错误的批处理运行：

```bash
ossutil api get-bucket-cors --bucket YOUR_BUCKET_NAME --region cn-hangzhou
ossutil api put-bucket-cors --bucket YOUR_BUCKET_NAME --region cn-hangzhou \
  --cors-configuration file://cors-configuration.xml
ossutil api get-bucket-cors --bucket YOUR_BUCKET_NAME --region cn-hangzhou
```

PutBucketCors会覆盖整个CORS配置，不能直接覆盖其他应用已有规则；凭据通过安全配置/凭据链提供，不在命令中明文传AccessKey。本轮未运行这些云端命令。最终需以浏览器真实来源的PUT预检和合成图片上传验证，不能仅凭菜单保存或服务健康状态认定接通。

### 10.4 创建专用RAM用户及最小权限

阿里云访问控制RAM → 身份管理 → 用户 → 创建用户，例如`gysycl-oss-app`。不使用主账号AccessKey，也不授予整个账号的`AliyunOSSFullAccess`。按控制台当前流程为专用用户创建服务器程序使用的AccessKey。

2026-11-02重新查阅当前RAM官方文档，具体操作如下。这一步进入[访问控制RAM控制台](https://ram.console.aliyun.com/)，不是OSS Bucket详情中的权限配置：

1. 用阿里云账号管理员或有RAM策略管理权限的账号登录。
2. 左侧选择**权限管理 → 权限策略**，单击**创建权限策略**。按钮名称为“创建权限策略”，不必寻找名为“创建自定义权限策略”的按钮。
3. 在创建页选择**脚本编辑**，把下面完整JSON粘贴到编辑器，将`YOUR_BUCKET_NAME`替换为真实Bucket名称。
4. 按页面完成策略校验/优化并核对资源范围，单击**确定**；在创建对话框填写名称，例如`GysyclOssDocumentsAccess`，备注“本项目单据图片读写”，再次确定。
5. 创建后还需授权：左侧**身份管理 → 用户**，找到`gysycl-oss-app`，单击**新增授权**，选择刚创建的自定义策略并确认新增授权。

参考：[创建自定义权限策略](https://help.aliyun.com/zh/ram/create-a-custom-policy)、[管理RAM用户的权限](https://help.aliyun.com/zh/ram/user-guide/grant-permissions-to-the-ram-user)。上述是当次查询的官方流程，尚未实际登录用户控制台创建或授权。

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:PutObject",
        "oss:GetObject",
        "oss:DeleteObject"
      ],
      "Resource": [
        "acs:oss:*:*:YOUR_BUCKET_NAME/documents/*"
      ]
    }
  ]
}
```

这些权限对应上传、读取/HeadObject校验和现有草稿图片删除。当前应用不需要列举整个Bucket、管理桶配置或永久删除历史版本。若迁移工具需要ListObjects权限，应另用临时迁移授权，不扩大日常应用用户权限。`demo/`示例图片由应用静态资源读取。

AccessKey ID和Secret只写服务器私有环境文件，不发聊天、不纳入Git或截图。当前SDK通过`OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET`读取配置；ECS角色/STS免长期密钥方案需另行改造，不能只配置角色就声称现有代码会自动使用。

### 10.5 准备服务器配置，暂不先切换

服务器只编辑`/opt/delivery-audit/.env`中的存储项，不用示例文件覆盖现有数据库、会话密钥、识别及账号配置：

```dotenv
STORAGE_DRIVER=oss
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=YOUR_BUCKET_NAME
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
OSS_ACCESS_KEY_ID=服务器私下填写
OSS_ACCESS_KEY_SECRET=服务器私下填写
```

以上是迁移完成后启用的目标值。使用公网Endpoint：当前`src/server/storage.ts`共用同一个OSS客户端生成手机直传URL和服务端读取地址，填`-internal.aliyuncs.com`会使普通手机无法直传。若将来优化服务器内网读取，须先拆分客户端与配置。

配置文件权限保持600；切换前私有备份旧环境文件，备份同样不能进Git。不得在终端输出整份环境文件。app和worker必须使用同一套存储配置，不能只重启其中一个。

### 10.6 旧图片迁移和切换顺序

**当前为全局存储驱动，不会自动回退读取旧本地图片。禁止先改为OSS并重启，再慢慢搬图。**

1. 约定短维护窗口，暂停业务写入，等待识别队列清空；记录数据库页表与文件清单，执行现有数据库/本地图片备份并验证摘要。
2. 从当前本地卷迁移全部被引用的上传图和`-processed.jpg`处理图。源目录为`/var/lib/docker/volumes/delivery_uploads/_data/`，上传时以此为根保留相对路径；不要多套一层`_data/`或`uploads/`。
3. 按原对象键上传，保持数据库`objectKey`和`processedObjectKey`引用不变。对象访问权限保持私有，设置对应的图片Content-Type，不覆盖未知同名对象。
4. 对数据库引用逐个核对：目标存在、大小一致、下载后SHA-256与源文件一致。先用合成图片验证专用RAM账号的PUT、HEAD、GET及DELETE权限。迁移清单/原图留私有目录，不提交。
5. 全部通过后启用10.5配置，并仅重建现有app和worker容器；不重建数据库，不拉取未知镜像，不删除本地卷。当前Compose使用方式见下面命令。
6. 检查旧单据高清图、处理图、新图片直传、页面刷新、草稿删除及受限账号读图权限。健康检查通过不能替代OSS读写验收。模型识别涉及收费，另按授权范围验证，不因本流程自动重跑历史图片。
7. 通过后恢复写入，观察账单抵扣和错误日志。保留本地旧图及备份，未经确认不清理。

以下命令仅在迁移校验完成、目标配置保存后执行，不是当前已执行记录：

```bash
docker compose --env-file /opt/delivery-audit/.env -p delivery \
  -f /opt/delivery-audit/app/deploy/compose.trial.yml \
  up -d --no-deps --no-build --pull never --force-recreate app worker
curl -fsS http://127.0.0.1:3000/api/health
```

回退：停止写入并确认新产生对象的位置；如果已在OSS产生新图片，先将这些图按原键同步回本地并核验，再恢复旧存储配置和重建app/worker。不能直接改回local导致切换后新单据丢图。此接入不需要数据库结构迁移，不回退业务数据和营业额审核代码。

### 10.7 备份与验收边界

- 原`deploy/backup-trial.sh`对`/app/.data/uploads`打包，OSS切换后只覆盖旧本地图，不覆盖新增OSS图片；数据库导出仍能保存引用，不能代替图片备份。
- 独立异地备份和恢复演练仍依用户决定暂缓。本轮接入不能记为异地备份已完成，也不创建周期任务或自动删除对象。
- 在OSS概览和费用中心检查容量、请求/流量及实际抵扣；资源包匹配以账单为准。500G不是单Bucket硬上限。
- 参考年度量：30项目×10图×365天=109500图；平均1MB主图加80KB缩略图约118.3GB，另计余量、历史版本及备份。缩略图、项目目录和中间图保留周期只是规划，尚未实施。
- 配置和迁移完成后再登记实际验证、文件摘要、源包/镜像、备份位置、迁移与回退结果；本节文档更新不新增发布标签。

### 官方参考

- [资源包与地域、存储/冗余类型匹配及额外费用](https://help.aliyun.com/zh/oss/why-am-i-still-in-arrears-after-i-purchase-a-resource-plan)
- [创建Bucket](https://help.aliyun.com/zh/oss/user-guide/create-a-bucket-4)
- [CORS配置](https://help.aliyun.com/zh/oss/user-guide/configure-cross-origin-resource-sharing)
- [官方直达路由参考（仅参考CORS入口，不照搬其他产品的来源与权限）](https://help.aliyun.com/zh/model-studio/oss-setup-guide)
- [ossutil 2.x设置CORS](https://help.aliyun.com/zh/oss/developer-reference/put-bucket-cors) · [读取CORS](https://help.aliyun.com/zh/oss/developer-reference/get-bucket-cors)
- [PutBucketCors权限及覆盖语义](https://help.aliyun.com/zh/oss/developer-reference/putbucketcors)
- [RAM Policy](https://help.aliyun.com/zh/oss/user-guide/ram-policy/)
- [RAM自定义策略创建流程](https://help.aliyun.com/zh/ram/create-a-custom-policy) · [RAM用户授权流程](https://help.aliyun.com/zh/ram/user-guide/grant-permissions-to-the-ram-user)
- [HeadObject对应GetObject权限](https://help.aliyun.com/zh/oss/developer-reference/headobject/)
