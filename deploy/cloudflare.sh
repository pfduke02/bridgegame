#!/usr/bin/env bash
# Publishes the app in docs/ (page, offline worker, manifest, icons) as a Cloudflare Worker on your workers.dev address.
#   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... deploy/cloudflare.sh [worker-name]
# The token needs the "Workers Scripts: Edit" permission for the account.
# Each module is named by its upload filename, which must match the import in deploy/worker.js.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:-bridgegame}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
AUTH="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
ok() { python3 -c "import sys,json; d=json.load(sys.stdin); print('  ok' if d.get('success') else '  FAILED: ' + json.dumps(d.get('errors'))); sys.exit(0 if d.get('success') else 1)"; }

node build.js
echo "Uploading worker '${NAME}'"
curl -sS -X PUT "${API}/workers/scripts/${NAME}" -H "${AUTH}" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2025-09-01"};type=application/json' \
  -F 'worker.js=@deploy/worker.js;type=application/javascript+module' \
  -F 'index.txt=@docs/index.html;type=text/plain;filename=index.txt' \
  -F 'sw.txt=@docs/sw.js;type=text/plain;filename=sw.txt' \
  -F 'manifest.txt=@docs/manifest.webmanifest;type=text/plain;filename=manifest.txt' \
  -F 'icon-180.bin=@docs/icon-180.png;type=application/octet-stream;filename=icon-180.bin' \
  -F 'icon-192.bin=@docs/icon-192.png;type=application/octet-stream;filename=icon-192.bin' \
  -F 'icon-512.bin=@docs/icon-512.png;type=application/octet-stream;filename=icon-512.bin' | ok
echo "Turning on its workers.dev address"
curl -sS -X POST "${API}/workers/scripts/${NAME}/subdomain" -H "${AUTH}" -H 'Content-Type: application/json' \
  --data '{"enabled":true,"previews_enabled":false}' | ok
SUB=$(curl -sS "${API}/workers/subdomain" -H "${AUTH}" | python3 -c "import sys,json; print((json.load(sys.stdin).get('result') or {}).get('subdomain') or '')")
echo "Published: https://${NAME}.${SUB}.workers.dev/"
