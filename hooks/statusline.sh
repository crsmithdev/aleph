#!/bin/bash
# Parse JSON input and build the bar in one python3 call.
# Tab-delimited output avoids splitting on spaces in model names (e.g. "Sonnet 4.6").
IFS=$'\t' read -r MODEL CWD PCT BAR <<< $(cat | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    model=d.get('model',{}).get('display_name','?')
    cwd=d.get('cwd',d.get('workspace',{}).get('current_dir','?'))
    pct=int(float(d.get('context_window',{}).get('used_percentage',0)))
    f=pct//10; bar='█'*f+'░'*(10-f)
    print(f'{model}\t{cwd}\t{pct}\t{bar}')
except: print('?\t?\t0\t░░░░░░░░░░')
" 2>/dev/null)

DIR=$(basename "$CWD")
BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null)

S="${MODEL}"
[ -n "$BRANCH" ] && S="${S}  ⎇ ${BRANCH}"
S="${S}  ${DIR}  [${BAR}] ${PCT}%"

if [ "${CPAI_SHOW_BURNRATE}" = "1" ] && command -v ccusage &>/dev/null; then
  BURN=$(bun x ccusage statusline --cost-source cc 2>/dev/null | grep -oE '\$[0-9.]+/hr' | head -1)
  [ -n "$BURN" ] && S="${S}  ${BURN}"
fi
echo "$S"
