#!/usr/bin/env bash
# Publishes the app in docs/ (page, offline worker, manifest, icons) as a Cloudflare Worker on your
# workers.dev address, then checks that the live site serves this build.
#   CLOUDFLARE_API_TOKEN=... deploy/cloudflare.sh [worker-name]
# The token needs the "Workers Scripts: Edit" permission (Cloudflare's "Edit Cloudflare Workers" template).
# CLOUDFLARE_ACCOUNT_ID is optional when the token can see only one account.
# Each module is named by its upload filename, which must match the import in deploy/worker.js.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:-bridgegame}"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
AUTH="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
ok() { python3 -c "import sys,json; d=json.load(sys.stdin); print('  ok' if d.get('success') else '  FAILED: ' + json.dumps(d.get('errors'))); sys.exit(0 if d.get('success') else 1)"; }

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(curl -sS "https://api.cloudflare.com/client/v4/accounts?per_page=5" -H "${AUTH}" | python3 -c "
import sys, json
d = json.load(sys.stdin); r = d.get('result') or []
if not d.get('success') or len(r) != 1:
    sys.exit('Set CLOUDFLARE_ACCOUNT_ID: the token sees %d accounts' % len(r))
print(r[0]['id'])")
fi
API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"

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
URL="https://${NAME}.${SUB}.workers.dev/"
echo "Published: ${URL}"

# the new version can take a few seconds to reach every Cloudflare location
TMP=$(mktemp)
for i in $(seq 1 12); do
  if curl -fsS -m 20 "${URL}" -o "${TMP}" && cmp -s "${TMP}" docs/index.html && curl -fsS -m 20 "${URL}sw.js" | cmp -s - docs/sw.js; then
    echo "Live site serves this build."
    rm -f "${TMP}"
    exit 0
  fi
  sleep 5
done
rm -f "${TMP}"
echo "The live site is not serving this build yet." >&2
exit 1
