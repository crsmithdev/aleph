#!/bin/bash
CONSTRUCT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RATINGS="${CONSTRUCT_DIR}/memory/signals/ratings.jsonl"
mkdir -p "$(dirname "$RATINGS")"

# Extract prompt and match rating in one python3 call.
# Matches: standalone 1-10, N/10 pattern, or "rate"/"rating" near a number.
RESULT=$(python3 -c "
import re, sys, json
try: msg = json.load(sys.stdin).get('prompt','').strip()
except: sys.exit()
if not msg: sys.exit()
rating = None
if re.match(r'^(10|[1-9])$', msg):
    rating = msg
else:
    m = re.search(r'\b(10|[1-9])\s*/\s*10\b', msg)
    if m: rating = m.group(1)
    elif re.search(r'\brat(e|ing)\b', msg, re.I):
        m = re.search(r'\b(10|[1-9])\b', msg)
        if m: rating = m.group(1)
if rating:
    ctx = msg[:100].replace('\"', \"'\")
    print(f'{rating}\t{ctx}')
" 2>/dev/null)

if [ -n "$RESULT" ]; then
  RATING=$(echo "$RESULT" | cut -f1)
  CTX=$(echo "$RESULT" | cut -f2)
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "{\"timestamp\":\"${TS}\",\"rating\":${RATING},\"type\":\"explicit\",\"context\":\"${CTX}\"}" >> "$RATINGS"
  [ "$RATING" -le 3 ] && echo "[Construct] Low rating (${RATING}) — note what went wrong in LEARNED.md"
fi
