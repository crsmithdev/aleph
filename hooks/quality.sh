#!/bin/bash
FILE_PATH=$(python3 -c "
import sys,json
try: d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))
except: pass
" 2>/dev/null)

[ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ] && exit 0

PROJECT_ROOT=$(git -C "$(dirname "$FILE_PATH")" rev-parse --show-toplevel 2>/dev/null)
CONFIG="${PROJECT_ROOT}/.claude/quality.json"

if [ -f "$CONFIG" ]; then
  export FILE_PATH
  python3 -c "
import json, subprocess, os, shlex
fp = os.environ['FILE_PATH']
d = json.load(open('${CONFIG}'))
for key in ('format', 'lint'):
    cmd = d.get(key, '')
    if not cmd: continue
    try:
        args = [a.replace('\$FILE', fp) for a in shlex.split(cmd)]
        subprocess.run(args, capture_output=True)
    except Exception:
        pass
" 2>/dev/null
  exit 0
fi

EXT="${FILE_PATH##*.}"
case "$EXT" in
  py)   command -v ruff &>/dev/null && ruff check --fix "$FILE_PATH" 2>/dev/null
        command -v ruff &>/dev/null && ruff format "$FILE_PATH" 2>/dev/null ;;
  ts|tsx) command -v tsc &>/dev/null && tsc --noEmit 2>/dev/null
          command -v prettier &>/dev/null && prettier --write "$FILE_PATH" 2>/dev/null ;;
  js|jsx) command -v prettier &>/dev/null && prettier --write "$FILE_PATH" 2>/dev/null ;;
  go)   command -v gofmt &>/dev/null && gofmt -w "$FILE_PATH" 2>/dev/null ;;
  rs)   command -v rustfmt &>/dev/null && rustfmt "$FILE_PATH" 2>/dev/null ;;
esac
exit 0
