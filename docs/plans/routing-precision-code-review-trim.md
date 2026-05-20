# Routing precision: code-review keyword trim

## Context

`src/skills/skill-rules.json` matches user prompts against per-skill keyword
lists in `src/core/hooks/routing-classify-submit.ts`. Matching is
stemmed-substring on the lowercased prompt; keywords surrounded by `/`/flags
are treated as regex.

Empirical baseline (7d, 73 sessions, 1101 user prompts replayed):

| | |
|---|---|
| total matches | 341 |
| total invocations (Skill() tool_use) | 59 |
| conversion | 17% |

`code-review` over that period: **39 matched, 0 invoked.** 119 keywords/regexes.
False positives dominate: most matches come from meta-conversation about
the system (talking *about* code-review or refactoring) rather than requests
to run code-review.

## Proposal: cut 119 → ~35 keywords

### Drop A — bare verbs / nouns

Bare common words that match meta-discussion just as readily as actual requests.

`conform`, `refactor`, `restructure`, `reorganize`, `consolidate`, `deduplicate`,
`standardize`, `code-conform`, `over-engineered`, `unnecessary comments`,
`too big`, `move files`, `update imports`, `break it up`, `break down this file`,
`split this module`, `single source of truth`

### Drop B — meta-discussion phrasings

Phrases that fit "talking about drift / patterns / consistency" as naturally as
"asking for a code review."

`look for drift`, `fix drift`, `look for divergence`, `divergence from the plan`,
`drift from the plan`, `do a pass over`, `do a pass`, `pass over the`,
`make them consistent`, `make consistent`, `same pattern`, `propagate this`,
`apply this pattern`, `apply the pattern`, `align with`, `match the way`,
`match this pattern`, `match the file style`, `style drift in this file`,
`align the routes`, `align the handlers`, `match this handler`,
`make the providers consistent`, `fix drift in the schemas`

### Drop C — security domain terms (rely on `/security-review` slash + narrow regex)

`owasp`, `cwe`, `asvs`, `SQL injection`, `XSS`, `XXE`, `SSRF`, `IDOR`,
`remediate`, `remediate security`, `patch security`, `fix security findings`,
`apply security fixes`

### Drop D — loose regexes

```
/(audit|review|fix|simplify|conform|refactor|restructure).{0,15}(code|diff|branch|findings|changes|implementation|module|file|files)/
/code.{0,10}(audit|review|fix|simplify|conform|refactor)/
/break.{0,15}(up|apart|out|down)/
/(too|really).{0,10}(big|long|monolithic)/
/(handlers|providers|routes|schemas|helpers).{0,30}(consistent|match|same|like)/
/(make|fix|align).{0,30}(consistent|match|same|like)/
```

### Keep (~35)

- Explicit asks: `code review`, `review this code`, `review my implementation`,
  `check my code`, `review the changes`
- Audit forms: `code audit`, `audit the code`, `audit the diff`, `audit my code`,
  `code fix`, `fix the findings`, `apply the audit fixes`, `apply the fixes`
- Slash commands: `/code-review`, `/code-refactor`, `/security-review`
- Security: `security review`, `security-review`, `security audit`,
  `audit for vulnerabilities`, `scan for security issues`, `find vulnerabilities`,
  `audit for security`, `vulnerability scan`
- Slop: `deslop`, `remove slop`, `ai slop`, `ai-generated slop`
- Simplify: `simplify this`, `simplify before commit`, `simplify code`,
  `clean up code`, `clean this up`, `remove boilerplate`, `too much boilerplate`
- Error patterns: `swallowed errors`, `silent fallback`, `band-aid guard`
- Dead-code: `dead code`, `unused exports`, `unused imports`, `unreachable branch`,
  `stale flags`, `debug leftovers`
- Slop architectural: `needless abstraction`, `pass-through wrapper`,
  `single-use helper`, `speculative indirection`
- Narrow regexes:
  - `/(simplify|clean|deslop).{0,15}(before|the|this|code|diff|commit)/`
  - `/(swallowed|silent|masked).{0,15}(error|catch|fallback|default)/`
  - `/(audit|scan|review|check|fix|remediate|patch).{0,15}(security|vuln|vulnerab|owasp|cwe)/`

## Metric & validation

After applying the cuts, re-run `scripts/routing-replay.ts 7`. Expected:
- code-review matched: 39 → ~5
- total matches: 341 → ~290
- conversion: 17% → ~22%
- invocations lost: 0 (current code-review invocations = 0)

If any historical code-review invocation is lost (`scripts/routing-fp.ts code-review`
becomes empty but the actual invoke count drops), revert specific drops.

## Files touched

- `src/skills/skill-rules.json` — code-review rule trimmed
- (no test changes — `src/tests/skills.test.ts` doesn't assert on code-review keywords)
