#!/bin/bash
CPAI_DIR="${HOME}/.claude"
RULES_FILE="${CPAI_DIR}/skills/skill-rules.json"

# Single python3 call: extract prompt, classify depth, match skills.
# Outputs two lines: line 1 = depth message (or empty), line 2 = matched skills (or empty).
OUTPUT=$(python3 -c "
import sys, json, re
try: prompt = json.load(sys.stdin).get('prompt','')
except: sys.exit()
words = prompt.split()
if len(words) < 3: sys.exit()

# Depth classification
arch = re.search(r'architect|redesign|refactor|migrate|schema|structure|plan|design|propose', prompt, re.I)
if arch:
    print('[CPAI] Depth: FULL — architectural keywords. Write ISC before proceeding.')
elif len(words) > 40:
    print('[CPAI] Depth: FULL — complex request. Consider ISC.')
else:
    print()

# Skill matching
try:
    rules = json.load(open('${RULES_FILE}')).get('rules', [])
    lp = prompt.lower()
    matched = [r['skill'] for r in rules if any(kw.lower() in lp for kw in r.get('keywords', []))]
    print(' '.join(matched) if matched else '')
except:
    print('')
" 2>/dev/null)

[ -z "$OUTPUT" ] && exit 0

DEPTH=$(echo "$OUTPUT" | head -1)
MATCHED=$(echo "$OUTPUT" | tail -1)

[ -n "$DEPTH" ] && echo "$DEPTH"
[ -z "$MATCHED" ] && exit 0

cat <<EOF

INSTRUCTION: MANDATORY SKILL EVALUATION
Matched skills: ${MATCHED}

Step 1 — EVALUATE: For each matched skill, state YES or NO with a one-line reason.
Step 2 — ACTIVATE: Call Skill() for each YES. Stating YES without activating is invalid.
Step 3 — IMPLEMENT: Only after activation is complete.

If no skills are relevant after evaluation, proceed directly — no comment needed.
EOF
