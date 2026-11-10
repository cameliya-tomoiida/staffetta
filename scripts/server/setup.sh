#!/usr/bin/env bash
# STAFFETTA のサーバー（Ubuntu 24.04・ConoHa VPS 東京 2GB を想定）の初期設定（11/8 担当者の決定・管理役2）。root で1回だけ流す。
#
#   sudo bash scripts/server/setup.sh \
#     --admin <ログインする人の名前> --pubkey "<ssh-ed25519 AAAA... の1行>" \
#     --app-host <本番のホスト名> [--demo-host <見本のホスト名>] [--email <証明書の連絡先>]
#
# すること:
#   1. 管理の人（--admin）を作り、SSH は鍵だけ（パスワード・root のログインは止める）
#   2. ufw: 22（SSH）と 443（HTTPS）だけ開ける。80 も閉じる（証明書は 443 の TLS-ALPN で取る）
#   3. unattended-upgrades（セキュリティの更新を自動で）・スワップ 2GB（2GB のメモリで next build を通すため）
#   4. Node.js 24（node:sqlite を使うため 22.13 以上が要る。手元と同じ 24 にする）・sqlite3・gnupg・rclone・git
#   5. Caddy（自動 HTTPS）: 本番は 127.0.0.1:3100、見本は 127.0.0.1:3118 へ。証明書は RSA（LINE は ECDSA の証明書と TLS の交渉ができなかった。11/7）
#   6. アプリの人（staffetta・ログインできない）と置き場（/srv/staffetta）・設定（/etc/staffetta）・systemd（本番・見本・バックアップの時計）
# アプリの取得とビルドは deploy.sh、バックアップは backup.sh。
set -euo pipefail

ADMIN="" PUBKEY="" APP_HOST="" DEMO_HOST="" EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --admin) ADMIN="$2"; shift 2 ;;
    --pubkey) PUBKEY="$2"; shift 2 ;;
    --app-host) APP_HOST="$2"; shift 2 ;;
    --demo-host) DEMO_HOST="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    *) echo "知らない引数: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "root で流してください（sudo）" >&2; exit 1; }
[ -n "$ADMIN" ] && [ -n "$PUBKEY" ] && [ -n "$APP_HOST" ] || { echo "--admin・--pubkey・--app-host は必ず" >&2; exit 2; }
case "$PUBKEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;; *) echo "--pubkey は ssh-ed25519 などの公開鍵の1行" >&2; exit 2 ;; esac

APP_USER=staffetta
BASE=/srv/staffetta
export DEBIAN_FRONTEND=noninteractive

echo "== 1. 管理の人と SSH"
id "$ADMIN" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$ADMIN"
usermod -aG sudo "$ADMIN"
install -d -m 700 -o "$ADMIN" -g "$ADMIN" "/home/$ADMIN/.ssh"
grep -qxF "$PUBKEY" "/home/$ADMIN/.ssh/authorized_keys" 2>/dev/null || echo "$PUBKEY" >> "/home/$ADMIN/.ssh/authorized_keys"
chown "$ADMIN:$ADMIN" "/home/$ADMIN/.ssh/authorized_keys"; chmod 600 "/home/$ADMIN/.ssh/authorized_keys"
# sudo はパスワードなしで（鍵でしか入れないので、パスワードを持たせない）
echo "$ADMIN ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$ADMIN"; chmod 440 "/etc/sudoers.d/90-$ADMIN"
cat > /etc/ssh/sshd_config.d/10-staffetta.conf <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AllowUsers $ADMIN
EOF
sshd -t
systemctl reload ssh

echo "== 2. ファイアウォール（22・443 だけ）"
apt-get update -y
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 443/tcp
ufw --force enable

echo "== 3. 自動の更新・スワップ"
apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

echo "== 4. Node.js 24・道具"
apt-get install -y ca-certificates curl gnupg git sqlite3 rclone debian-keyring debian-archive-keyring apt-transport-https
if ! node -v 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== 5. Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
{
  echo "{"
  [ -n "$EMAIL" ] && echo "  email $EMAIL"
  echo "  # 80 は閉じているので、証明書は 443 の TLS-ALPN で取る"
  echo "  auto_https disable_redirects"
  echo "}"
  echo
  echo "$APP_HOST {"
  echo "  # LINE の Webhook は ECDSA の証明書と TLS の交渉ができなかった（11/7）ので RSA"
  echo "  tls {"
  echo "    key_type rsa2048"
  echo "  }"
  echo "  encode zstd gzip"
  echo "  reverse_proxy 127.0.0.1:3100"
  echo "}"
  if [ -n "$DEMO_HOST" ]; then
    echo
    echo "$DEMO_HOST {"
    echo "  tls {"
    echo "    key_type rsa2048"
    echo "  }"
    echo "  encode zstd gzip"
    echo "  reverse_proxy 127.0.0.1:3118"
    echo "}"
  fi
} > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "== 6. アプリの人・置き場・systemd"
id "$APP_USER" >/dev/null 2>&1 || adduser --system --group --home "$BASE" --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$BASE" "$BASE/app" "$BASE/data" "$BASE/demo"
install -d -o root -g "$APP_USER" -m 750 /etc/staffetta
# 本番の環境（秘密）。中身は人が入れる（このファイルを git には入れない）
if [ ! -f /etc/staffetta/env ]; then
  cat > /etc/staffetta/env <<EOF
# STAFFETTA 本番の環境（root と staffetta だけが読める）。値は人が入れる
NODE_ENV=production
HUB_DB_PATH=$BASE/data/hub.sqlite
HUB_DATA_DIR=$BASE/data
HUB_PUBLIC_URL=https://$APP_HOST
HUB_PASSWORD_LOGIN_OUTSIDE=1
ANTHROPIC_API_KEY=
FAX_INBOUND_TOKEN=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LINE_LOGIN_CHANNEL_ID=
NEXT_PUBLIC_LIFF_ID=
NEXT_PUBLIC_LIFF_STAFF_ID=
STAFF_SESSION_SECRET=
EOF
fi
# 見本の環境（秘密は Claude の API キーだけ。LINE・メール・FAX は空のまま）
if [ ! -f /etc/staffetta/demo.env ]; then
  cat > /etc/staffetta/demo.env <<EOF
# STAFFETTA 見本（審査員向け）の環境。LINE・メール・FAX の秘密は入れない
HUB_DEMO_PUBLIC_DIR=$BASE/demo
HUB_PUBLIC_URL=https://${DEMO_HOST:-demo.invalid}
DEMO_PUBLIC_UNTIL=2026-11-11T23:59:59+09:00
ANTHROPIC_API_KEY=
EOF
fi
chown root:"$APP_USER" /etc/staffetta/env /etc/staffetta/demo.env
chmod 640 /etc/staffetta/env /etc/staffetta/demo.env

cat > /etc/systemd/system/staffetta.service <<EOF
[Unit]
Description=STAFFETTA（本番 3100）
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$BASE/app
EnvironmentFile=/etc/staffetta/env
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 3100 -H 127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$BASE

[Install]
WantedBy=multi-user.target
EOF

# 見本: scripts/demo-public.mjs serve が next start（3118）を起こし、毎日 4:00 に見本を作り直す
cat > /etc/systemd/system/staffetta-demo.service <<EOF
[Unit]
Description=STAFFETTA 見本（審査員向け 3118）
After=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$BASE/app
EnvironmentFile=/etc/staffetta/demo.env
ExecStart=/usr/bin/node scripts/demo-public.mjs serve --public-url https://${DEMO_HOST:-demo.invalid}
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$BASE

[Install]
WantedBy=multi-user.target
EOF

# バックアップ: 毎日 4:00（全部）と 1時間ごと（DB だけ）。backup.sh は root で動く（鍵の合言葉を読むため）
cat > /etc/systemd/system/staffetta-backup.service <<EOF
[Unit]
Description=STAFFETTA のバックアップ（毎日）
[Service]
Type=oneshot
ExecStart=/bin/bash $BASE/app/scripts/server/backup.sh --kind daily
EOF
cat > /etc/systemd/system/staffetta-backup.timer <<EOF
[Unit]
Description=STAFFETTA のバックアップ（毎日 4:00 日本時間）
[Timer]
OnCalendar=*-*-* 04:00:00 Asia/Tokyo
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat > /etc/systemd/system/staffetta-backup-hourly.service <<EOF
[Unit]
Description=STAFFETTA のバックアップ（1時間ごと・DB だけ）
[Service]
Type=oneshot
ExecStart=/bin/bash $BASE/app/scripts/server/backup.sh --kind hourly
EOF
cat > /etc/systemd/system/staffetta-backup-hourly.timer <<EOF
[Unit]
Description=STAFFETTA のバックアップ（1時間ごと）
[Timer]
OnCalendar=hourly
Persistent=true
[Install]
WantedBy=timers.target
EOF
timedatectl set-timezone Asia/Tokyo
systemctl daemon-reload
systemctl enable staffetta.service
[ -n "$DEMO_HOST" ] && systemctl enable staffetta-demo.service

cat <<EOF

== できました。次にすること（docs/server.md）
  1. 別の端末で  ssh $ADMIN@<サーバー>  で入れることを確かめてから、この画面を閉じる
  2. /etc/staffetta/env・/etc/staffetta/demo.env に秘密を入れる（sudoedit）
  3. sudo bash $BASE/app/scripts/server/deploy.sh --repo <GitHub の URL>（アプリを取ってビルドし、起動する）
  4. バックアップの合言葉と S3 の設定のあと  sudo systemctl enable --now staffetta-backup.timer staffetta-backup-hourly.timer
  5. DNS: $APP_HOST${DEMO_HOST:+・$DEMO_HOST} をこのサーバーの IP に向ける（Caddy が証明書を取る）
EOF
