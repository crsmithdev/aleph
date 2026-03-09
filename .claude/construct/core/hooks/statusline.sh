#!/bin/bash
# Statusline hook — delegates to ccstatusline for consistent theming.
# Falls back to minimal output if ccstatusline is not installed.
if command -v ccstatusline &>/dev/null; then
  cat | ccstatusline
else
  # Minimal fallback: model + branch + context%
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
  echo "$S"
fi
