#!/bin/bash
CONSTRUCT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RATINGS="${CONSTRUCT_DIR}/memory/signals/ratings.jsonl"
mkdir -p "$(dirname "$RATINGS")"

# Extract last user message, skip if it's an explicit rating or too short.
# Single python3 call handles extraction + filtering.
MSG=$(python3 -c "
import re, sys, json
try:
    d = json.load(sys.stdin)
    msgs = [m['content'] for m in d.get('messages',[]) if m.get('role')=='user']
    if not msgs: sys.exit()
    msg = msgs[-1].strip()
    if not msg or len(msg.split()) < 4: sys.exit()
    if re.match(r'^(10|[1-9])$', msg): sys.exit()
    if re.search(r'\b(10|[1-9])\s*/\s*10\b', msg): sys.exit()
    print(msg)
except: pass
" 2>/dev/null)

[ -z "$MSG" ] && exit 0

cat <<EOF
[Construct:SENTIMENT] Rate the user's satisfaction with this session on a scale of 1-10 based on their last message. Reply with ONLY a JSON line in this exact format, nothing else:
{"timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","rating":N,"type":"implicit","context":"LAST_MSG_SUMMARY"}

Append that line to: ${RATINGS}
Last user message: $(echo "$MSG" | head -c 200)

If you cannot determine satisfaction, do nothing.
EOF
