#!/usr/bin/env bash
#
# The dev server, reachable from a phone, over https.
#
# Two things make testing on a real device awkward, and this answers both.
# A public network usually isolates its clients, so the phone cannot reach the
# Mac's address at all; and the barcode scanner needs a secure context, so even
# a reachable http:// address gets no camera (see components/stock/
# barcode-scanner.tsx, which now says so rather than blaming the permission).
#
# A Cloudflare quick tunnel dials *out* from this machine and hands back an
# https URL, so neither the router nor the certificate is our problem. The
# hostname is random per run and the tunnel dies with this script.
#
# What goes over it is real: receipts, members' names, bank rows. It is a
# public URL for as long as it is up — unguessable, but public. Stop it when
# you are done.
set -euo pipefail

PORT="${PORT:-3000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed. Run: brew install cloudflared" >&2
  exit 1
fi

pnpm exec next dev --port "$PORT" &
dev=$!

# One trap for every way out, so Ctrl-C does not leave a dev server running
# without the tunnel that was the point of starting it this way.
cleanup() { kill "$dev" 2>/dev/null || true; }
trap cleanup INT TERM EXIT

# The tunnel refuses a port nothing is listening on, and Next takes a moment.
# `-f` fails on 4xx/5xx only, and the dev server answers / with a 307, so this
# waits for "answering" rather than for any particular page.
printf 'waiting for next dev on :%s' "$PORT"
until curl -sf -o /dev/null "http://127.0.0.1:${PORT}"; do
  kill -0 "$dev" 2>/dev/null || { echo; echo "next dev exited" >&2; exit 1; }
  printf '.'
  sleep 0.5
done
echo

cloudflared tunnel --url "http://localhost:${PORT}"
