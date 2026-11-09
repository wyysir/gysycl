#!/usr/bin/env python3
"""Restore a supplied backup into a NEW isolated database and compare row counts."""
import gzip
import json
from pathlib import Path
import subprocess
import sys

folder = Path(sys.argv[1]).resolve()
assert folder.is_relative_to(Path('/opt/delivery-audit/backups'))
database = 'delivery_restore_check_20261029'
container = ['docker', 'exec', '-i', 'delivery-postgres-1']


def sql(db, query):
    return subprocess.check_output(container + ['psql', '-U', 'delivery', '-d', db, '-tAc', query], text=True).strip()


if sql('postgres', f"SELECT 1 FROM pg_database WHERE datname='{database}'"):
    raise SystemExit('恢复验证库已存在，停止以避免改动已有数据库。')
subprocess.run(container + ['createdb', '-U', 'delivery', database], check=True)
payload = gzip.decompress((folder / 'database.sql.gz').read_bytes())
result = subprocess.run(container + ['psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'delivery', '-d', database], input=payload, capture_output=True)
if result.returncode:
    raise SystemExit('恢复失败；保留验证库供排查，未更改业务数据库。')
tables = ['Document', 'DocumentPage', 'DocumentItem', 'ApprovalRecord', 'AuditLog']
counts = {table: {'source': int(sql('delivery_audit', f'SELECT count(*) FROM "{table}"')), 'restored': int(sql(database, f'SELECT count(*) FROM "{table}"'))} for table in tables}
matched = all(value['source'] == value['restored'] for value in counts.values())
report = {'backup': str(folder), 'isolatedDatabase': database, 'counts': counts, 'matched': matched}
(Path('/opt/delivery-audit/verification') / 'restore-results.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
if not matched:
    raise SystemExit('行数不同，请检查是否有并发业务写入；恢复验证库已保留。')
# Only delete the exact database created by this invocation, after verification.
subprocess.run(container + ['dropdb', '-U', 'delivery', database], check=True)
