#!/usr/bin/env python3
"""One explicit deployment smoke run; creates clearly labelled synthetic test data."""
import http.cookiejar
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import io

ROOT = Path('/opt/delivery-audit')
os.umask(0o077)
config = dict(line.split('=', 1) for line in (ROOT / '.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
admin = dict(line.split('=', 1) for line in (ROOT / 'admin.private.env').read_text().splitlines() if '=' in line)
base = config['APP_URL']
previous_path = ROOT / 'verification/latest.json'
previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
queued_case = '--new-queued-case' in sys.argv
if queued_case:
    if previous:
        (ROOT / 'verification/staged-results.json').write_text(json.dumps(previous, ensure_ascii=False, indent=2))
    previous = {key: previous[key] for key in ['projectId'] if key in previous}
if previous.get('complete'):
    raise SystemExit('已有完整验收结果，停止以避免重复创建测试单或调用收费接口。')
if previous.get('functionalFlowPassed'):
    raise SystemExit('业务闭环已通过，请单独复测尚未通过的云通道，避免重新处理已审核样例。')
report = {key: previous[key] for key in ['projectId', 'documentId'] if key in previous}
report.update(url=base, model=config['QWEN_VL_MODEL'], checks=[])
output = ROOT / 'verification'
output.mkdir(mode=0o700, exist_ok=True)
dc = ['docker', 'compose', '--env-file', str(ROOT / '.env'), '-p', 'delivery', '-f', str(ROOT / 'app/deploy/compose.trial.yml')]


def record(name, value=True):
    report['checks'].append({'name': name, 'result': value})
    print(name, json.dumps(value, ensure_ascii=False), flush=True)
    (output / 'latest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))


environment = os.environ.copy()
environment.update(admin)
subprocess.run(dc + ['exec', '-T', '-e', 'ADMIN_EMPLOYEE_NO', '-e', 'ADMIN_PASSWORD', '-e', 'ADMIN_NAME', 'app', 'npm', 'run', 'create-admin'], env=environment, check=True)
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPSHandler(context=ssl.create_default_context()))


def request(route, data=None, method=None, raw=False, headers=None):
    body = json.dumps(data, ensure_ascii=False).encode() if data is not None and not isinstance(data, bytes) else data
    request_headers = {'Origin': base, 'Content-Type': 'application/json'}
    request_headers.update(headers or {})
    req = urllib.request.Request(base + route, data=body, method=method or ('POST' if body is not None else 'GET'), headers=request_headers)
    try:
        with client.open(req, timeout=180) as response:
            content = response.read()
            return content if raw else json.loads(content)
    except urllib.error.HTTPError as error:
        # Request bodies include passwords only for login; never print them.
        raise RuntimeError(f'{route.split("?")[0]} HTTP {error.code}: {error.read().decode()[:400]}') from None


health = request('/api/health')
assert health['ok'] is True
record('HTTPS + PostgreSQL health', health)
user = request('/api/auth/login', {'employeeNo': admin['ADMIN_EMPLOYEE_NO'], 'password': admin['ADMIN_PASSWORD']})
assert user['user']['globalRole'] == 'ADMIN'
assert any(cookie.name == 'delivery_session' and cookie.secure for cookie in jar)
record('管理员登录和 Secure Cookie')
for page in ['/dashboard', '/documents', '/upload', '/master', '/reviews', '/analytics']:
    html = request(page, raw=True)
    assert len(html) > 1000
record('六个主要页面可访问')
project = {'id': previous['projectId']} if previous.get('projectId') else request('/api/projects', {'code': 'DEPLOY_TEST', 'name': '部署验收测试项目', 'region': '测试数据'})
report['projectId'] = project['id']
if previous.get('documentId'):
    created = {'id': previous['documentId']}
    if '--use-existing' in sys.argv:
        record('使用已取得的真实视觉识别结果继续功能测试')
    else:
        request('/api/documents/' + created['id'] + '/ocr', {})
        record('重试此前未通过的识别任务')
else:
    png = (ROOT / ('verification/deployment-sample-queued.png' if queued_case else 'verification/deployment-sample.png')).read_bytes()
    target = request('/api/uploads/presign', {'mime': 'image/png', 'fileName': '部署验收测试单.png', 'size': len(png)})
    request(target['url'], png, method='PUT', raw=True, headers=target['headers'])
    record('图片上传到持久卷')
    created = request('/api/documents', {'projectId': project['id'], 'docDate': '2026-10-12', 'pages': [{'objectKey': target['objectKey'], 'mime': 'image/png', 'fileName': '部署验收测试单.png'}]})
    report['documentId'] = created['id']
    record('识别任务进入队列', created['queue'])
for attempt in range(90):
    time.sleep(2)
    detail = request('/api/documents/' + created['id'])
    if detail['document']['status'] != 'PROCESSING':
        break
else:
    raise RuntimeError('后台识别超过180秒')
document = detail['document']
assert not document['ocrError'], document['ocrError'][:300]
assert len(document['items']) == 2, '样例单应识别为两行'
assert abs(document['totalAmount'] - 458) < 0.01, '样例总金额应为458'
ocr_audit = next(entry for entry in detail['audit'] if entry['action'] == 'ocr.completed')['detail']
record('Qwen视觉模型识别', {'provider': ocr_audit['provider'], 'warnings': ocr_audit['warnings'], 'rows': len(document['items']), 'total': document['totalAmount']})
report['visionRecognitionPassed'] = bool(document['items']) and 'aliyun-ocr' not in ocr_audit['provider']
assert report['visionRecognitionPassed'], '视觉模型未返回有效明细或仍使用传统OCR'
request(document['pages'][0]['url'], raw=True)
record('私有图片可读取')
master = request('/api/bootstrap')
supplier = next((entry for entry in master['suppliers'] if entry['name'] == '部署验收测试供应商'), None) or request('/api/master-data/suppliers', {'name': '部署验收测试供应商', 'confirmNew': True})
items = []
for index, line in enumerate(document['items']):
    ingredient_name = '验收测试材料' + str(index + 1)
    ingredient = next((entry for entry in master['ingredients'] if entry['name'] == ingredient_name), None) or request('/api/master-data/ingredients', {'name': ingredient_name, 'spec': line['spec'], 'unit': line['unit'] or 'kg', 'confirmNew': True})
    items.append({**line, 'ingredientId': ingredient['id'], 'name': ingredient['name'], 'unit': ingredient['unit'], 'matchStatus': 'MATCHED', 'matchScore': 1})
saved = request('/api/documents/' + created['id'], {'version': document['version'], 'docNo': 'DEPLOY-TEST-QUEUED-20261029' if queued_case else 'DEPLOY-TEST-20261029', 'docDate': '2026-10-12', 'projectId': project['id'], 'supplierId': supplier['id'], 'items': items, 'totalAmount': 458, 'notes': '系统部署验收样例，非真实采购业务。'}, method='PATCH')
record('校正保存')
request('/api/documents/' + created['id'] + '/submit', {})
request('/api/documents/' + created['id'] + '/review', {'action': 'return', 'note': '部署验收：测试退回重提'})
returned = request('/api/documents/' + created['id'])['document']
request('/api/documents/' + created['id'], {'version': returned['version'], 'docNo': returned['docNo'], 'docDate': returned['docDate'], 'projectId': project['id'], 'supplierId': supplier['id'], 'items': returned['items'], 'totalAmount': 458, 'notes': '部署验收：退回后已修改补充说明，非真实采购业务。'}, method='PATCH')
record('退回后实际修改并保存')
request('/api/documents/' + created['id'] + '/submit', {})
request('/api/documents/' + created['id'] + '/review', {'action': 'approve', 'note': '部署验收通过'})
final = request('/api/documents/' + created['id'])
assert final['document']['status'] == 'APPROVED'
record('提交、退回、重提、审核通过')
export = request('/api/export/documents?projectId=' + project['id'], raw=True)
with zipfile.ZipFile(io.BytesIO(export)) as workbook:
    assert len([name for name in workbook.namelist() if name.startswith('xl/worksheets/sheet') and name.endswith('.xml')]) == 3
(output / 'deployment-export.xlsx').write_bytes(export)
record('Excel 三张工作表导出')
report['functionalFlowPassed'] = True
report['complete'] = report['dualChannelPassed']
(output / 'latest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
