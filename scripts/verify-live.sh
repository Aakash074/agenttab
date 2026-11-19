#!/usr/bin/env bash
# Post-deploy check: the live web bundle must carry the mandatory BLAZE banner links
# (Widget Factory deck, source repo, EMBER2026 z-address) and both API URLs.
set -euo pipefail
B=${1:-https://agenttab-wihk.onrender.com}
JS=$(for js in $(curl -s -m 60 "$B/" | grep -oE '/assets/[^"]+\.js'); do
  curl -s -m 60 "$B$js"
  for c in $(curl -s -m 60 "$B$js" | grep -oE '[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.js' | sort -u); do curl -s -m 60 "$B/assets/$c"; done
done)
fail=0
for need in 'docs.google.com/presentation/d/' 'github.com/Aakash074/agenttab' 'bitcoincash:zqcgm29z05erjdk440n6pj2vwmc8x5gxzcnwfnnrul' 'agenttab-api-mainnet.onrender.com' 'agenttab-api-chipnet.onrender.com'; do
  if grep -qF "$need" <<<"$JS"; then echo "ok   $need"; else echo "MISSING $need"; fail=1; fi
done
exit $fail
