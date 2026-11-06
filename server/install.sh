#!/usr/bin/env bash
#
# Установка (или обновление) сервера мессенджера beemes на Ubuntu одной командой.
# Ставится на свой сервер (Ubuntu 24.04). Можно и на сервер, где уже работает сайт «Простая химия»:
# тогда оба сайта будут работать вместе.
#
# Запуск на сервере (под пользователем root):
#   curl -fsSL https://raw.githubusercontent.com/Kirill898990/beemes/refs/heads/main/server/install.sh \
#     | bash -s -- beemes.ru ПОЧТА_АДМИНИСТРАТОРА ПАРОЛЬ_АДМИНИСТРАТОРА
#
# Что делает:
#   1. скачивает PocketBase и файлы beemes с GitHub (база, правила доступа, сайт, страница звонка);
#   2. запускает beemes на 127.0.0.1:8091 с автозапуском (папка /opt/beemes);
#   3. ставит Caddy — он получает бесплатные сертификаты https (для beemes.ru и www.beemes.ru).
#      Если на сервере уже работает сайт школы, он переводится за Caddy (его база не трогается);
#   4. для звонков использует тот же TURN-сервер (coturn), что и сайт школы, или ставит его;
#   5. создаёт администратора (если указаны почта и пароль).
#
# Повторный запуск обновляет сайт и миграции. База с перепиской (pb_data) не трогается.

set -euo pipefail

DOMAIN_INPUT="${1:-}"
ADMIN_EMAIL="${2:-}"
ADMIN_PASSWORD="${3:-}"
PB_VERSION="${PB_VERSION:-0.40.6}"
REPO="${REPO:-Kirill898990/beemes}"
BRANCH="${BRANCH:-main}"
REF="${REF:-}"
DIR="${DIR:-/opt/beemes}"
PORT="${PORT:-8091}"
# Сайт школы на этом же сервере (если есть).
SCHOOL_DIR="${SCHOOL_DIR:-/opt/pocketbase}"
SCHOOL_REPO="${SCHOOL_REPO:-Kirill898990/Python}"
SCHOOL_INSTALL_URL="${SCHOOL_INSTALL_URL:-https://raw.githubusercontent.com/${SCHOOL_REPO}/refs/heads/main/server/install.sh}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
CADDY_DIR="${CADDY_DIR:-/etc/caddy}"
TURN_CONF="${TURN_CONF:-/etc/turnserver.conf}"
# Дополнительные домены, на которых beemes тоже открывается (например, старый адрес при переезде):
#   ALSO_DOMAINS="kbast.ru" bash -s -- beemes.ru …
ALSO_DOMAINS="${ALSO_DOMAINS:-}"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$DOMAIN_INPUT" ] || fail "укажите домен, например: bash install.sh beemes.ru admin@mail.ru Пароль123"
[ "$(id -u)" -eq 0 ] || fail "запустите от имени root (или добавьте sudo перед bash)"
if [ -n "$ADMIN_EMAIL" ] && [ "${#ADMIN_PASSWORD}" -lt 10 ]; then
  fail "пароль администратора должен быть не короче 10 символов"
fi

# Сайт школы сейчас сам держит порты 80 и 443? Тогда его нужно перевести за Caddy,
# а для этого в нём должна быть поддержка работы за Caddy (файл pb_hooks/proxy.pb.js).
SCHOOL_UNIT="$SYSTEMD_DIR/pocketbase.service"
SCHOOL_DIRECT=0
if [ -f "$SCHOOL_UNIT" ] && ! grep -q -- "--http 127.0.0.1:" "$SCHOOL_UNIT"; then
  SCHOOL_DIRECT=1
  grep -rqs "BEHIND_PROXY" "$SCHOOL_DIR/pb_hooks" || fail "сначала обновите сайт школы (нужна версия с поддержкой Caddy), потом запустите эту установку ещё раз."
fi

say "Устанавливаю нужные программы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl unzip idn2 ca-certificates >/dev/null

# Русский домен → технический вид (punycode), например: пчёлка.рф → xn--...; обычный домен не меняется.
DOMAIN="$(idn2 "$DOMAIN_INPUT")"
DOMAIN="${DOMAIN#www.}"

case "$(uname -m)" in
  x86_64) ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) fail "неизвестный тип процессора: $(uname -m)" ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DIR"

say "Скачиваю PocketBase $PB_VERSION"
curl -fsSL -o "$TMP/pb.zip" \
  "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip"
unzip -q -o "$TMP/pb.zip" pocketbase -d "$TMP/pb"

if [ -n "$REF" ]; then
  say "Скачиваю beemes с GitHub (версия ${REF:0:7})"
  curl -fsSL -o "$TMP/src.zip" "https://github.com/${REPO}/archive/${REF}.zip"
else
  say "Скачиваю beemes с GitHub (ветка $BRANCH)"
  curl -fsSL -o "$TMP/src.zip" "https://github.com/${REPO}/archive/refs/heads/${BRANCH}.zip"
fi
unzip -q "$TMP/src.zip" -d "$TMP/src"
SRC="$(find "$TMP/src" -mindepth 2 -maxdepth 2 -type d -name server | head -n 1)"
[ -n "$SRC" ] && [ -d "$SRC/pb_migrations" ] && [ -d "$SRC/pb_public" ] && [ -d "$SRC/pb_hooks" ] || fail "в архиве не найдена папка server"

systemctl stop beemes 2>/dev/null || true

install -m 755 "$TMP/pb/pocketbase" "$DIR/pocketbase"
mkdir -p "$DIR/pb_migrations"
cp "$SRC"/pb_migrations/*.js "$DIR/pb_migrations/"
rm -rf "$DIR/pb_public" "$DIR/pb_hooks"
cp -r "$SRC/pb_public" "$DIR/pb_public"
cp -r "$SRC/pb_hooks" "$DIR/pb_hooks"

FRESH_INSTALL=0
[ -d "$DIR/pb_data" ] || FRESH_INSTALL=1

say "Применяю структуру базы"
"$DIR/pocketbase" migrate up --dir "$DIR/pb_data" --migrationsDir "$DIR/pb_migrations" --hooksDir "$DIR/pb_hooks" >/dev/null

if [ -n "$ADMIN_EMAIL" ]; then
  say "Создаю администратора $ADMIN_EMAIL"
  "$DIR/pocketbase" superuser upsert "$ADMIN_EMAIL" "$ADMIN_PASSWORD" --dir "$DIR/pb_data" >/dev/null
fi

# Настройки, которые не хранятся в базе. Файл виден только root.
ENV_FILE="$DIR/server.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_env() {
  { grep -v "^$1=" "$ENV_FILE" || true; echo "$1=$2"; } > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}
set_env SITE_URL "https://$DOMAIN"
set_env BEHIND_PROXY 1

UFW_ON=0
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then UFW_ON=1; fi

# Звонки: TURN-сервер (coturn) нужен, когда телефоны не могут соединиться напрямую (часто в мобильном интернете).
# Если его уже поставил сайт школы — пользуемся им же. Отключить: TURN=0.
if [ "${TURN:-1}" != "0" ]; then
  say "Настраиваю сервер для звонков"
  TURN_SECRET="$(sed -n 's/^static-auth-secret=//p' "$TURN_CONF" 2>/dev/null | head -n 1 || true)"
  if [ -n "$TURN_SECRET" ]; then
    TURN_HOST="$(sed -n 's/^TURN_HOST=//p' "$SCHOOL_DIR/server.env" 2>/dev/null | head -n 1 || true)"
    set_env TURN_SECRET "$TURN_SECRET"
    set_env TURN_HOST "${TURN_HOST:-$DOMAIN}"
    echo "  Используем TURN-сервер, который уже работает на этом сервере."
  elif apt-get install -y -qq coturn >/dev/null 2>&1; then
    TURN_SECRET="$(grep '^TURN_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)"
    [ -n "$TURN_SECRET" ] || TURN_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    set_env TURN_SECRET "$TURN_SECRET"
    set_env TURN_HOST "$DOMAIN"
    LOCAL_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' || true)"
    PUBLIC_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR == 1 {print $1}' || true)"
    EXTERNAL=""
    case "$LOCAL_IP" in
      10.* | 192.168.* | 172.1[6-9].* | 172.2[0-9].* | 172.3[01].*)
        if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "$LOCAL_IP" ]; then EXTERNAL="external-ip=$PUBLIC_IP/$LOCAL_IP"; fi ;;
    esac
    cat > "$TURN_CONF" <<TURNCONF
# Создано install.sh (beemes) для звонков. Пароли проверяются по секрету из $ENV_FILE.
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=$DOMAIN
min-port=49160
max-port=49250
total-quota=60
no-cli
no-tls
no-dtls
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
syslog
$EXTERNAL
TURNCONF
    chmod 640 "$TURN_CONF"
    chgrp turnserver "$TURN_CONF" 2>/dev/null || true
    if [ -f /etc/default/coturn ]; then sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn; fi
    systemctl enable coturn >/dev/null 2>&1 || true
    systemctl restart coturn 2>/dev/null || echo "  Сервер для звонков не запустился: звонки будут работать, только если телефоны соединятся напрямую."
    if [ "$UFW_ON" = 1 ]; then
      ufw allow 3478 >/dev/null
      ufw allow 49160:49250/udp >/dev/null
    fi
  else
    echo "  Не получилось установить coturn: звонки будут работать, только если телефоны соединятся напрямую."
  fi
fi

say "Настраиваю автозапуск beemes"
cat > "$SYSTEMD_DIR/beemes.service" <<EOF
[Unit]
Description=PocketBase для мессенджера beemes
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$DIR
EnvironmentFile=-$DIR/server.env
ExecStart=$DIR/pocketbase serve --http 127.0.0.1:$PORT --dir $DIR/pb_data --migrationsDir $DIR/pb_migrations --hooksDir $DIR/pb_hooks --publicDir $DIR/pb_public
Restart=always
RestartSec=5
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable beemes >/dev/null 2>&1
systemctl restart beemes
sleep 3
systemctl is-active --quiet beemes || fail "beemes не запустился. Подробности: journalctl -u beemes -n 50"

# ---------- Caddy: https для всех сайтов на этом сервере ----------
say "Настраиваю Caddy (https)"
if ! command -v caddy >/dev/null 2>&1; then
  # Не даём Caddy запуститься сразу после установки: порты 80 и 443 пока может держать сайт школы.
  POLICY_ADDED=0
  if [ ! -e /usr/sbin/policy-rc.d ]; then
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
    chmod 755 /usr/sbin/policy-rc.d
    POLICY_ADDED=1
  fi
  if ! apt-get install -y -qq caddy >/dev/null 2>&1; then
    # В старых версиях Ubuntu Caddy нет — берём из официального репозитория Caddy.
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null 2>&1 || true
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null || { [ "$POLICY_ADDED" = 1 ] && rm -f /usr/sbin/policy-rc.d; fail "не получилось установить Caddy"; }
  fi
  [ "$POLICY_ADDED" = 1 ] && rm -f /usr/sbin/policy-rc.d
fi

mkdir -p "$CADDY_DIR/sites"
# Почта нужна Let's Encrypt только для писем о сертификатах; без неё тоже работает.
CADDY_EMAIL=""
if [ -n "$ADMIN_EMAIL" ]; then CADDY_EMAIL="	email $ADMIN_EMAIL"; fi
cat > "$CADDY_DIR/Caddyfile" <<EOF
# Создано install.sh (beemes). Каждый сайт — отдельный файл в $CADDY_DIR/sites.
{
$CADDY_EMAIL
}

import $CADDY_DIR/sites/*.caddy
EOF
# Основной домен и дополнительные (ALSO_DOMAINS), для каждого вида beemes.ru — ещё www.
SITE_DOMAINS="$DOMAIN"
WWW_DOMAINS=""
for d in $DOMAIN $(for a in $ALSO_DOMAINS; do idn2 "$a"; done); do
  d="${d#www.}"
  [ "$d" = "$DOMAIN" ] || SITE_DOMAINS="$SITE_DOMAINS, $d"
  if [ "$(printf '%s' "$d" | tr -cd '.' | wc -c)" = 1 ]; then WWW_DOMAINS="${WWW_DOMAINS:+$WWW_DOMAINS, }www.$d"; fi
done
cat > "$CADDY_DIR/sites/beemes.caddy" <<EOF
# Мессенджер beemes (создано install.sh). PocketBase работает на 127.0.0.1:$PORT.
$SITE_DOMAINS {
	@compress not path /api/realtime
	encode @compress zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
# www.beemes.ru тоже открывается и ведёт на основной адрес.
if [ -n "$WWW_DOMAINS" ]; then
  cat >> "$CADDY_DIR/sites/beemes.caddy" <<EOF

$WWW_DOMAINS {
	redir https://$DOMAIN{uri} permanent
}
EOF
fi
caddy validate --config "$CADDY_DIR/Caddyfile" --adapter caddyfile >/dev/null 2>&1 || fail "ошибка в настройках Caddy: caddy validate --config $CADDY_DIR/Caddyfile"

# Сайт школы держит порты сам — переводим его за Caddy его же установкой: увидев Caddy,
# она запустит сайт на 127.0.0.1:8090 и добавит его в $CADDY_DIR/sites. База школы не трогается.
if [ "$SCHOOL_DIRECT" = 1 ]; then
  SCHOOL_DOMAIN="$(sed -n 's#^SITE_URL=https\?://##p' "$SCHOOL_DIR/server.env" 2>/dev/null | head -n 1 || true)"
  [ -n "$SCHOOL_DOMAIN" ] || SCHOOL_DOMAIN="$(sed -n 's#^ExecStart=.* serve \([^ -][^ ]*\) .*#\1#p' "$SCHOOL_UNIT" | head -n 1)"
  [ -n "$SCHOOL_DOMAIN" ] || fail "не понял домен сайта школы. Запустите установку сайта школы вручную, потом эту ещё раз."
  say "Перевожу сайт школы ($SCHOOL_DOMAIN) за Caddy"
  curl -fsSL "$SCHOOL_INSTALL_URL" -o "$TMP/school-install.sh"
  # Свои настройки (REF, REPO…) установке школы не передаём — она берёт свою ветку main.
  REF="" REPO="$SCHOOL_REPO" BRANCH=main DIR="$SCHOOL_DIR" bash "$TMP/school-install.sh" "$SCHOOL_DOMAIN"
fi

if [ "$UFW_ON" = 1 ]; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 2
systemctl is-active --quiet caddy || fail "Caddy не запустился. Подробности: journalctl -u caddy -n 50"

SERVER_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' || true)"
DOMAIN_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR == 1 {print $1}' || true)"

say "Готово! beemes работает и будет запускаться сам."
echo "  Сайт:                  https://$DOMAIN_INPUT/"
echo "  Панель администратора: https://$DOMAIN_INPUT/_/"
echo "  Журнал:                journalctl -u beemes -f   (https: journalctl -u caddy -f)"
if [ -z "$ADMIN_EMAIL" ] && [ "$FRESH_INSTALL" = 1 ]; then
  echo
  echo "  Администратора создайте командой:"
  echo "  $DIR/pocketbase superuser upsert ПОЧТА ПАРОЛЬ --dir $DIR/pb_data"
fi
echo
echo "  Уведомления: в панели администратора откройте bm_settings и вставьте ключ сервисного аккаунта Firebase"
echo "  (файл JSON целиком, см. README)."
if [ -n "$SERVER_IP" ] && [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
  echo
  printf '\033[1;33m  Внимание: домен сейчас указывает на %s, а у этого сервера адрес %s.\033[0m\n' "${DOMAIN_IP:-никуда}" "$SERVER_IP"
  echo "  Добавьте A-запись для $DOMAIN_INPUT с адресом $SERVER_IP. Когда DNS обновится (от 15 минут до суток),"
  echo "  сайт и https заработают сами, ничего перезапускать не нужно."
fi
