#!/usr/bin/env bash
set -euo pipefail

app_ip=$1
[[ $app_ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Expected IPv4 address"; exit 1; }
release=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
case "$release" in /opt/project-board/releases/*) ;; *) echo "Unexpected release directory"; exit 1;; esac
test -f "/var/lib/project-board-acme/config/live/project-board-ip/fullchain.pem"
test -f "$release/dist/index.html"
/usr/bin/node --check "$release/server.mjs"

if ! getent passwd project-board >/dev/null; then
  useradd --system --user-group --no-create-home --shell /usr/sbin/nologin project-board
fi
install -d -m 0750 -o root -g www-data /etc/project-board
printf 'BOARD_PUBLIC_ORIGIN=https://%s:8753\n' "$app_ip" >/etc/project-board/app.env
chmod 0640 /etc/project-board/app.env

if [[ ! -s /etc/project-board/readers.htpasswd || ! -s /etc/project-board/writers.htpasswd ]]; then
  [[ ! -e /etc/project-board/owner-profile.json && ! -e /etc/project-board/reviewer-profile.json ]]
  umask 0077
  owner_secret=$(openssl rand -hex 24)
  reader_secret=$(openssl rand -hex 24)
  printf '{"url":"https://%s:8753","username":"board","password":"%s"}\n' "$app_ip" "$owner_secret" >/etc/project-board/owner-profile.json
  printf '{"url":"https://%s:8753","username":"review","password":"%s"}\n' "$app_ip" "$reader_secret" >/etc/project-board/reviewer-profile.json
  owner_hash=$(printf '%s\n' "$owner_secret" | openssl passwd -6 -stdin)
  reader_hash=$(printf '%s\n' "$reader_secret" | openssl passwd -6 -stdin)
  unset owner_secret reader_secret
  printf 'board:%s\n' "$owner_hash" >/etc/project-board/writers.htpasswd
  printf 'board:%s\nreview:%s\n' "$owner_hash" "$reader_hash" >/etc/project-board/readers.htpasswd
  chown root:www-data /etc/project-board/{writers,readers}.htpasswd
  chmod 0640 /etc/project-board/{writers,readers}.htpasswd
  umask 0022
fi

install -m 0644 "$release/deploy/board.service" /etc/systemd/system/project-board.service
install -m 0644 "$release/deploy/board-cert-renew.service" /etc/systemd/system/board-cert-renew.service
install -m 0644 "$release/deploy/board-cert-renew.timer" /etc/systemd/system/board-cert-renew.timer
config=/etc/nginx/conf.d/project-board.conf
if [[ -f "$config" ]]; then cp -p "$config" "$release/nginx.before"; fi
sed "s/@BOARD_IP@/$app_ip/g" "$release/deploy/nginx.conf" >"$config"
if ! nginx -t; then
  if [[ -f "$release/nginx.before" ]]; then cp -p "$release/nginx.before" "$config"; else rm -f "$config"; fi
  exit 1
fi

ln -sfnT "$release" /opt/project-board/current
systemctl daemon-reload
systemctl enable project-board.service
systemctl restart project-board.service
ready=false
for attempt in {1..25}; do
  if curl -fsS --max-time 2 http://127.0.0.1:48753/api/config >/dev/null; then ready=true; break; fi
  sleep 1
done
[[ $ready == true ]]
systemctl reload nginx
systemctl enable --now board-cert-renew.timer
systemctl is-active project-board.service
systemctl is-active board-cert-renew.timer
