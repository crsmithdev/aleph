#!/bin/bash
CONSTRUCT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CONTEXT="${CONSTRUCT_DIR}/memory/CONTEXT.md"
LEARNED="${CONSTRUCT_DIR}/memory/LEARNED.md"
SNAPSHOTS_DIR="${CONSTRUCT_DIR}/memory/snapshots"
SESSION_COUNT=$(ls "${CONSTRUCT_DIR}/memory/sessions/" 2>/dev/null | wc -l | tr -d ' ')

echo "=== Session Start ==="
echo "Sessions: ${SESSION_COUNT}"

if [ -f "$CONTEXT" ]; then
  FOCUS=$(awk '/## Current focus/,/^## /' "$CONTEXT" | grep -v "^## " | grep -v "^$" | head -3)
  [ -n "$FOCUS" ] && echo "Focus: ${FOCUS}"
else
  echo "⚠ memory/CONTEXT.md not found — install construct-memory or create it manually"
fi

if [ -f "$LEARNED" ]; then
  RECENT=$(grep "^[0-9]\{4\}-" "$LEARNED" | tail -2)
  [ -n "$RECENT" ] && echo "Recent:" && echo "$RECENT" | sed 's/^/  /'
else
  echo "⚠ memory/LEARNED.md not found — install construct-memory or create it manually"
fi

if [ -d "$SNAPSHOTS_DIR" ]; then
  SNAPS=$(ls -t "$SNAPSHOTS_DIR"/*.md 2>/dev/null | head -3)
  if [ -n "$SNAPS" ]; then
    echo ""; echo "⚠ Unresolved snapshots:"
    for f in $SNAPS; do echo "  $(basename "$f"): $(head -1 "$f")"; done
    echo "  Run /context-report to review."
  fi
fi
echo "===================="
