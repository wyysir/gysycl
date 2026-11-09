#!/usr/bin/env bash
# 回滚到上一个版本的镜像
# 用法：
#   bash deploy/rollback.sh                       # 回滚到 deploy.sh 记录的上一个版本
#   APP_IMAGE=delivery-app:20261023-1030 \
#   WORKER_IMAGE=delivery-worker:20261023-1030 bash deploy/rollback.sh
#
# 说明：只回滚应用镜像，不动数据库。
#      若本次发布包含不可逆的 Prisma 迁移，需要先按 docs/deployment.md §6.3 恢复数据库备份。
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/delivery-audit}"
APP_DIR="${APP_DIR:-$APP_ROOT/app}"
ENV_FILE="${ENV_FILE:-$APP_ROOT/.env}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-delivery}"

log() { printf '\033[33m[rollback]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[错误]\033[0m %s\n' "$*" >&2; }

PREV_APP="$(cat "$APP_ROOT/.rollback-app" 2>/dev/null || true)"
PREV_WORKER="$(cat "$APP_ROOT/.rollback-worker" 2>/dev/null || true)"
APP_IMAGE="${APP_IMAGE:-$PREV_APP}"
WORKER_IMAGE="${WORKER_IMAGE:-$PREV_WORKER}"

[ -n "$APP_IMAGE" ]    || { fail "未找到可回滚的 app 镜像（$APP_ROOT/.rollback-app 为空），可手工指定 APP_IMAGE"; exit 1; }
[ -n "$WORKER_IMAGE" ] || { fail "未找到可回滚的 worker 镜像，可手工指定 WORKER_IMAGE"; exit 1; }

docker image inspect "$APP_IMAGE"    >/dev/null 2>&1 || { fail "镜像不存在：$APP_IMAGE"; exit 1; }
docker image inspect "$WORKER_IMAGE" >/dev/null 2>&1 || { fail "镜像不存在：$WORKER_IMAGE"; exit 1; }

log "回滚目标：app=$APP_IMAGE  worker=$WORKER_IMAGE"
read -r -p "确认回滚？[y/N] " ANS
[[ "$ANS" =~ ^[Yy]$ ]] || { log "已取消"; exit 0; }

cd "$APP_DIR"
export APP_IMAGE WORKER_IMAGE
docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT" \
  -f docker-compose.yml \
  -f docker-compose.override.yml \
  -f "$APP_ROOT/deploy/docker-compose.rollback.yml" \
  up -d --no-build

log "等待健康检查..."
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    log "回滚完成，健康检查通过：$(curl -fsS http://127.0.0.1:3000/api/health)"
    docker compose -p "$COMPOSE_PROJECT" ps
    exit 0
  fi
  sleep 3
done

fail "回滚后健康检查未通过，请查看：docker compose -p $COMPOSE_PROJECT logs --tail=100 app"
exit 1
