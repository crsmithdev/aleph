#!/bin/bash
# Construct Layer 2: Bare vs Scaffolded comparison
# Sends the same prompt via claude -p twice — once from a bare temp dir,
# once from the project root (where CLAUDE.md loads automatically).
# Detects structural signals in each response and prints a diff.
#
# Usage:
#   bash compare.sh                          # interactive prompt selection
#   bash compare.sh "your prompt here"       # run with explicit prompt
#   bash compare.sh --prompt 2               # use default prompt #2
#   bash compare.sh --list                   # list available prompts
#   bash compare.sh --save "prompt"          # save results to JSON

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# ── config ───────────────────────────────────────────────────────────────────

PROMPTS=(
  "Refactor the habits module schema to support streaks and weekly goals. The current schema just stores completion dates per habit. We need streak calculation and the ability to set weekly vs daily targets."
  "Users are randomly getting logged out. It seems related to token refresh but we haven't been able to reproduce it consistently. The refresh logic is in auth/tokenService.ts."
  "Design a Financial Snapshot module for a personal life OS. It needs to show net worth, monthly spend by category, and savings rate. Should integrate with the existing SQLite + Drizzle ORM stack."
)

LABELS=(
  "Habits schema refactor"
  "Auth debugging"
  "New module design"
)

# ── helpers ──────────────────────────────────────────────────────────────────

C_RESET="\033[0m"; C_BOLD="\033[1m"; C_DIM="\033[2m"
C_RED="\033[31m"; C_GREEN="\033[32m"; C_YELLOW="\033[33m"
C_BLUE="\033[34m"; C_CYAN="\033[36m"; C_GRAY="\033[90m"

rule() { printf "${C_GRAY}"; printf '─%.0s' $(seq 1 80); printf "${C_RESET}\n"; }
drule() { printf "${C_GRAY}"; printf '═%.0s' $(seq 1 80); printf "${C_RESET}\n"; }

list_prompts() {
  echo ""
  echo "Default prompts:"
  echo ""
  for i in "${!PROMPTS[@]}"; do
    printf "  ${C_CYAN}%d.${C_RESET} ${C_BOLD}%s${C_RESET}\n" $((i+1)) "${LABELS[$i]}"
    printf "     ${C_DIM}%.100s…${C_RESET}\n\n" "${PROMPTS[$i]}"
  done
}

# ── signal detection ─────────────────────────────────────────────────────────

SIGNAL_NAMES=(
  "ISC written"
  "THINK / capability block"
  "Depth declared"
  "Thinking tools referenced"
  "Plan before code"
  "Verify step"
)

detect_signals() {
  local text="$1"
  local -n results=$2
  results=()

  # ISC
  echo "$text" | grep -qiE 'isc|intent statement|success criteri|numbered.*criteri' \
    && results+=(1) || results+=(0)

  # THINK / capability block
  echo "$text" | grep -qiE '🎯|capability:|primary:|pattern:|thinking:' \
    && results+=(1) || results+=(0)

  # Depth declared
  echo "$text" | grep -qiE '\b(quick|full|review)\b' \
    && results+=(1) || results+=(0)

  # Thinking tools
  echo "$text" | grep -qiE 'council|redteam|firstprinciples|science|becreative|prompting|thinking tool' \
    && results+=(1) || results+=(0)

  # Plan before code
  echo "$text" | grep -qiE '\bplan\b|\bstep [0-9]|\bphase [0-9]|\bapproach\b' \
    && results+=(1) || results+=(0)

  # Verify step
  echo "$text" | grep -qiE '\bverify\b|\bcheck.*isc|\bisc.*check' \
    && results+=(1) || results+=(0)
}

print_signals() {
  local -n sigs=$1
  local hits=0
  local total=${#SIGNAL_NAMES[@]}

  for s in "${sigs[@]}"; do ((hits += s)); done

  local color="$C_RED"
  [ $hits -ge 2 ] && color="$C_YELLOW"
  [ $hits -ge 4 ] && color="$C_GREEN"

  printf "\n${C_BOLD}Signals detected: ${color}%d/%d${C_RESET}\n" "$hits" "$total"

  for i in "${!SIGNAL_NAMES[@]}"; do
    if [ "${sigs[$i]}" -eq 1 ]; then
      printf "  ${C_GREEN}✓${C_RESET} %s\n" "${SIGNAL_NAMES[$i]}"
    else
      printf "  ${C_GRAY}○ ${C_DIM}%s${C_RESET}\n" "${SIGNAL_NAMES[$i]}"
    fi
  done
}

print_summary() {
  local -n bare_sigs=$1
  local -n construct_sigs=$2

  local bare_hits=0 construct_hits=0
  for s in "${bare_sigs[@]}"; do ((bare_hits += s)); done
  for s in "${construct_sigs[@]}"; do ((construct_hits += s)); done
  local delta=$((construct_hits - bare_hits))

  echo ""
  drule
  printf "  ${C_BOLD}SUMMARY${C_RESET}\n"
  drule

  printf "\n  Bare Claude:        %d/%d signals\n" "$bare_hits" "${#SIGNAL_NAMES[@]}"
  if [ $delta -gt 0 ]; then
    printf "  Construct scaffolded: %d/%d signals  ${C_GREEN}▲ +%d${C_RESET}\n" "$construct_hits" "${#SIGNAL_NAMES[@]}" "$delta"
  elif [ $delta -lt 0 ]; then
    printf "  Construct scaffolded: %d/%d signals  ${C_RED}▼ %d${C_RESET}\n" "$construct_hits" "${#SIGNAL_NAMES[@]}" "$delta"
  else
    printf "  Construct scaffolded: %d/%d signals  ${C_GRAY}(no change)${C_RESET}\n" "$construct_hits" "${#SIGNAL_NAMES[@]}"
  fi

  echo ""
  echo "  Per-signal diff:"
  for i in "${!SIGNAL_NAMES[@]}"; do
    local b="${bare_sigs[$i]}" c="${construct_sigs[$i]}"
    local mark="${C_GRAY}  ·· ${C_RESET}"
    [ "$b" -eq 0 ] && [ "$c" -eq 1 ] && mark="${C_GREEN}  ++ ${C_RESET}"
    [ "$b" -eq 1 ] && [ "$c" -eq 0 ] && mark="${C_RED}  -- ${C_RESET}"
    [ "$b" -eq 1 ] && [ "$c" -eq 1 ] && mark="${C_DIM}  == ${C_RESET}"
    printf "${mark}${C_DIM}%s${C_RESET}\n" "${SIGNAL_NAMES[$i]}"
  done
  echo ""
}

# ── check prerequisites ─────────────────────────────────────────────────────

if ! command -v claude &>/dev/null; then
  printf "${C_RED}Error: claude CLI not found${C_RESET}\n"
  exit 1
fi

# ── parse arguments ──────────────────────────────────────────────────────────

PROMPT=""
SAVE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --list) list_prompts; exit 0 ;;
    --save) SAVE=true; shift ;;
    --prompt)
      IDX=$(($2 - 1))
      if [ "$IDX" -ge 0 ] && [ "$IDX" -lt ${#PROMPTS[@]} ]; then
        PROMPT="${PROMPTS[$IDX]}"
      else
        printf "${C_RED}--prompt must be 1-%d${C_RESET}\n" "${#PROMPTS[@]}"
        exit 1
      fi
      shift 2
      ;;
    *)
      PROMPT="$*"
      break
      ;;
  esac
done

# Interactive selection if no prompt given
if [ -z "$PROMPT" ]; then
  echo ""
  echo "Default prompts:"
  for i in "${!LABELS[@]}"; do
    printf "  ${C_CYAN}%d.${C_RESET} %s\n" $((i+1)) "${LABELS[$i]}"
  done
  printf "  ${C_CYAN}c.${C_RESET} custom\n\n"
  read -rp "Select [1-${#PROMPTS[@]} or c]: " ANS

  if [ "$ANS" = "c" ]; then
    read -rp "Enter prompt: " PROMPT
  else
    IDX=$((ANS - 1))
    PROMPT="${PROMPTS[$IDX]:-${PROMPTS[0]}}"
  fi
fi

if [ -z "$PROMPT" ]; then
  printf "${C_RED}No prompt provided${C_RESET}\n"
  exit 1
fi

# ── run comparison ───────────────────────────────────────────────────────────

echo ""
drule
printf "  ${C_BOLD}Construct Layer 2 — Bare vs Scaffolded${C_RESET}\n"
drule
printf "\n  ${C_BOLD}Prompt:${C_RESET} %.100s%s\n" "$PROMPT" "$([ ${#PROMPT} -gt 100 ] && echo '…')"
printf "\n  Firing both requests in parallel…\n"

# Bare: run from a temp dir with no CLAUDE.md
BARE_DIR=$(mktemp -d)
trap "rm -rf '$BARE_DIR'" EXIT

# Run both in parallel
BARE_TEXT=$(cd "$BARE_DIR" && claude -p "$PROMPT" --output-format text 2>/dev/null) &
BARE_PID=$!
CONSTRUCT_TEXT=$(cd "$PROJECT_ROOT" && claude -p "$PROMPT" --output-format text 2>/dev/null) &
CONSTRUCT_PID=$!

wait $BARE_PID
BARE_EXIT=$?
wait $CONSTRUCT_PID
CONSTRUCT_EXIT=$?

# ── display results ──────────────────────────────────────────────────────────

if [ $BARE_EXIT -ne 0 ]; then
  BARE_TEXT="ERROR: claude -p exited with code $BARE_EXIT"
fi
if [ $CONSTRUCT_EXIT -ne 0 ]; then
  CONSTRUCT_TEXT="ERROR: claude -p exited with code $CONSTRUCT_EXIT"
fi

echo ""
rule
printf "  ${C_GRAY}${C_BOLD}BARE CLAUDE — no CLAUDE.md${C_RESET}\n"
rule
echo ""
echo "$BARE_TEXT" | head -60 | sed 's/^/  /'
[ $(echo "$BARE_TEXT" | wc -l) -gt 60 ] && printf "\n  ${C_DIM}… (truncated)${C_RESET}\n"

declare -a BARE_SIGNALS
detect_signals "$BARE_TEXT" BARE_SIGNALS
print_signals BARE_SIGNALS

echo ""
rule
printf "  ${C_BLUE}${C_BOLD}CONSTRUCT SCAFFOLDED — CLAUDE.md loaded${C_RESET}\n"
rule
echo ""
echo "$CONSTRUCT_TEXT" | head -60 | sed 's/^/  /'
[ $(echo "$CONSTRUCT_TEXT" | wc -l) -gt 60 ] && printf "\n  ${C_DIM}… (truncated)${C_RESET}\n"

declare -a CONSTRUCT_SIGNALS
detect_signals "$CONSTRUCT_TEXT" CONSTRUCT_SIGNALS
print_signals CONSTRUCT_SIGNALS

# ── summary ──────────────────────────────────────────────────────────────────

if [ $BARE_EXIT -eq 0 ] && [ $CONSTRUCT_EXIT -eq 0 ]; then
  print_summary BARE_SIGNALS CONSTRUCT_SIGNALS
fi

# ── save ─────────────────────────────────────────────────────────────────────

if $SAVE; then
  TS=$(date -u +"%Y-%m-%dT%H%M%S")
  OUT="construct-eval-${TS}.json"

  bare_hits=0; construct_hits=0
  for s in "${BARE_SIGNALS[@]}"; do ((bare_hits += s)); done
  for s in "${CONSTRUCT_SIGNALS[@]}"; do ((construct_hits += s)); done

  python3 -c "
import json, sys
out = {
    'timestamp': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'prompt': sys.argv[1],
    'bare': {'score': $bare_hits, 'total': ${#SIGNAL_NAMES[@]}},
    'construct': {'score': $construct_hits, 'total': ${#SIGNAL_NAMES[@]}},
}
print(json.dumps(out, indent=2))
" "$PROMPT" > "$OUT"
  printf "  ${C_GREEN}Saved:${C_RESET} %s\n\n" "$OUT"
fi
