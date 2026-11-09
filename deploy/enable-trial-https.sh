#!/usr/bin/env bash
set -euo pipefail
# Run as root after Certbot has issued the shian-ip certificate.
test -s /etc/letsencrypt/live/shian-ip/fullchain.pem
cat > /etc/nginx/sites-available/shian-trial.conf <<'NGINX'
log_format shian_trial '$remote_addr [$time_local] "$request_method $uri $server_protocol" $status $body_bytes_sent';
server {
    listen 80;
    server_name 42.121.106.105;
    access_log /var/log/nginx/shian-trial.access.log shian_trial;
    location ^~ /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://42.121.106.105$request_uri; }
}
server {
    listen 443 ssl;
    http2 on;
    server_name 42.121.106.105;
    access_log /var/log/nginx/shian-trial.access.log shian_trial;
    ssl_certificate /etc/letsencrypt/live/shian-ip/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shian-ip/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 80m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 180s;
    }
}
NGINX
# Ubuntu 24.04 ships Nginx 1.24, whose HTTP/2 setting uses the listen directive.
sed -i 's/listen 443 ssl;/listen 443 ssl http2;/; /http2 on;/d' /etc/nginx/sites-available/shian-trial.conf
ln -sf /etc/nginx/sites-available/shian-trial.conf /etc/nginx/sites-enabled/shian-trial.conf
nginx -t
systemctl reload nginx
install -d /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
set -e
nginx -t
systemctl reload nginx
HOOK
chmod 700 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
cat > /etc/systemd/system/shian-certbot-renew.service <<'SERVICE'
[Unit]
Description=Renew short-lived HTTPS IP certificate for Shian trial
After=network-online.target nginx.service
[Service]
Type=oneshot
ExecStart=/opt/certbot/bin/certbot renew --quiet
SERVICE
cat > /etc/systemd/system/shian-certbot-renew.timer <<'TIMER'
[Unit]
Description=Check Shian IP certificate renewal twice daily
[Timer]
OnCalendar=*-*-* 00,12:20:00
RandomizedDelaySec=1800
Persistent=true
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now shian-certbot-renew.timer
