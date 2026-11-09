#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/delivery-audit
dc=(docker compose --env-file "$root/.env" -p delivery -f "$root/app/deploy/compose.trial.yml")
stamp=$(date +%Y%m%d-%H%M%S)
destination="$root/backups/$stamp"
install -d -m 700 "$destination"
"${dc[@]}" exec -T postgres pg_dump -U delivery -d delivery_audit | gzip > "$destination/database.sql.gz"
"${dc[@]}" exec -T app tar -C /app/.data/uploads -czf - . > "$destination/uploads.tar.gz"
gzip -t "$destination/database.sql.gz"
tar -tzf "$destination/uploads.tar.gz" > /dev/null
(cd "$destination" && sha256sum database.sql.gz uploads.tar.gz > SHA256SUMS)
printf '%s\n' "$destination"
# No automatic deletion: retaining/removing snapshots is an explicit maintenance action.
