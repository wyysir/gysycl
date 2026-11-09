#!/usr/bin/env python3
"""Run interactively on the server; never print cloud credentials or passwords."""
import getpass
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

ROOT = Path('/opt/delivery-audit')
ENV = ROOT / '.env'
ADMIN = ROOT / 'admin.private.env'
os.umask(0o077)


def read_values(path):
    if not path.exists():
        return {}
    result = {}
    for line in path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            result[key] = value
    return result


def write_values(path, values):
    # All values accepted here are single-line literals safe for Compose env parsing.
    for value in values.values():
        if any(char in value for char in '\r\n\x00'):
            raise ValueError('配置值不能含换行。')
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.configure-')
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(''.join(f'{key}={value}\n' for key, value in values.items()))
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def prompt_secret(label, existing=''):
    while True:
        value = getpass.getpass(label + ('（回车保留已填值）' if existing else '') + '：').strip()
        value = value or existing
        if label == '百炼 API Key' and not value.startswith('sk-'):
            print('请使用百炼模型服务 API Key（以 sk- 开头），不要填阿里云 AccessKey。')
            continue
        if value and not any(char in value for char in "\r\n\x00$'\"# "):
            return value
        print('请输入有效的单行密钥，不要包含空格或引号。')


if __name__ == '__main__':
    ROOT.mkdir(mode=0o700, exist_ok=True)
    values = read_values(ENV)
    print('填写食安链试用配置。密钥和密码输入时不显示，直接粘贴后回车。')
    values.setdefault('APP_URL', 'https://42.121.106.105')
    values.setdefault('SESSION_SECRET', secrets.token_hex(32))
    values.setdefault('POSTGRES_PASSWORD', secrets.token_hex(24))
    values.update(DEMO_MODE='false', OCR_MODE='aliyun', STORAGE_DRIVER='local')
    values['DASHSCOPE_API_KEY'] = prompt_secret('百炼 API Key', values.get('DASHSCOPE_API_KEY', ''))
    values.setdefault('DASHSCOPE_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1')
    current_model = values.get('QWEN_VL_MODEL', 'qwen3.6-flash')
    model = input(f'百炼模型名称（回车使用 {current_model}）：').strip() or current_model
    if not all(char.isalnum() or char in '-._/' for char in model):
        raise ValueError('模型名称格式不正确。')
    values['QWEN_VL_MODEL'] = model
    write_values(ENV, values)
    if not ADMIN.exists():
        while True:
            password = getpass.getpass('设置系统管理员密码（至少12位，建议字母与数字组合）：')
            confirm = getpass.getpass('再次输入管理员密码：')
            if len(password) >= 12 and password == confirm and not any(char in password for char in "\r\n\x00$'\"# "):
                break
            print('两次密码需相同、至少12位，且不含空格、美元符号、引号或井号。')
        write_values(ADMIN, {'ADMIN_EMPLOYEE_NO': 'admin', 'ADMIN_NAME': '系统管理员', 'ADMIN_PASSWORD': password})
    print('配置已保存到服务器，文件权限为仅管理员可读。管理员员工号：admin。')
    subprocess.run(['touch', str(ROOT / '.credentials-ready')], check=True)
