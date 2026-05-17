---
name: security-review
description: >
  Review security — audit OWASP/CWE/etc findings (default) or apply approved
  fixes (mode: fix). Audit mode covers injection, auth/authz, data exposure,
  crypto, input validation, business logic, configuration, supply chain, code
  execution, and XSS — emits SARIF findings (per `src/skills/_shared/finding.md`)
  with framework mappings to OWASP-Top-10-2025, CWE-Top-25, NIST-CSF-2.0,
  ASVS-5.0, MITRE-ATT&CK. Fix mode applies remediations (parameterize SQL, swap
  weak crypto, replace `Math.random()` with CSPRNG, wrap user input in
  DOMPurify, delete hardcoded secrets and route through env, add ownership
  checks to IDOR routes, etc.) and verifies with `gate("security")` +
  `gate("code")`. Per-finding approval required for fix mode — no "approve all"
  path. Evaluates rules in `src/rules/security/RULES.md`. Triggers on
  "/audit security", "/fix security", "/security-review", "security audit",
  "audit for vulnerabilities", "scan for security issues", "OWASP", "CWE",
  "find vulnerabilities", "fix the vulnerabilities", "remediate", or when the
  omnibus dispatches the audit or fix verb to the security domain.
verb: review
domain: security
modes: [audit, fix]
approval:
  fix: per-finding
metadata:
  argument-hint: <scope-or-module> [--mode audit|fix]
---

# Security Review

Unified security skill with two modes. **Audit mode (default)** walks code in scope, evaluates each rule in `src/rules/security/RULES.md`, and emits SARIF findings — read-only, no edits. **Fix mode** applies remediations derived from audit findings, but **every finding requires explicit per-finding approval** before any edit is applied.

Security is split from `code` for distinct rule sources (external standards), distinct review cognition (exploitable vs sloppy), and a stricter approval policy. The audit phase produces findings; the omnibus enforces approval; fix mode never auto-applies without it.

Pure leaf: no `Skill()` calls. The omnibus chains audit → per-finding approval → fix.

## Modes

| Mode | Verb | What it does | Approval | Verification |
|---|---|---|---|---|
| `audit` (default) | audit | Walk scope, emit SARIF + phased prose summary | n/a (read-only) | n/a |
| `fix` | fix | Apply remediations from SARIF findings | **per-finding** (no "approve all") | `gate("security")` + `gate("code")` |

## When to use

**Audit mode:**
- User asks to audit the diff or a module for security issues.
- User invokes `/security-review` directly, or `/audit security` via the omnibus.
- The omnibus dispatches the `audit` verb to the `security` domain.

**Fix mode:**
- After audit produced findings and the user explicitly approved them, finding-by-finding.
- User invokes `/security-review --mode fix` against a saved SARIF report (still triggers per-finding approval before applying).
- User invokes `/fix security` via the omnibus.

## When NOT to use

- General code quality / slop / drift → `code-review`.
- Visual / a11y / typography → `design-review`.
- Documentation review → `docs-review`.
- Subagent definitions / agent drift → `agent-review`.
- Fix-mode work when findings haven't been approved per-finding — re-run audit and route through the omnibus approval flow.
- For findings the audit produced with `severity: nit` and `tag: hardening` that don't represent a real exploit path — those can be deferred without prejudice.

---

## Audit mode

### Inputs

1. **Scope** (default: smart — see below) — `--diff` against `origin/main`, `--module <path>`, `--since <git-ref>`, or `--all`.
2. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`. Security findings frequently warrant a lower threshold (60-70) on first pass; the validation step still applies.
3. **Include exclusions** (optional) — `--include dos,rate-limit` to override `omnibus.yml`'s default exclusion list for projects where those categories matter.

### Process

#### 1. Resolve scope

```bash
# --diff (against origin/main, conventional default for feature branches)
git diff --name-only origin/main...HEAD -- '**/*.ts' '**/*.tsx' '**/*.js' '**/*.jsx' 'package.json' 'bun.lock' '.env*'

# --since <ref>
git diff --name-only <ref>...HEAD -- '**/*.ts' '**/*.tsx' '**/*.js' '**/*.jsx' 'package.json' 'bun.lock'

# --module <path>
find <path> -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) -not -path '*/node_modules/*'

# --all
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*'
```

**Smart default:** try `--diff` first. If empty, stop and surface *"No files in scope: `origin/main...HEAD` is empty. Try `--module <path>`, `--since HEAD~5`, or `--all`."* — do not silently audit nothing.

Always include `package.json`, lock files, and `.env*` files when present in scope — supply chain and configuration rules (H, G) walk them.

#### 2. Walk the rules

For each in-scope file, evaluate every section A through J in `src/rules/security/RULES.md`. Each rule's `Detect:` line specifies the signal (grep, structural check, or dataflow trace). Concrete examples of high-value checks:

- **A.1 (SQL injection):** grep template literals containing `${` inside the first argument of `db.query` / `db.exec` / `prisma.$queryRawUnsafe` / similar.
- **A.2 (shell injection):** grep `exec(/`` / `execSync(/`` / `spawn(/`` with interpolated arguments.
- **B.1 (client-side authz):** for each route handler, confirm `req.body.userId` / `req.body.role` are not used directly for authorization — caller identity comes from session / verified token.
- **B.2 (IDOR):** for each handler that loads a resource by `req.params.<id>`, confirm a follow-up ownership check (`where: { ownerId: session.userId }` or equivalent).
- **C.1 (hardcoded secrets):** scan literals against secret patterns (`sk-[A-Za-z0-9]{20,}`, `AKIA[0-9A-Z]{16}`, JWT signing strings, private key headers).
- **D.1 (weak hash):** grep `crypto.createHash('md5'|'sha1')`.
- **D.2 (CSPRNG):** grep `Math.random()` then trace whether the value flows into a token/ID/nonce field.
- **E.2 (path traversal):** grep `fs.readFile` / `path.join` with a `req.*` argument; confirm `resolve` + `startsWith(base)` follow-up.
- **I.1 (RCE via eval):** grep `eval(` / `new Function(` / `vm.run*` with a non-literal argument.
- **J.1 (XSS via dangerouslySetInnerHTML):** grep React `dangerouslySetInnerHTML` with a non-DOMPurify-wrapped expression.
- **H.1 (unpinned deps):** scan `package.json` for `"latest"` / `"*"` values; flag any git refs without `#<sha>`.

When a rule's Detect signal doesn't apply to the scope (e.g., XSS rules on a backend-only module), skip silently — no "no findings" noise per rule.

#### 3. Apply negative-filter list

Per `src/rules/security/RULES.md` "Default exclusions" + the shared list in `src/skills/_shared/finding.md`:

- Denial of Service / rate limiting → drop unless `--include dos`
- Memory/CPU exhaustion → drop unless `--include exhaustion`
- Generic input validation without proven downstream impact → drop (covered by E.1 / E.4 only with a real consequence)
- Open redirect → drop unless tied to credential leak
- Detection evasion concerns → drop (not a defensive concern)
- Issues a linter would catch (`eslint-plugin-security`, `semgrep`) → cite the linter, mark `severity: nit` if including
- Lint-ignored lines → drop

The omnibus validation pass is the second line; this skill is the first.

#### 4. Emit SARIF

Single SARIF v2.1.0 run with `tool.driver.name = "security-review"` and `properties.mode = "audit"`. Per `src/skills/_shared/finding.md`, each `result` has:

```json
{
  "ruleId": "security/RULES.md#<section>.<n>",
  "level": "error" | "warning" | "note",
  "message": { "text": "<one-line description of the vulnerability>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit",
    "fix": "<concrete remediation — code change or library swap>",
    "tag": "injection" | "auth" | "secret" | "pii" | "info-leak" | "crypto" | "validation" | "path-traversal" | "ssrf" | "toctou" | "race" | "misconfig" | "hardening" | "supply-chain" | "rce" | "prototype-pollution" | "xss" | "payments",
    "scope": "diff" | "module" | "all",
    "frameworks": ["OWASP:A03:2025", "CWE-89", "ASVS:V5.3.4", "NIST-CSF:PR.DS-2", "MITRE-ATT&CK:T1190"]
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

`properties.frameworks` is the security-domain extension: an array of standard-citation strings so downstream consumers (compliance reports, SOC 2 evidence, security dashboards) can link findings to control frameworks without re-parsing the ruleId. Supported framework prefixes:

- `OWASP:` — OWASP Top 10 2025 (e.g., `OWASP:A03:2025`)
- `CWE-` — CWE Top 25 (e.g., `CWE-89`)
- `ASVS:` — OWASP ASVS 5.0 (e.g., `ASVS:V5.3.4`)
- `NIST-CSF:` — NIST Cybersecurity Framework 2.0 (e.g., `NIST-CSF:PR.DS-2`)
- `MITRE-ATT&CK:` — MITRE ATT&CK techniques (e.g., `MITRE-ATT&CK:T1190`)

Security findings rarely qualify for `praise` — surface defensive patterns (parameterized queries, constant-time comparison, sanitized markdown renderer) only when the code solves a typical anti-pattern that peers in the same scope get wrong. Praise with `tag: defense-in-depth` and a propagation pointer in `fix`.

**Per-finding approval tags.** Tags `secret`, `auth`, `payments`, `rce`, `injection`, `crypto` are all `per-finding` per `omnibus.yml`. In practice, every finding emitted by this skill is per-finding — there is no "approve all" path for any security tag.

#### 5. Emit a phased prose summary

After the SARIF block, output a phased report for human readers:

```
# Security Review (audit) — <scope>

## blocking (N)
- <file:line> — <rule> [framework citations] — <one-line> (confidence X)

## important (N)
- ...

## nit (N)
- ...

## praise (N)
- ...

## Pre-existing issues (out of scope, M)
- ...

## Excluded by default (would have flagged, N — pass `--include` to surface)
- <count by category>
```

The omnibus reads the SARIF; humans read the prose. The "Excluded by default" section is unique to security — it surfaces what was deliberately filtered so the user can opt in.

### Audit output template

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Security Review (audit) — <scope>
<phased prose>
```

When invoked by the omnibus, return the SARIF as the structured result; the omnibus assembles the cross-domain phased report and routes per-finding approval prompts.

---

## Fix mode

### Inputs

1. **Findings** (required) — SARIF v2.1.0 from a prior audit, either passed inline (omnibus path) or read from disk.
2. **Approvals** (required) — explicit per-finding approval. The omnibus enforces this; direct invocation must collect it from the user before each edit.
3. **Scope** — inherited from the audit findings; never expands beyond them.

### Process

#### 1. Resolve findings

Parse the SARIF. Group by `properties.tag` (one tag → one fix shape). If fix mode is invoked directly without omnibus pre-approval, surface every finding and require the user to approve each one individually before proceeding. **Never apply a fix that lacks an explicit approval.**

#### 2. Map tag → fix shape

| Tag | Fix shape | What it does |
|---|---|---|
| `injection` (SQL) | Parameterize | Rewrite raw template-literal SQL to use placeholders + bound parameters (driver-specific) |
| `injection` (shell) | Argv split | Rewrite `exec(/`cmd ${arg}/`)` to `spawn('cmd', [arg])` |
| `injection` (XXE) | Parser hardening | Add `noent: false` / `resolveExternals: false` option to the parser call |
| `injection` (NoSQL) | Key allowlist | Add `$`-key filter or use the driver's safe-query API |
| `auth` (client-side) | Server-side check | Move the authorization check to the route handler; derive caller identity from session |
| `auth` (IDOR) | Ownership filter | Add `where: { ownerId: session.userId }` to the lookup |
| `auth` (cookie flags) | Flag addition | Add `httpOnly`, `secure`, `sameSite` to the cookie options |
| `auth` (bypass) | Delete bypass | Remove the hardcoded credential / debug flag; if the path was genuinely needed for dev, gate it behind a server-side feature flag with telemetry |
| `secret` | Env extraction | Move the literal to env; replace the source with `getEnv('KEY')` (or project equivalent); add to `.env.example` |
| `pii` (logging) | Redact / drop | Wrap with a redaction helper, or remove the field from the log |
| `info-leak` | Safe-error mapping | Map the exception to a public-safe message; log the detail server-side |
| `crypto` (weak hash) | Algorithm swap | Replace `md5`/`sha1` with `sha256` for integrity, `argon2id` for passwords |
| `crypto` (Math.random) | CSPRNG swap | Replace with `crypto.randomBytes` / `crypto.getRandomValues` |
| `crypto` (timing) | Constant-time | Replace `===` on secrets with `crypto.timingSafeEqual` |
| `validation` | Schema add | Add zod / valibot schema + `.parse(req.body)` at the handler entry |
| `path-traversal` | Resolve + check | Add `path.resolve` + `startsWith(base)` guard |
| `ssrf` | Scheme check | Add `new URL(url).protocol === 'https:'` guard |
| `toctou` | Atomic open | Remove the `exists`/`stat` precheck; open and handle the error |
| `race` | Transaction | Wrap the read-modify-write in a DB transaction or atomic increment |
| `misconfig` | Config flip | Toggle the setting (CORS origin, cookie secure, hardening header) |
| `supply-chain` (unpinned) | Pin | Replace `"latest"` / `"*"` with a specific version range; commit the lock |
| `rce` (eval) | Refactor | Replace dynamic execution with a static dispatch table or rejected as out-of-scope (surface as `severity: blocking`, ask the user) |
| `prototype-pollution` | Key allowlist | Add `__proto__`/`constructor`/`prototype` filter before `Object.assign` / merge |
| `xss` (dangerouslySetInnerHTML) | DOMPurify wrap | Wrap the expression in `DOMPurify.sanitize(...)` |
| `xss` (innerHTML) | textContent | Replace `innerHTML =` with `textContent =`, or use a sanitized renderer |
| `xss` (markdown) | Sanitize pipeline | Add `rehypeSanitize` / `DOMPurify` after the markdown parser |
| `xss` (javascript:) | Scheme check | Reject the URL before render if its scheme isn't `http`/`https`/`mailto`/`tel` |
| `payments` | Per-finding manual | Payment-flow changes always require manual review; never auto-apply |

For findings without a clean tag mapping, treat `properties.fix` as the literal change and apply it minimally.

#### 3. Plan the edits

For each approved finding, compute the minimal `Edit` operation. Group edits by file so the patch lands atomically per file.

**Hard rules:**

- **One approval, one fix.** Per-finding approval is non-negotiable — never batch security fixes under a single "approve all" prompt.
- **Never rewrite a file wholesale** unless the finding explicitly authorizes it.
- **Never enforce a fix that goes beyond the finding.** A SQL-injection fix at line 42 doesn't license refactoring auth at line 80.
- **Removed code goes completely.** Per Commandment 7: no `// removed` markers, no orphaned imports, no commented-out blocks.
- **No scope creep.** If a fix surfaces an adjacent vulnerability, log it as a new finding for the next audit — don't fix it in this pass.
- **Test the negative path.** Where the language permits, add or update a test that triggers the previously-vulnerable input and confirms the new behavior rejects it. Tag the test `regression:security`.

#### 4. Show the plan

Before applying, output the planned edits as a unified diff or per-file edit list. For an omnibus-dispatched run with prior per-finding approval, proceed directly to step 5. For direct invocation, stop here and wait for the user.

#### 5. Apply edits

Apply edits one finding at a time. Order:

1. **Blocking findings first** (RCE, SQL injection, hardcoded secrets) — these are exploit paths; reduce attack surface before lower-severity work.
2. **Same-file edits in reverse line order** within a finding group so earlier-line edits don't shift later-line references.
3. **Cross-file edits in dependency order** (move helpers first, then update callers).

After each finding is fully applied, re-check the file against the relevant `security/RULES.md` rule to confirm the remediation closed the finding.

#### 6. Verify

Run `gate("security")` first, then `gate("code")` from `VERIFICATION.md`. `gate("security")` runs `security-review --mode audit --module <touched-files>` to confirm zero remaining findings in scope.

The skill MUST NOT claim done until **both** gates are green.

If `gate("security")` reports a new finding introduced by the fix:

- Identify which fix introduced it.
- Revert that fix and surface the new finding (likely `severity: blocking`, `tag: regression`).
- Never silence the audit to make the gate pass.

If `gate("code")` fails:

- Identify which fix likely broke the test.
- Revert that fix and surface a new finding, OR adjust the fix (keeping the security property intact) and re-run.
- Never silence a failing test or weaken the security property to make the gate pass.

For changes that touch `src/ui/**`, also call `gate("design")`.

#### 7. Summarize

One paragraph: which findings were resolved, which files were touched, which findings were skipped (and which approval was withheld), what regression tests were added, and what (if anything) the user should still review by eye.

### Fix output template

```
[plan]
Approved: <N> of <M> findings (per-finding approval)
Skipped:  <list with reasons>

... edit list, grouped by finding ...
[/plan]

[applying]
... per-finding lines, each followed by per-finding re-check ...
[/applying]

[verify]
scope:      <files edited>
method:     gate("security") (security-review --mode audit --module <files>) && gate("code")
assertions: zero remaining findings in scope; full test suite passes; regression tests added for <list>
[/verify]

# Summary
- <N> findings resolved (of <M> approved)
- <K> files edited
- <P> regression tests added
- <Q> findings skipped (with reasons)
- Manual review suggested: <files>
```

---

## Scope discipline (audit mode)

- **Read-only.** No `Edit`, `Write`, or mutating `Bash`. Bash for `git diff`, `grep`, `find` only.
- **No `Skill()` calls.** The omnibus chains; we audit.
- **No verification gate.** Audit is non-mutating; `gate("security")` runs when fix mode finishes applying remediations.
- **Every finding requires per-finding approval.** The audit produces findings; the omnibus enforces approval; fix mode never auto-applies without it.

## Guardrails (both modes)

- **Per-finding approval is non-negotiable.** No "approve all" path. The omnibus enforces via `omnibus.yml` `approval.domain.security = per-finding`; direct invocation collects approval inline per finding. Tags `secret`, `auth`, `payments`, `rce`, `injection`, `crypto` are all explicitly `per-finding`.
- **Confidence is provisional.** Omnibus validation refines it. Security findings often need a second look — false positives matter.
- **Cite rules precisely.** Every finding includes `security/RULES.md#<section>.<n>` and at least one external-standard citation in `properties.frameworks`.
- **Don't double-report.** If `semgrep` / `eslint-plugin-security` / a SAST tool catches it natively, cite that tool and mark `severity: nit` to avoid duplicate noise.
- **Negative-filter is non-negotiable.** When in doubt about whether a category falls under the exclusion list, don't flag.
- **Verification is non-negotiable (fix mode).** Never claim done without green `gate("security")` AND `gate("code")` results in the turn's tool output.
- **Regression tests where possible (fix mode).** For every blocking fix, the suite should gain a test that triggers the previous vulnerable input and asserts the new behavior.
- **Minimal edits (fix mode).** Smallest change that closes the finding. No "while I'm here" security cleanup.
- **No silencing (fix mode).** Never disable the audit, lower a rule's severity, or add a lint-ignore to make a gate pass.
- **No `Skill()` calls.** The omnibus dispatches; we audit or apply.

## Cross-references

- Rule source: `src/rules/security/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
- External-standard references (loaded on demand): `src/rules/security/owasp-top-10.md`, `src/rules/security/cwe-top-25.md`
- Peer review skills: `code-review`, `design-review`, `docs-review`, `agent-review`
