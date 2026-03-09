#!/bin/bash
# Construct Layer 1 Test Harness
# Tests each hook independently without running a full Claude Code session.
#
# Usage:
#   bash test.sh          # run all tests
#   bash test.sh hooks    # hook tests only
#   bash test.sh settings # settings.json tests only
#   bash test.sh memory   # memory/file tests only

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONSTRUCT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLAUDE_DIR="$(cd "${CONSTRUCT_DIR}/.." && pwd)"
PASS=0; FAIL=0; SKIP=0

# ── helpers ──────────────────────────────────────────────────────────────────

pass() { echo "  ✓  $1"; ((PASS++)); }
fail() { echo "  ✗  $1"; ((FAIL++)); }
skip() { echo "  ⊘  $1 (skipped: $2)"; ((SKIP++)); }
header() { echo ""; echo "── $1 ──"; }

# ── SECTION: settings.json ───────────────────────────────────────────────────

test_settings() {
  header "settings.json"

  [ -f "${CLAUDE_DIR}/settings.json" ] || { fail "settings.json missing"; return; }

  python3 - "${CLAUDE_DIR}/settings.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
try:
    d = json.load(open(path))
except json.JSONDecodeError as e:
    print(f"  ✗  settings.json invalid JSON: {e}")
    sys.exit(1)

hooks = d.get('hooks', {})
perms = d.get('permissions', {})

checks = [
    ('permissions.allow is non-empty',  bool(perms.get('allow'))),
    ('permissions.deny is non-empty',   bool(perms.get('deny'))),
    ('permissions.ask is non-empty',    bool(perms.get('ask'))),
    ('statusLine registered',           bool(d.get('statusLine'))),
    ('SessionStart hook registered',    'SessionStart' in hooks),
    ('UserPromptSubmit hook registered','UserPromptSubmit' in hooks),
    ('PostToolUse hook registered',     'PostToolUse' in hooks),
    ('Stop hook registered',            'Stop' in hooks),
    ('Notification hook registered',    'Notification' in hooks),
]

for label, result in checks:
    print(f"  {'✓' if result else '✗'}  {label}")
PYEOF
}

# ── SECTION: hook files ──────────────────────────────────────────────────────

test_hook_files() {
  header "Hook files"

  declare -A HOOKS=(
    ["core/hooks/statusline.sh"]="statusline"
    ["memory/hooks/session-start.sh"]="session-start"
    ["memory/hooks/rating-capture.sh"]="rating-capture"
    ["memory/hooks/sentiment-capture.sh"]="sentiment-capture"
    ["memory/hooks/session-summary.sh"]="session-summary"
    ["skills/hooks/format-reminder.sh"]="format-reminder"
    ["dev/hooks/quality.sh"]="quality"
    ["dev/hooks/notify.sh"]="notify"
  )

  for path in "${!HOOKS[@]}"; do
    name="${HOOKS[$path]}"
    fp="${CONSTRUCT_DIR}/${path}"
    if [ ! -f "$fp" ]; then
      fail "${name} (${path}) not found"
    elif [ ! -x "$fp" ]; then
      fail "${name} not executable"
    else
      pass "${name} exists and is executable"
    fi
  done
}

# ── SECTION: statusline ─────────────────────────────────────────────────────

test_statusline() {
  header "statusline.sh"

  HOOK="${CONSTRUCT_DIR}/core/hooks/statusline.sh"
  PAYLOAD='{"model":{"display_name":"claude-sonnet-4-6"},"cwd":"/home/user/project","context_window":{"used_percentage":28}}'
  OUTPUT=$(echo "$PAYLOAD" | bash "$HOOK" 2>&1)

  [ -n "$OUTPUT" ] && pass "produces output" || fail "produced no output"
}

# ── SECTION: format-reminder ─────────────────────────────────────────────────

test_format_reminder() {
  header "format-reminder.sh"

  HOOK="${CONSTRUCT_DIR}/skills/hooks/format-reminder.sh"

  # Short prompt — should exit silently
  OUTPUT=$(echo '{"prompt":"ok"}' | bash "$HOOK" 2>&1)
  [ -z "$OUTPUT" ] && pass "short prompt exits silently" || fail "short prompt produced output: $OUTPUT"

  # Architectural keyword — should emit FULL
  PAYLOAD='{"prompt":"refactor the habits schema to support streaks and weekly goals"}'
  OUTPUT=$(echo "$PAYLOAD" | bash "$HOOK" 2>&1)
  echo "$OUTPUT" | grep -qi "FULL" && pass "architectural prompt triggers FULL depth" \
    || fail "architectural prompt did not emit FULL — got: $OUTPUT"

  # Skill eval block — only if skills with rules exist
  if [ -f "${CONSTRUCT_DIR}/skills/skill-rules.json" ]; then
    # Use a prompt that matches research keywords
    PAYLOAD='{"prompt":"research the history of TCP/IP and investigate the protocol stack"}'
    OUTPUT=$(echo "$PAYLOAD" | bash "$HOOK" 2>&1)
    echo "$OUTPUT" | grep -qi "MANDATORY SKILL EVALUATION\|skill eval" \
      && pass "skill evaluation block present for matching keywords" \
      || fail "skill evaluation block missing — got: $OUTPUT"
  else
    skip "skill eval block" "skill-rules.json not found"
  fi

  # Long prompt without architectural keywords — should emit FULL from word count (>40 words)
  LONG="help me understand what this function does and whether it handles edge cases properly and what we might want to change about the implementation going forward and also whether the error handling is sufficient for production use and if there are any performance concerns we should address before shipping this to users"
  OUTPUT=$(echo "{\"prompt\":\"$LONG\"}" | bash "$HOOK" 2>&1)
  echo "$OUTPUT" | grep -qi "FULL\|complex" && pass "long prompt (>40 words) triggers FULL" \
    || fail "long prompt did not trigger FULL — got: $OUTPUT"
}

# ── SECTION: rating-capture ──────────────────────────────────────────────────

test_rating_capture() {
  header "rating-capture.sh"

  HOOK="${CONSTRUCT_DIR}/memory/hooks/rating-capture.sh"
  RATINGS="${CONSTRUCT_DIR}/memory/signals/ratings.jsonl"
  BEFORE=$(wc -l < "$RATINGS" 2>/dev/null || echo 0)

  # Explicit rating in prompt
  echo '{"prompt":"that was good, 8/10"}' | bash "$HOOK" 2>&1
  AFTER=$(wc -l < "$RATINGS" 2>/dev/null || echo 0)
  [ "$AFTER" -gt "$BEFORE" ] && pass "explicit rating appended to ratings.jsonl" \
    || fail "explicit rating not captured (before=$BEFORE after=$AFTER)"

  # Verify the appended line is valid JSON with correct rating
  if [ "$AFTER" -gt "$BEFORE" ]; then
    LAST=$(tail -1 "$RATINGS")
    python3 -c "import json; d=json.loads('''$LAST'''); assert d.get('rating')==8, f'got {d.get(\"rating\")}'" 2>/dev/null \
      && pass "captured rating value is 8" \
      || fail "rating JSON malformed or wrong value: $LAST"
  fi

  # Prompt with no rating — should not append
  BEFORE2=$AFTER
  echo '{"prompt":"what does this function do?"}' | bash "$HOOK" 2>&1
  AFTER2=$(wc -l < "$RATINGS" 2>/dev/null || echo 0)
  [ "$AFTER2" -eq "$BEFORE2" ] && pass "non-rating prompt does not append" \
    || fail "non-rating prompt incorrectly appended a line"
}

# ── SECTION: quality.sh ─────────────────────────────────────────────────────

test_quality() {
  header "quality.sh"

  HOOK="${CONSTRUCT_DIR}/dev/hooks/quality.sh"
  FIXTURE="${SCRIPT_DIR}/fixture/src/user.ts"

  # Missing file — must exit 0
  PAYLOAD='{"tool_input":{"file_path":"/tmp/does-not-exist-construct-test.ts"}}'
  echo "$PAYLOAD" | bash "$HOOK" 2>&1
  [ $? -eq 0 ] && pass "missing file exits 0" || fail "missing file returned non-zero"

  # Real file — must exit 0 regardless of linter output
  if [ -f "$FIXTURE" ]; then
    PAYLOAD="{\"tool_input\":{\"file_path\":\"${FIXTURE}\"}}"
    echo "$PAYLOAD" | bash "$HOOK" 2>&1
    [ $? -eq 0 ] && pass "real file exits 0" || fail "real file returned non-zero (hook must never block)"
  else
    skip "real file test" "fixture not found at $FIXTURE"
  fi

  # quality.json detection — project root config
  PAYLOAD="{\"tool_input\":{\"file_path\":\"${SCRIPT_DIR}/fixture/src/habits.ts\"}}"
  echo "$PAYLOAD" | bash "$HOOK" 2>&1
  [ $? -eq 0 ] && pass "project-root quality.json path exits 0" \
    || fail "project-root quality.json path returned non-zero"
}

# ── SECTION: session-start ───────────────────────────────────────────────────

test_session_start() {
  header "session-start.sh"

  OUTPUT=$(bash "${CONSTRUCT_DIR}/memory/hooks/session-start.sh" 2>&1)

  echo "$OUTPUT" | grep -q "Session Start" && pass "Session Start header present" \
    || fail "Session Start header missing — got: $OUTPUT"
  echo "$OUTPUT" | grep -q "Sessions:" && pass "Sessions count present" \
    || fail "Sessions count missing"
}

# ── SECTION: session-summary (context injection) ────────────────────────────

test_session_summary() {
  header "session-summary.sh"

  HOOK="${CONSTRUCT_DIR}/memory/hooks/session-summary.sh"

  # Under threshold — should not produce output
  PAYLOAD='{"messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]}'
  OUTPUT=$(echo "$PAYLOAD" | bash "$HOOK" 2>&1)
  [ -z "$OUTPUT" ] && pass "short session (<4 messages) produces no output" \
    || fail "short session produced unexpected output: $OUTPUT"

  # Over threshold — should produce context injection
  MSGS='[{"role":"user","content":"refactor habits"},{"role":"assistant","content":"plan"},{"role":"user","content":"looks good"},{"role":"assistant","content":"done"},{"role":"user","content":"add streaks"},{"role":"assistant","content":"adding"}]'
  PAYLOAD="{\"messages\":${MSGS}}"
  OUTPUT=$(echo "$PAYLOAD" | bash "$HOOK" 2>&1)
  echo "$OUTPUT" | grep -q "Construct:SESSION-SUMMARY" \
    && pass "6-message session produces context injection" \
    || fail "6-message session did not produce context injection — got: $OUTPUT"

  # Verify injection contains expected format instructions
  echo "$OUTPUT" | grep -q "Session:" \
    && pass "injection contains Session: template" \
    || fail "injection missing Session: template"
}

# ── SECTION: sentiment-capture (context injection) ──────────────────────────

test_sentiment_capture() {
  header "sentiment-capture.sh"

  HOOK="${CONSTRUCT_DIR}/memory/hooks/sentiment-capture.sh"

  # Positive message — should produce context injection
  MSG="this is exactly what I needed, the refactor is much cleaner now and I can see the path forward"
  PAYLOAD="{\"messages\":[{\"role\":\"user\",\"content\":\"$MSG\"}]}"
  OUTPUT=$(echo "$PAYLOAD" | bash "$HOOK" 2>&1)
  echo "$OUTPUT" | grep -q "Construct:SENTIMENT" \
    && pass "positive message produces context injection" \
    || fail "positive message did not produce context injection — got: $OUTPUT"

  # Message with explicit rating — sentiment hook should skip
  PAYLOAD='{"messages":[{"role":"user","content":"7/10 pretty good"}]}'
  OUTPUT=$(echo "$PAYLOAD" | bash "$HOOK" 2>&1)
  [ -z "$OUTPUT" ] && pass "explicit rating message is skipped" \
    || fail "sentiment hook ran on explicit-rating message (should skip) — got: $OUTPUT"

  # Short message — should skip
  PAYLOAD='{"messages":[{"role":"user","content":"ok"}]}'
  OUTPUT=$(echo "$PAYLOAD" | bash "$HOOK" 2>&1)
  [ -z "$OUTPUT" ] && pass "short message is skipped" \
    || fail "short message produced output — got: $OUTPUT"
}

# ── SECTION: notify.sh ──────────────────────────────────────────────────────

test_notify() {
  header "notify.sh"

  HOOK="${CONSTRUCT_DIR}/dev/hooks/notify.sh"

  NOTIFY_OK=true
  for evt in idle permission complete unknown; do
    echo "{\"type\":\"${evt}\"}" | bash "$HOOK" 2>/dev/null
    [ $? -eq 0 ] || NOTIFY_OK=false
  done
  $NOTIFY_OK && pass "exits 0 for all event types" || fail "returned non-zero for some event types"
}

# ── SECTION: memory directories ──────────────────────────────────────────────

test_memory() {
  header "Memory structure"

  for d in memory memory/sessions memory/snapshots memory/signals; do
    test -d "${CONSTRUCT_DIR}/${d}" && pass "${d}/" || fail "${d}/ missing"
  done

  for f in memory/CONTEXT.md memory/LEARNED.md; do
    fp="${CONSTRUCT_DIR}/${f}"
    if [ -f "$fp" ]; then
      [ -s "$fp" ] && pass "${f} exists and non-empty" || fail "${f} exists but is empty"
    else
      fail "${f} missing"
    fi
  done
}

# ── SECTION: identity files ─────────────────────────────────────────────────

test_identity() {
  header "Identity files"

  for f in SOUL.md IDENTITY.md STYLE.md USER.md BOOTSTRAP.md; do
    fp="${CONSTRUCT_DIR}/core/identity/${f}"
    if [ -f "$fp" ]; then
      [ -s "$fp" ] && pass "identity/${f}" || fail "identity/${f} exists but is empty"
    else
      skip "identity/${f}" "not created (optional)"
    fi
  done
}

# ── SECTION: CLAUDE.md sections ──────────────────────────────────────────────

test_claude_md() {
  header "CLAUDE.md"

  MD="${CLAUDE_DIR}/CLAUDE.md"
  [ -f "$MD" ] || { fail "CLAUDE.md missing"; return; }

  for section in \
    "## Behavior" \
    "## Task Execution" \
    "## Thinking Tools" \
    "## Pack Installation" \
    "## Memory Files" \
    "## Identity Files" \
    "## Spec Sync" \
    "## Dev Conventions" \
    "## Agent Personas" \
    "## Worktree Convention"; do
    grep -q "$section" "$MD" && pass "$section" || fail "$section missing"
  done

  # Line count warning
  LINES=$(wc -l < "$MD")
  [ "$LINES" -lt 300 ] && pass "CLAUDE.md is ${LINES} lines (under 300)" \
    || skip "CLAUDE.md is ${LINES} lines" "over 300 — consider trimming"
}

# ── SECTION: commands ────────────────────────────────────────────────────────

test_commands() {
  header "Slash commands"

  for cmd in clear-snapshot common-ground context-report dashboard spec test update-learned verify worktree; do
    test -f "${CLAUDE_DIR}/commands/${cmd}.md" && pass "/${cmd}" || fail "/${cmd} missing"
  done
}

# ── RUNNER ───────────────────────────────────────────────────────────────────

FILTER="${1:-all}"

echo "Construct Layer 1 Test Harness"
echo "CONSTRUCT_DIR: ${CONSTRUCT_DIR}"
echo "CLAUDE_DIR:    ${CLAUDE_DIR}"

case "$FILTER" in
  settings)  test_settings ;;
  hooks)     test_hook_files ;;
  memory)    test_memory; test_identity; test_claude_md ;;
  commands)  test_commands ;;
  all|*)
    test_settings
    test_hook_files
    test_statusline
    test_format_reminder
    test_rating_capture
    test_quality
    test_session_start
    test_session_summary
    test_sentiment_capture
    test_notify
    test_memory
    test_identity
    test_claude_md
    test_commands
    ;;
esac

echo ""
echo "────────────────────────────────"
echo "  Passed: ${PASS}  Failed: ${FAIL}  Skipped: ${SKIP}"
[ $FAIL -eq 0 ] && echo "  Layer 1: OK" || echo "  Layer 1: NEEDS ATTENTION"
exit $FAIL
