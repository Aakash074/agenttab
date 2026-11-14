#!/usr/bin/env bash
# Local/VM supervisor: keeps the API up across crashes and restarts (`kill <node pid>` = quick restart).
# Usage: scripts/serve.sh   (env as for packages/server/src/main.ts)
cd "$(dirname "$0")/.."
while true; do
  node packages/server/src/main.ts
  echo "[serve.sh] server exited ($?); restarting in 1 s" >&2
  sleep 1
done
