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
#
# Домашний сервер без открытых портов (через туннель) — TUNNEL=tuna:
#   curl -fsSL https://raw.githubusercontent.com/Kirill898990/beemes/refs/heads/main/server/install.sh \
#     | sudo TUNNEL=tuna bash -s -- beemes.ru ПОЧТА_АДМИНИСТРАТОРА ПАРОЛЬ_АДМИНИСТРАТОРА
# Caddy и свой сервер звонков тогда не ставятся (звонки соединяются напрямую), брандмауэр закрывает всё
# входящее (SSH — только из домашней сети), посетители приходят через туннель Tuna (tuna.am, серверы в России,
# свой домен — на платном тарифе). Установка спросит ключ Tuna (my.tuna.am → API-ключи, право tunnels:connect).
# Обновления сервер забирает с GitHub сам.
# Дополнительно для домашнего сервера (запоминаются, при повторном запуске указывать не нужно; off — отменить):
#   TIMEZONE=Europe/Moscow      — часовой пояс компьютера;
#   NIGHT=22:00-06:00           — каждый день выключаться в 22:00 и самому включаться в 06:00;
#   BACKUP_DIR=/mnt/backup/beemes — каждый день класть копию базы и файлов в эту папку (на другом диске).
# TUNNEL=cloudflare (или 1) — то же через туннель Cloudflare (бесплатно, но в России Cloudflare замедляют:
# туннель с домашнего интернета может не подключиться, а сайт — не открываться у посетителей).

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
SBIN_DIR="${SBIN_DIR:-/usr/local/sbin}"
CADDY_DIR="${CADDY_DIR:-/etc/caddy}"
TURN_CONF="${TURN_CONF:-/etc/turnserver.conf}"
# Дополнительные домены, на которых beemes тоже открывается (например, старый адрес при переезде):
#   ALSO_DOMAINS="kbast.ru" bash -s -- beemes.ru …
ALSO_DOMAINS="${ALSO_DOMAINS:-}"
# Домашний сервер за туннелем (порты на роутере не нужны): tuna — Tuna, cloudflare (или 1) — Cloudflare.
TUNNEL="${TUNNEL:-0}"
case "$TUNNEL" in
  0|"") TUNNEL=0; HOMESRV=0 ;;
  1|cloudflare) TUNNEL=cloudflare; HOMESRV=1 ;;
  tuna) HOMESRV=1 ;;
  *) printf 'Ошибка: TUNNEL может быть tuna или cloudflare\n' >&2; exit 1 ;;
esac
# Дома свой сервер для звонков не поднять (нужны открытые порты) — звонки соединяются напрямую.
if [ "$HOMESRV" = 1 ]; then TURN="${TURN:-0}"; fi
# Сколько раз (по 3 секунды) ждать, пока сайт откроется через туннель Tuna.
TUNNEL_WAIT="${TUNNEL_WAIT:-40}"

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
if [ "$HOMESRV" != 1 ] && [ -f "$SCHOOL_UNIT" ] && ! grep -q -- "--http 127.0.0.1:" "$SCHOOL_UNIT"; then
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
# Настоящий адрес посетителя: у Cloudflare — заголовок CF-Connecting-IP, у Caddy — X-Forwarded-For,
# у Tuna сервер выясняет заголовок сам (auto, см. pb_hooks/main.pb.js).
case "$TUNNEL" in
  cloudflare) set_env PROXY_IP_HEADER "CF-Connecting-IP" ;;
  tuna) set_env PROXY_IP_HEADER "auto" ;;
  *) set_env PROXY_IP_HEADER "X-Forwarded-For" ;;
esac
if [ "$HOMESRV" = 1 ] && [ "${TURN:-0}" = 0 ]; then
  # Без своего сервера звонков — звонки соединяются напрямую (STUN).
  { grep -v -e '^TURN_HOST=' -e '^TURN_SECRET=' "$ENV_FILE" || true; } > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

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

# ---------- Домашний сервер: туннель вместо Caddy ----------
if [ "$HOMESRV" = 1 ]; then
  say "Защищаю домашний сервер"
  # Брандмауэр: всё входящее закрыто, SSH — только из домашней сети. Посетители приходят через туннель (исходящее соединение).
  apt-get install -y -qq ufw >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  for NET in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do ufw allow from "$NET" to any port 22 proto tcp >/dev/null; done
  ufw --force enable >/dev/null
  # Защита SSH от подбора пароля.
  apt-get install -y -qq fail2ban >/dev/null 2>&1 && systemctl enable --now fail2ban >/dev/null 2>&1 || true
  # Обновления безопасности ставятся сами.
  apt-get install -y -qq unattended-upgrades >/dev/null
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
  # Компьютер не засыпает (иначе мессенджер пропадёт, пока никто не трогает мышь).
  systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true

  if [ "$TUNNEL" = cloudflare ]; then
    say "Подключаю туннель Cloudflare"
    if ! command -v cloudflared >/dev/null 2>&1; then
      mkdir -p --mode=0755 /usr/share/keyrings
      curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
      echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
      apt-get update -qq
      apt-get install -y -qq cloudflared >/dev/null || fail "не получилось установить cloudflared"
    fi
    # Новые версии cloudflared тоже ставятся сами: старые Cloudflare со временем перестаёт пускать.
    printf 'Unattended-Upgrade::Origins-Pattern { "origin=cloudflared"; };\n' > /etc/apt/apt.conf.d/51beemes-cloudflared
    CF_BIN="$(command -v cloudflared)"
    CF_DIR="${CF_DIR:-/etc/cloudflared}"
    CF_TOKEN_FILE="$CF_DIR/token"
    CF_UNIT="$SYSTEMD_DIR/cloudflared.service"
    # Служба туннеля есть, и файл с токеном, на который она ссылается, на месте.
    cf_unit_ok() {
      [ -f "$CF_UNIT" ] || return 1
      local tf
      tf="$(grep -o -- '--token-file [^ ]*' "$CF_UNIT" | head -n1 | awk '{print $2}')"
      [ -z "$tf" ] || [ -s "$tf" ]
    }
    cf_ready() { systemctl is-enabled --quiet cloudflared 2>/dev/null && cf_unit_ok; }
    CF_TOKEN="${CF_TOKEN:-}"
    CF_NEW=0
    if [ -z "$CF_TOKEN" ] && cf_ready; then
      echo "  Туннель уже настроен."
    else
      # Спрашиваем, только если есть живой терминал (у автообновления его нет).
      if [ -z "$CF_TOKEN" ] && { : > /dev/tty; } 2>/dev/null; then
        printf '  Вставьте токен туннеля Cloudflare (на экране его не видно) и нажмите Enter:\n  ' > /dev/tty
        read -rs CF_TOKEN < /dev/tty || true
        echo > /dev/tty
      fi
      # Вставили всю команду «cloudflared service install …» — берём из неё только токен (последнее слово).
      CF_TOKEN="$(printf '%s' "$CF_TOKEN" | tr -s ' \t\r\n' ' ' | awk '{print $NF}')"
      if [ -z "$CF_TOKEN" ]; then
        echo "  Токен не введён — туннель не подключён. Запустите установку ещё раз, когда будет токен."
      elif ! [[ "$CF_TOKEN" =~ ^eyJ[A-Za-z0-9+/=_-]{20,}$ ]]; then
        echo "  Это не похоже на токен туннеля: он начинается с eyJ и написан одной длинной строкой."
        echo "  Скопируйте строку «sudo cloudflared service install eyJ…» со страницы туннеля и запустите установку ещё раз."
      else
        # Своя служба вместо «cloudflared service install»: та ждёт подключения всего 15 секунд, а из России оно бывает
        # дольше — тогда установка считается неудачной и токен стирается.
        mkdir -p "$CF_DIR"
        ( umask 077; printf '%s' "$CF_TOKEN" > "$CF_TOKEN_FILE" )
        chmod 600 "$CF_TOKEN_FILE"
        systemctl disable --now cloudflared-update.timer >/dev/null 2>&1 || true
        rm -f "$SYSTEMD_DIR/cloudflared-update.timer" "$SYSTEMD_DIR/cloudflared-update.service"
        printf '%s\n' '[Unit]' 'Description=Туннель Cloudflare' 'After=network-online.target' 'Wants=network-online.target' '' \
          '[Service]' 'Type=notify' "ExecStart=$CF_BIN --no-autoupdate tunnel run --token-file $CF_TOKEN_FILE" '' \
          '[Install]' 'WantedBy=multi-user.target' > "$CF_UNIT"
        CF_NEW=1
      fi
    fi
    unset CF_TOKEN
    if cf_unit_ok; then
      # Подключение из России бывает долгим, а при обрыве туннель должен подниматься сам — и так всегда.
      mkdir -p "$CF_UNIT.d"
      printf '%s\n' '[Service]' 'TimeoutStartSec=5min' 'Restart=always' 'RestartSec=10s' > "$CF_UNIT.d/10-beemes.conf"
      systemctl daemon-reload
      systemctl enable cloudflared >/dev/null 2>&1 || true
      if [ "$CF_NEW" = 1 ] || ! systemctl is-active --quiet cloudflared; then systemctl restart --no-block cloudflared; fi
      printf '  Жду подключения туннеля'
      for _ in $(seq 1 60); do systemctl is-active --quiet cloudflared && break; printf '.'; sleep 2; done
      echo
      if systemctl is-active --quiet cloudflared; then
        echo "  Туннель подключён."
      else
        printf '\033[1;33m  Туннель пока не подключился, но будет пробовать сам. Проверить: systemctl status cloudflared\033[0m\n'
        echo "  Последние строки журнала туннеля:"
        journalctl -u cloudflared -n 12 --no-pager -o cat 2>/dev/null | sed 's/^/    /' || true
      fi
    fi
  else
    say "Подключаю туннель Tuna"
    # Туннель Cloudflare от прошлой установки больше не нужен.
    if [ -f "$SYSTEMD_DIR/cloudflared.service" ] || command -v cloudflared >/dev/null 2>&1; then
      systemctl disable --now cloudflared cloudflared-update.timer >/dev/null 2>&1 || true
      rm -rf "$SYSTEMD_DIR/cloudflared.service" "$SYSTEMD_DIR/cloudflared.service.d" \
        "$SYSTEMD_DIR/cloudflared-update.service" "$SYSTEMD_DIR/cloudflared-update.timer" \
        "${CF_DIR:-/etc/cloudflared}/token" /etc/apt/apt.conf.d/51beemes-cloudflared
      apt-get remove -y -qq cloudflared >/dev/null 2>&1 || true
      rm -f /etc/apt/sources.list.d/cloudflared.list
      echo "  Туннель Cloudflare отключён и удалён."
    fi
    if ! command -v tuna >/dev/null 2>&1; then
      TUNA_REPO="https://code.tuna.am/api/packages/tuna/debian"
      mkdir -p --mode=0755 /usr/share/keyrings
      curl -fsSL "$TUNA_REPO/repository.key" -o /usr/share/keyrings/tuna-forgejo.asc || true
      echo "deb [signed-by=/usr/share/keyrings/tuna-forgejo.asc] $TUNA_REPO stable main" > /etc/apt/sources.list.d/tuna-forgejo.list
      apt-get update -qq >/dev/null 2>&1 || true
      apt-get install -y -qq tuna-cli >/dev/null 2>&1 || true
      if ! command -v tuna >/dev/null 2>&1; then
        # Не вышло через apt (новые системы бывают строже к чужим репозиториям) — ставим тот же пакет напрямую,
        # сверяя контрольную сумму со списком пакетов Tuna.
        rm -f /etc/apt/sources.list.d/tuna-forgejo.list
        TUNA_PKG="$(curl -fsSL "$TUNA_REPO/dists/stable/main/binary-$(dpkg --print-architecture)/Packages" | awk -v RS= '
          /(^|\n)Package: tuna-cli(\n|$)/ { v = f = h = ""; n = split($0, L, "\n")
            for (i = 1; i <= n; i++) { if (L[i] ~ /^Version: /) v = substr(L[i], 10); if (L[i] ~ /^Filename: /) f = substr(L[i], 11); if (L[i] ~ /^SHA256: /) h = substr(L[i], 9) }
            if (v != "" && f != "" && h != "") print v, f, h }' | sort -V | tail -n1 || true)"
        TUNA_FILE="$(printf '%s' "$TUNA_PKG" | awk '{print $2}')"
        TUNA_SUM="$(printf '%s' "$TUNA_PKG" | awk '{print $3}')"
        [ -n "$TUNA_FILE" ] && [ -n "$TUNA_SUM" ] || fail "не получилось найти пакет программы Tuna (tuna-cli)"
        TUNA_DEB="$(mktemp --suffix=.deb)"
        curl -fsSL "$TUNA_REPO/$TUNA_FILE" -o "$TUNA_DEB" || fail "не получилось скачать программу Tuna"
        echo "$TUNA_SUM  $TUNA_DEB" | sha256sum -c --status - || fail "пакет программы Tuna повреждён (не сошлась контрольная сумма)"
        dpkg -i "$TUNA_DEB" >/dev/null || fail "не получилось установить программу Tuna (tuna-cli)"
        rm -f "$TUNA_DEB"
      fi
    fi
    # Новые версии программы Tuna ставятся вместе с обновлениями безопасности.
    printf 'Unattended-Upgrade::Origins-Pattern { "origin=Tuna Code"; };\n' > /etc/apt/apt.conf.d/51beemes-tuna
    TUNA_BIN="$(command -v tuna)"
    TUNA_ENV="$DIR/tuna.env"
    TUNA_KEY="${TUNA_API_KEY:-}"
    TUNA_NEW=0
    TUNA_BAD=0
    # Спрашиваем ключ, только если его ещё нет и есть живой терминал (у автообновления его нет).
    if [ -z "$TUNA_KEY" ] && [ ! -s "$TUNA_ENV" ] && { : > /dev/tty; } 2>/dev/null; then
      printf '  Вставьте ключ Tuna (my.tuna.am → API-ключи; на экране его не видно) и нажмите Enter:\n  ' > /dev/tty
      read -rs TUNA_KEY < /dev/tty || true
      echo > /dev/tty
    fi
    TUNA_KEY="$(printf '%s' "$TUNA_KEY" | tr -s ' \t\r\n' ' ' | awk '{print $NF}')"
    if [ -n "$TUNA_KEY" ]; then
      if [[ "$TUNA_KEY" =~ ^[A-Za-z0-9._~+/=-]{16,}$ ]]; then
        # Ключ лежит в файле, который видит только root; программе Tuna его передаёт systemd.
        ( umask 077; printf 'TUNA_API_KEY=%s\n' "$TUNA_KEY" > "$TUNA_ENV" )
        chmod 600 "$TUNA_ENV"
        TUNA_NEW=1
      else
        TUNA_BAD=1
        echo "  Это не похоже на ключ Tuna: он написан одной строкой без пробелов. Скопируйте его ещё раз со страницы"
        echo "  my.tuna.am → API-ключи и запустите установку снова."
      fi
    fi
    unset TUNA_KEY
    # Адрес — основной. WWW=1 — ещё и www (ведёт на основной); его тоже нужно добавить в my.tuna.am → Домены.
    TUNA_HOSTS="$DOMAIN"
    if [ "${WWW:-0}" = 1 ] && [ "$(printf '%s' "$DOMAIN" | tr -cd '.' | wc -c)" = 1 ]; then TUNA_HOSTS="$DOMAIN www.$DOMAIN"; fi
    TUNA_UNITS=""
    if [ -s "$TUNA_ENV" ]; then
      for H in $TUNA_HOSTS; do
        U="beemes-tuna"; [ "$H" = "$DOMAIN" ] || U="beemes-tuna-www"
        TUNA_UNITS="$TUNA_UNITS $U"
        # Программа Tuna работает под отдельным пользователем без прав: ей нужен только выход в интернет и доступ
        # к beemes на этом же компьютере.
        printf '%s\n' '[Unit]' "Description=Туннель Tuna: $H" 'After=network-online.target beemes.service' 'Wants=network-online.target' '' \
          '[Service]' "EnvironmentFile=$TUNA_ENV" "Environment=HOME=/var/lib/$U" \
          "ExecStart=$TUNA_BIN http $PORT --domain=$H --inspect=false" \
          'Restart=always' 'RestartSec=15' 'DynamicUser=yes' "StateDirectory=$U" 'NoNewPrivileges=yes' 'ProtectHome=yes' \
          'PrivateDevices=yes' 'ProtectKernelTunables=yes' 'ProtectControlGroups=yes' '' \
          '[Install]' 'WantedBy=multi-user.target' > "$SYSTEMD_DIR/$U.service.new"
        if ! cmp -s "$SYSTEMD_DIR/$U.service.new" "$SYSTEMD_DIR/$U.service" 2>/dev/null; then TUNA_NEW=1; fi
        mv "$SYSTEMD_DIR/$U.service.new" "$SYSTEMD_DIR/$U.service"
      done
      systemctl daemon-reload
      for U in $TUNA_UNITS; do
        systemctl enable "$U" >/dev/null 2>&1 || true
        if [ "$TUNA_NEW" = 1 ] || ! systemctl is-active --quiet "$U"; then systemctl restart --no-block "$U"; fi
      done
      # Служба для www осталась от прошлой установки, а www больше не нужен — убираем.
      case " $TUNA_UNITS " in *" beemes-tuna-www "*) ;; *)
        if [ -f "$SYSTEMD_DIR/beemes-tuna-www.service" ]; then
          systemctl disable --now beemes-tuna-www >/dev/null 2>&1 || true
          rm -f "$SYSTEMD_DIR/beemes-tuna-www.service"
          systemctl daemon-reload
        fi ;;
      esac
      printf '  Жду, когда https://%s откроется через Tuna' "$DOMAIN_INPUT"
      TUNA_OK=0
      for _ in $(seq 1 "$TUNNEL_WAIT"); do
        if curl -fsS -m 8 "https://$DOMAIN/api/health" 2>/dev/null | grep -q 'API is healthy'; then TUNA_OK=1; break; fi
        printf '.'; sleep 3
      done
      echo
      if [ "$TUNA_OK" = 1 ]; then
        echo "  Готово: https://$DOMAIN_INPUT открывается через Tuna."
      else
        printf '\033[1;33m  Пока не открывается. Туннель будет пробовать сам; чаще всего Tuna ещё проверяет домен (до 2 часов).\033[0m\n'
        echo "  Проверьте в кабинете my.tuna.am → Домены, что $DOMAIN подтверждён. Последние строки журнала туннеля:"
        journalctl -u beemes-tuna -n 12 --no-pager -o cat 2>/dev/null | sed 's/^/    /' || true
      fi
    elif [ "$TUNA_BAD" = 0 ]; then
      echo "  Ключ не введён — туннель не подключён. Запустите установку ещё раз, когда будет ключ."
    fi
  fi

  # Автообновление: сервер сам раз в 15 минут смотрит на GitHub и ставит новое (входящие соединения не нужны).
  {
    echo '#!/usr/bin/env bash'
    echo '# Автообновление beemes с GitHub (создано server/install.sh).'
    echo 'set -euo pipefail'
    echo "SHA=\"\$(curl -fsSL -H 'Accept: application/vnd.github.sha' https://api.github.com/repos/$REPO/commits/$BRANCH)\""
    echo '[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || exit 0'
    echo "[ \"\$(cat $DIR/.ref 2>/dev/null || true)\" = \"\$SHA\" ] && exit 0"
    echo "curl -fsSL \"https://raw.githubusercontent.com/$REPO/\$SHA/server/install.sh\" | REF=\"\$SHA\" TUNNEL=$TUNNEL WWW=${WWW:-0} bash -s -- $DOMAIN"
  } > "$SBIN_DIR/beemes-autoupdate"
  chmod 755 "$SBIN_DIR/beemes-autoupdate"
  printf '%s\n' '[Unit]' 'Description=Автообновление beemes с GitHub' 'After=network-online.target' 'Wants=network-online.target' '' \
    '[Service]' 'Type=oneshot' "ExecStart=$SBIN_DIR/beemes-autoupdate" > "$SYSTEMD_DIR/beemes-autoupdate.service"
  printf '%s\n' '[Unit]' 'Description=Раз в 15 минут — проверить обновления beemes' '' \
    '[Timer]' 'OnBootSec=5min' 'OnUnitActiveSec=15min' '' '[Install]' 'WantedBy=timers.target' > "$SYSTEMD_DIR/beemes-autoupdate.timer"
  # Какая версия стоит (по ней автообновление понимает, есть ли новое).
  if [ -z "$REF" ]; then
    REF="$(curl -fsSL -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/$BRANCH" 2>/dev/null || true)"
    [[ "$REF" =~ ^[0-9a-f]{40}$ ]] || REF=""
  fi
  if [ -n "$REF" ]; then echo "$REF" > "$DIR/.ref"; fi
  systemctl daemon-reload
  systemctl enable --now beemes-autoupdate.timer >/dev/null 2>&1 || true

  # ---------- Часовой пояс, выключение на ночь, резервные копии ----------
  # Расписание и папка для копий запоминаются в home.conf: при автообновлении их указывать заново не нужно.
  HOME_CONF="$DIR/home.conf"
  conf_get() { { grep -m1 "^$1=" "$HOME_CONF" 2>/dev/null || true; } | cut -d= -f2-; }
  if [ -n "${TIMEZONE:-}" ]; then
    timedatectl set-timezone "$TIMEZONE" || fail "не получилось поставить часовой пояс $TIMEZONE (пример: Europe/Moscow)"
  fi
  if [ -z "${NIGHT+x}" ]; then NIGHT="$(conf_get NIGHT)"; fi
  if [ -z "${BACKUP_DIR+x}" ]; then BACKUP_DIR="$(conf_get BACKUP_DIR)"; fi
  NIGHT="$(printf '%s' "$NIGHT" | tr -d ' ')"
  case "$NIGHT" in off|0|no) NIGHT="" ;; esac
  case "$BACKUP_DIR" in off|0|no) BACKUP_DIR="" ;; esac
  NIGHT_OFF=""; NIGHT_ON=""
  if [ -n "$NIGHT" ]; then
    [[ "$NIGHT" =~ ^([01]?[0-9]|2[0-3]):([0-5][0-9])-([01]?[0-9]|2[0-3]):([0-5][0-9])$ ]] \
      || fail "расписание пишется так: NIGHT=22:00-06:00 (когда выключаться — когда включаться)"
    NIGHT_OFF="$(printf '%02d:%s' "$((10#${BASH_REMATCH[1]}))" "${BASH_REMATCH[2]}")"
    NIGHT_ON="$(printf '%02d:%s' "$((10#${BASH_REMATCH[3]}))" "${BASH_REMATCH[4]}")"
    [ "$NIGHT_OFF" != "$NIGHT_ON" ] || fail "время выключения и включения совпадает"
    NIGHT="$NIGHT_OFF-$NIGHT_ON"
  fi
  if [ -n "$BACKUP_DIR" ]; then
    [[ "$BACKUP_DIR" =~ ^/[A-Za-z0-9/._-]+$ ]] || fail "BACKUP_DIR — полный путь к папке латинскими буквами, например /mnt/backup/beemes"
    BACKUP_DIR="${BACKUP_DIR%/}"
  fi
  printf 'NIGHT=%s\nBACKUP_DIR=%s\n' "$NIGHT" "$BACKUP_DIR" > "$HOME_CONF"

  # Резервная копия: beemes на минуту останавливается, база и файлы складываются в один архив.
  BACKUP_SAME_DISK=0
  if [ -n "$BACKUP_DIR" ]; then
    mkdir -p "$BACKUP_DIR"
    chmod 700 "$BACKUP_DIR"
    # Копии должны лежать на другом диске. Если сейчас так и есть — без этого диска копия писаться не будет
    # (иначе при отвалившемся диске она молча заняла бы место на системном).
    if [ "$(stat -c %d "$BACKUP_DIR")" = "$(stat -c %d "$DIR")" ]; then BACKUP_SAME_DISK=1; fi
    {
      echo '#!/usr/bin/env bash'
      echo '# Резервная копия beemes: база и файлы (создано server/install.sh). NOSTART=1 — не запускать beemes после копии.'
      echo 'set -euo pipefail'
      echo "DIR=\"$DIR\"; DEST=\"$BACKUP_DIR\"; KEEP=${BACKUP_KEEP:-14}; OTHER_DISK=$((1 - BACKUP_SAME_DISK))"
      cat <<'BKP'
if [ "$OTHER_DISK" = 1 ] && { [ ! -d "$DEST" ] || [ "$(stat -c %d "$DEST")" = "$(stat -c %d "$DIR")" ]; }; then
  echo "Диск для копий не подключён ($DEST) — копия не сделана." >&2
  exit 1
fi
mkdir -p "$DEST"
chmod 700 "$DEST"
NAME="beemes-$(date +%Y-%m-%d_%H%M).tar.gz"
WAS=0
if systemctl is-active --quiet beemes; then WAS=1; systemctl stop beemes; fi
restart() { if [ "$WAS" = 1 ] && [ "${NOSTART:-0}" != 1 ]; then systemctl start beemes; fi; }
trap restart EXIT
find "$DEST" -maxdepth 1 -name '.beemes-*.part' -delete
tar --use-compress-program='gzip -1' --exclude='pb_data/backups' -cf "$DEST/.$NAME.part" -C "$DIR" pb_data server.env
mv "$DEST/.$NAME.part" "$DEST/$NAME"
# Храним только последние копии.
ls -1t "$DEST"/beemes-*.tar.gz | tail -n +"$((KEEP + 1))" | while read -r OLD; do rm -f -- "$OLD"; done
echo "Копия готова: $DEST/$NAME ($(du -h "$DEST/$NAME" | cut -f1))"
BKP
    } > "$SBIN_DIR/beemes-backup"
    chmod 755 "$SBIN_DIR/beemes-backup"
    printf '%s\n' '[Unit]' 'Description=Резервная копия beemes' '' \
      '[Service]' 'Type=oneshot' "ExecStart=$SBIN_DIR/beemes-backup" > "$SYSTEMD_DIR/beemes-backup.service"
    printf '%s\n' '[Unit]' 'Description=Каждую ночь — резервная копия beemes' '' \
      '[Timer]' 'OnCalendar=*-*-* 04:00:00' '' '[Install]' 'WantedBy=timers.target' > "$SYSTEMD_DIR/beemes-backup.timer"
  else
    systemctl disable --now beemes-backup.timer >/dev/null 2>&1 || true
    rm -f "$SBIN_DIR/beemes-backup" "$SYSTEMD_DIR/beemes-backup.service" "$SYSTEMD_DIR/beemes-backup.timer"
  fi

  # На ночь: копия, выключение, а утром компьютер включают его же часы (будильник RTC).
  NIGHT_READY=0
  if [ -n "$NIGHT" ]; then
    command -v rtcwake >/dev/null 2>&1 || apt-get install -y -qq util-linux-extra >/dev/null 2>&1 || true
    if command -v rtcwake >/dev/null 2>&1; then
      NIGHT_READY=1
      {
        echo '#!/usr/bin/env bash'
        echo '# На ночь: резервная копия, затем выключение с будильником на утро (создано server/install.sh).'
        echo 'set -uo pipefail'
        echo "WAKE=\"$NIGHT_ON\"; BACKUP=\"$SBIN_DIR/beemes-backup\""
        cat <<'NGT'
if [ -x "$BACKUP" ]; then NOSTART=1 "$BACKUP" || echo "Резервная копия не сделана." >&2; fi
T="$(date -d "today $WAKE" +%s)"
if [ "$T" -le "$(( $(date +%s) + 300 ))" ]; then T="$(date -d "tomorrow $WAKE" +%s)"; fi
# Выключаемся и просим часы компьютера включить его утром. Не вышло — остаёмся работать.
if ! rtcwake -m off -t "$T"; then
  echo "Не получилось поставить будильник на включение — компьютер остаётся включённым." >&2
  systemctl start beemes
  exit 1
fi
NGT
      } > "$SBIN_DIR/beemes-night"
      chmod 755 "$SBIN_DIR/beemes-night"
      printf '%s\n' '[Unit]' 'Description=beemes: копия и выключение на ночь' '' \
        '[Service]' 'Type=oneshot' "ExecStart=$SBIN_DIR/beemes-night" > "$SYSTEMD_DIR/beemes-night.service"
      printf '%s\n' '[Unit]' "Description=Каждый день в $NIGHT_OFF — выключение на ночь" '' \
        '[Timer]' "OnCalendar=*-*-* $NIGHT_OFF:00" '' '[Install]' 'WantedBy=timers.target' > "$SYSTEMD_DIR/beemes-night.timer"
    fi
  fi
  if [ "$NIGHT_READY" = 0 ]; then
    systemctl disable --now beemes-night.timer >/dev/null 2>&1 || true
    rm -f "$SBIN_DIR/beemes-night" "$SYSTEMD_DIR/beemes-night.service" "$SYSTEMD_DIR/beemes-night.timer"
  fi
  systemctl daemon-reload
  if [ "$NIGHT_READY" = 1 ]; then systemctl enable --now beemes-night.timer >/dev/null 2>&1 || true; fi
  if [ -n "$BACKUP_DIR" ]; then
    # Копия делается перед выключением на ночь, а без расписания — в 04:00.
    if [ "$NIGHT_READY" = 1 ]; then systemctl disable --now beemes-backup.timer >/dev/null 2>&1 || true
    else systemctl enable --now beemes-backup.timer >/dev/null 2>&1 || true; fi
  fi

  say "Готово! beemes работает на этом компьютере и будет запускаться сам."
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/health"; then echo "  Проверка: beemes отвечает (http://127.0.0.1:$PORT)."; else echo "  beemes пока не отвечает: journalctl -u beemes -n 50"; fi
  if [ "$TUNNEL" = cloudflare ]; then
    echo "  Чтобы beemes открывался по адресу https://$DOMAIN_INPUT/ — в Cloudflare: Networking → Tunnels → ваш туннель →"
    echo "  Routes → Add route → Published application: $DOMAIN и www.$DOMAIN → Service URL: http://localhost:$PORT"
    echo "  Панель администратора: https://$DOMAIN_INPUT/_/   ·   журнал: journalctl -u beemes -f   ·   туннель: systemctl status cloudflared"
  else
    echo "  Адрес: https://$DOMAIN_INPUT/ — в my.tuna.am → Домены должны быть добавлены и подтверждены: $TUNA_HOSTS."
    echo "  Панель администратора: https://$DOMAIN_INPUT/_/   ·   журнал: journalctl -u beemes -f   ·   туннель: journalctl -u beemes-tuna -f"
  fi
  if [ -z "$ADMIN_EMAIL" ] && [ "$FRESH_INSTALL" = 1 ]; then
    echo "  Администратора создайте командой: $DIR/pocketbase superuser upsert ПОЧТА ПАРОЛЬ --dir $DIR/pb_data"
  fi
  echo "  Уведомления: в панели администратора откройте bm_settings и вставьте ключ сервисного аккаунта Firebase."
  HOME_TZ="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
  if [ "$NIGHT_READY" = 1 ]; then
    echo "  На ночь: выключение в $NIGHT_OFF, включение в $NIGHT_ON (часовой пояс ${HOME_TZ:-не определён}). Проверьте, что компьютер"
    echo "  умеет включаться сам: sudo rtcwake -m off -s 180 — он выключится и через 3 минуты должен включиться."
  elif [ -n "$NIGHT" ]; then
    printf '\033[1;33m  Расписание на ночь не включено: на этом компьютере нет программы rtcwake.\033[0m\n'
  fi
  if [ -n "$BACKUP_DIR" ]; then
    if [ "$NIGHT_READY" = 1 ]; then BACKUP_WHEN="перед выключением на ночь"; else BACKUP_WHEN="в 04:00"; fi
    echo "  Копии: $BACKUP_DIR, каждый день $BACKUP_WHEN, хранятся последние ${BACKUP_KEEP:-14}. Сделать сейчас: sudo beemes-backup"
    if [ "$BACKUP_SAME_DISK" = 1 ]; then
      printf '\033[1;33m  Папка для копий — на том же диске, что и beemes: при поломке диска копии пропадут вместе с базой.\033[0m\n'
    fi
  fi
  exit 0
fi

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
