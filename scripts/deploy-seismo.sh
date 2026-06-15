#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-root@seismo.live}"
SUBPATH="${DEPLOY_SUBPATH:-modell4}"
BASE_PATH="/${SUBPATH}/"
TARGET="${DEPLOY_TARGET:-/var/www/seismo/${SUBPATH}}"

echo "→ Build für ${BASE_PATH} …"
cd "$ROOT"
VITE_BASE_PATH="${BASE_PATH}" npm run build

if [[ -f dist/.htaccess ]]; then
  perl -pi -e "s|RewriteBase /modell3/|RewriteBase ${BASE_PATH}|g" dist/.htaccess dist/htaccess-upload.txt 2>/dev/null || true
fi

echo "→ Upload nach ${HOST}:${TARGET} …"
rsync -avz --delete dist/ "${HOST}:${TARGET}/"

echo "→ Rechte setzen …"
ssh "$HOST" "chown -R www-data:www-data ${TARGET} && \
  find ${TARGET} -type d -exec chmod 755 {} \; && \
  find ${TARGET} -type f -exec chmod 644 {} \; && \
  chmod 775 ${TARGET}/scenarios && \
  chmod 640 ${TARGET}/api/config.local.php 2>/dev/null || true"

echo "✓ Deploy fertig: https://seismo.live${BASE_PATH}"
