#!/usr/bin/env bash
# 一键部署 / 更新
# 前置：代码已放置在 /opt/delivery-audit/app，环境变量已写入 /opt/delivery-audit/.env
# 用法： bash deploy/deploy.sh [--app-dir DIR] [--env-file FILE] [--skip-backup] [--timeout SEC]
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/delivery-audit}"
APP_DIR="${APP_DIR:-$APP_ROOT/app}"
ENV_FILE="${ENV_FILE:-$APP_ROOT/.env}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-delivery}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
SKIP_BACKUP="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)     APP_DIR="$2"; shift 2 ;;
    --env-file)    ENV_FILE="$2"; shift 2 ;;
    --project)     COMPOSE_PROJECT="$2"; shift 2 ;;
    --timeout)     HEALTH_TIMEOUT="$2"; shift 2 ;;
    --skip-backup) SKIP_BACKUP="true"; shift ;;
    -h|--help)     sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "未知参数：$1"; exit 1 ;;
  esac
done

log() { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[错误]\033[0m %s\n' "$*" >&2; }

command -v docker >/dev/null || { fail "未找到 docker"; exit 1; }
[ -f "$ENV_FILE" ] || { fail "环境变量文件不存在：$ENV_FILE"; exit 1; }
[ -d "$APP_DIR" ]  || { fail "代码目录不存在：$APP_DIR"; exit 1; }

cd "$APP_DIR"
OVERRIDE="$APP_DIR/docker-compose.override.yml"
[ -f "$OVERRIDE" ] || cp "$APP_ROOT/deploy/docker-compose.override.yml" "$OVERRIDE"

COMPOSE=(docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT"
         -f docker-compose.yml -f docker-compose.override.yml)

APP_CTR="${COMPOSE_PROJECT}-app-1"
WORKER_CTR="${COMPOSE_PROJECT}-worker-1"
PG_CTR="${COMPOSE_PROJECT}-postgres-1"

# ------------------------------------------------------- 1. 记录可回滚版本
log "记录当前运行的镜像版本..."
if docker ps -a --format '{{.Names}}' | grep -qx "$APP_CTR"; then
  docker inspect -f '{{.Image}}' "$APP_CTR"    > "$APP_ROOT/.rollback-app" 2>/dev/null || echo "" > "$APP_ROOT/.rollback-app"
  docker inspect -f '{{.Image}}' "$WORKER_CTR" > "$APP_ROOT/.rollback-worker" 2>/dev/null || echo "" > "$APP_ROOT/.rollback-worker"
else
  echo "" > "$APP_ROOT/.rollback-app"; echo "" > "$APP_ROOT/.rollback-worker"
  log "首次部署，无历史版本可回滚"
fi

# ------------------------------------------------------- 2. 数据库备份
if [ "$SKIP_BACKUP" = "true" ]; then
  log "已跳过数据库备份"
elif docker ps --format '{{.Names}}' | grep -qx "$PG_CTR"; then
  mkdir -p "$APP_ROOT/backups"
  TS="$(date +%F-%H%M%S)"
  if docker compose -p "$COMPOSE_PROJECT" exec -T postgres \
      pg_dump -U delivery -d delivery_audit | gzip > "$APP_ROOT/backups/db-$TS.sql.gz"; then
    log "数据库已备份：$APP_ROOT/backups/db-$TS.sql.gz"
  else
    fail "数据库备份失败，终止部署（确认无误后可用 --skip-backup 强制继续）"
    exit 1
  fi
else
  log "PostgreSQL 容器未运行（可能使用外部 RDS），跳过容器内备份"
fi

# ------------------------------------------------------- 3. 构建并启动
log "构建镜像..."
"${COMPOSE[@]}" build

log "滚动启动服务（容器内自动执行 prisma migrate deploy）..."
"${COMPOSE[@]}" up -d

# ------------------------------------------------------- 4. 版本标签
TS="$(date +%Y%m%d-%H%M%S)"
docker tag "$(docker inspect -f '{{.Image}}' "$APP_CTR")"    "delivery-app:$TS"    2>/dev/null || true
docker tag "$(docker inspect -f '{{.Image}}' "$WORKER_CTR")" "delivery-worker:$TS" 2>/dev/null || true
log "版本标签：delivery-app:$TS / delivery-worker:$TS"

# ------------------------------------------------------- 5. 健康检查
log "等待健康检查 http://127.0.0.1:3000/api/health ..."
DEADLINE=$(( $(date +%s) + HEALTH_TIMEOUT ))
until curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; do
  if [ "$(date +%s)" -gt "$DEADLINE" ]; then
    fail "健康检查超时。最近 60 行 app 日志："
    "${COMPOSE[@]}" logs --tail=60 app || true
    read -r -p "是否回滚到上一版本？[y/N] " ANS
    if [[ "$ANS" =~ ^[Yy]$ ]]; then
      bash "$APP_ROOT/deploy/rollback.sh"
    fi
    exit 1
  fi
  sleep 3
done

HEALTH="$(curl -fsS http://127.0.0.1:3000/api/health || true)"
log "健康检查通过：$HEALTH"
"${COMPOSE[@]}" ps
docker image prune -f >/dev/null 2>&1 || true
log "部署完成：$TS"
