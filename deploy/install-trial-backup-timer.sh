#!/usr/bin/env bash
set -euo pipefail
test -f /opt/delivery-audit/app/deploy/backup-trial.sh
cat > /etc/systemd/system/shian-backup.service <<'SERVICE'
[Unit]
Description=Back up Shian trial PostgreSQL and uploaded images
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
UMask=0077
ExecStart=/bin/bash /opt/delivery-audit/app/deploy/backup-trial.sh
SERVICE
cat > /etc/systemd/system/shian-backup.timer <<'TIMER'
[Unit]
Description=Daily local backup for Shian trial
[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=600
Persistent=true
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now shian-backup.timer
