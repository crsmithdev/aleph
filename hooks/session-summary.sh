#!/bin/bash
CPAI_DIR="${HOME}/.claude"
SESSIONS="${CPAI_DIR}/memory/sessions"
mkdir -p "$SESSIONS"

INPUT=$(cat)
MSG_COUNT=$(echo "$INPUT" | python3 -c "
import sys,json
try: d=json.load(sys.stdin); print(len(d.get('messages',[])))
except: print(0)
" 2>/dev/null)

[ "${MSG_COUNT:-0}" -lt 4 ] && exit 0

DATE=$(date -u +"%Y-%m-%d")
FILE="${SESSIONS}/${DATE}-$(date -u +%H%M%S).md"

cat <<EOF
[CPAI:SESSION-SUMMARY] Write a session summary. Create the file ${FILE} with this format:

# Session: ${DATE}

- [bullet 1: what was done]
- [bullet 2: what was decided or discovered]
- [bullet 3: what's next or unresolved]

Exactly 3 bullets. Past tense for completed work. Be specific — name files, features, bugs.
Message count this session: ${MSG_COUNT}
EOF
