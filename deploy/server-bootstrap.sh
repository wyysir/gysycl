#!/usr/bin/env bash
# 目标服务器环境初始化（Debian / Ubuntu）
# 用法： bash deploy/server-bootstrap.sh
set -Eeuo pipefail

APP_ROOT="/opt/delivery-audit"

log() { printf '\033[36m[bootstrap]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请使用 root 执行（或 sudo bash $0）"

# ---------------------------------------------------------------- 1. 系统识别
. /etc/os-release
case "$ID" in
  debian|ubuntu|alinux|centos|rhel|rocky|almalinux) log "检测到系统：$PRETTY_NAME" ;;
  *) die "暂不支持的发行版：$ID（请手工安装 Docker/Nginx 后跳过本脚本）" ;;
esac

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- 2. 基础包
log "安装基础工具..."
case "$ID" in
  alinux|centos|rhel|rocky|almalinux)
    dnf -y install curl ca-certificates git rsync tar chrony jq policycoreutils-python-utils
    ;;
  *)
    apt-get update -qq
    apt-get upgrade -y -qq
    apt-get install -y -qq curl ca-certificates gnupg git rsync tar \
      ufw nginx certbot python3-certbot-nginx chrony jq
    ;;
esac

# ---------------------------------------------------------------- 3. Docker CE
if ! command -v docker >/dev/null 2>&1; then
  log "安装 Docker CE 与 Compose 插件..."
  case "$ID" in
    alinux|centos|rhel|rocky|almalinux)
      dnf -y install dnf-plugins-core
      dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    *)
      install -m0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list
      apt-get update -qq
      apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
      ;;
  esac
else
  log "Docker 已安装，跳过"
fi

systemctl enable --now docker chronyd 2>/dev/null || systemctl enable --now docker chrony

docker compose version || die "Docker Compose 插件不可用，请检查 Docker 安装"

# ---------------------------------------------------------------- 4. 目录规划
log "创建部署目录 $APP_ROOT ..."
mkdir -p "$APP_ROOT"/{app,deploy,backups,certs,logs}
chmod 700 "$APP_ROOT/backups"

# ---------------------------------------------------------------- 5. 防火墙
if command -v ufw >/dev/null 2>&1; then
  log "配置 ufw：仅放通 22/80/443"
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  echo "y" | ufw enable >/dev/null || true
  ufw status | sed -n '1,12p'
elif command -v firewall-cmd >/dev/null 2>&1; then
  log "配置 firewalld：仅放通 22/80/443"
  systemctl enable --now firewalld >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=ssh    >/dev/null
  firewall-cmd --permanent --add-service=http   >/dev/null
  firewall-cmd --permanent --add-service=https  >/dev/null
  firewall-cmd --reload >/dev/null
  firewall-cmd --list-all
fi

# ---------------------------------------------------------------- 6. Nginx 目录
[ -d /etc/nginx/sites-available ] || mkdir -p /etc/nginx/sites-available
[ -d /etc/nginx/sites-enabled ]   || mkdir -p /etc/nginx/sites-enabled
grep -q "sites-enabled" /etc/nginx/nginx.conf 2>/dev/null || \
  echo "请确认 nginx.conf 已 include /etc/nginx/sites-enabled/*;"

cat <<'TIP'

==========================================================================
环境准备完成。注意：

1) 若服务器在阿里云/腾讯云，**必须在控制台安全组放行 80/443 入方向**，
   不要放行 3000 / 5432 / 6379。
2) 下一步：上传代码到 /opt/delivery-audit/app，
   复制 deploy/env.production.example 为 /opt/delivery-audit/.env 并填写。
3) 然后执行： bash /opt/delivery-audit/deploy/deploy.sh
==========================================================================

TIP
