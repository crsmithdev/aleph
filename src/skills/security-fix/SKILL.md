---
name: security-fix
description: >
  Apply remediations for security-audit findings — parameterize SQL, swap weak
  crypto, replace `Math.random()` with CSPRNG, wrap user input in DOMPurify,
  delete hardcoded secrets and route through env, add ownership checks to IDOR
  routes, etc. Takes SARIF findings from `security-audit` as input. Every
  finding requires explicit per-finding approval — no "approve all" path.
  Verifies with `gate("security")` + `gate("code")`. Triggers on "fix the
  vulnerabilities", "remediate", "/security-fix", "/fix security", or when
  the omnibus dispatches the fix verb to the security domain after approval.
verb: fix
domain: security
modes: [fix]
---

# Security Fix

Applies edits derived from `security-audit` findings. Each finding's `properties.fix` describes the remediation; this skill executes it minimally and verifies with the appropriate gates. Security is the strictest domain — every finding requires individual approval, even when grouped.

Pure leaf: no `Skill()` calls. The omnibus chains audit → per-finding approval → fix.

## When to use

- After `security-audit` produced findings and the user explicitly approved them, finding-by-finding.
- User invokes `/security-fix` against a saved SARIF report (still triggers per-finding approval before applying).
- User invokes `/fix security` via the omnibus.

## When NOT to use

- Code quality / slop / drift fixes → `code-fix`.
- Visual / layout / typography fixes → `design-fix`.
- Documentation fixes → `docs-fix`.
- When findings haven't been approved per-finding — re-run `security-audit` and route through the omnibus approval flow.
- For findings the audit produced with `severity: nit` and `tag: hardening` that don't represent a real exploit path — those can be deferred without prejudice.

## Inputs

1. **Findings** (required) — SARIF v2.1.0 from `security-audit`, either passed inline (omnibus path) or read from disk.
2. **Approvals** (required) — explicit per-finding approval. The omnibus enforces this; direct invocation must collect it from the user before each edit.
3. **Scope** — inherited from the audit findings; never expands beyond them.

## Process

### 1. Resolve findings

Parse the SARIF. Group by `properties.tag` (one tag → one fix shape). If `security-fix` is invoked directly without omnibus pre-approval, surface every finding and require the user to approve each one individually before proceeding. **Never apply a fix that lacks an explicit approval.**

### 2. Map tag → fix shape

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

For findings without a clean tag mapping, treat `properties.fix` as the literal change and apply it minimally.

### 3. Plan the edits

For each approved finding, compute the minimal `Edit` operation. Group edits by file so the patch lands atomically per file.

**Hard rules:**

- **One approval, one fix.** Per-finding approval is non-negotiable — never batch security fixes under a single "approve all" prompt.
- **Never rewrite a file wholesale** unless the finding explicitly authorizes it.
- **Never enforce a fix that goes beyond the finding.** A SQL-injection fix at line 42 doesn't license refactoring auth at line 80.
- **Removed code goes completely.** Per Commandment 7: no `// removed` markers, no orphaned imports, no commented-out blocks.
- **No scope creep.** If a fix surfaces an adjacent vulnerability, log it as a new finding for the next audit — don't fix it in this pass.
- **Test the negative path.** Where the language permits, add or update a test that triggers the previously-vulnerable input and confirms the new behavior rejects it. Tag the test `regression:security`.

### 4. Show the plan

Before applying, output the planned edits as a unified diff or per-file edit list. For an omnibus-dispatched run with prior per-finding approval, proceed directly to step 5. For direct invocation, stop here and wait for the user.

### 5. Apply edits

Apply edits one finding at a time. Order:

1. **Blocking findings first** (RCE, SQL injection, hardcoded secrets) — these are exploit paths; reduce attack surface before lower-severity work.
2. **Same-file edits in reverse line order** within a finding group so earlier-line edits don't shift later-line references.
3. **Cross-file edits in dependency order** (move helpers first, then update callers).

After each finding is fully applied, re-check the file against the relevant `security/RULES.md` rule to confirm the remediation closed the finding.

### 6. Verify

Run `gate("security")` first, then `gate("code")` from `VERIFICATION.md`. `gate("security")` runs `security-audit --module <touched-files>` to confirm zero remaining findings in scope.

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

### 7. Summarize

One paragraph: which findings were resolved, which files were touched, which findings were skipped (and which approval was withheld), what regression tests were added, and what (if anything) the user should still review by eye.

## Output

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
method:     gate("security") (security-audit --module <files>) && gate("code")
assertions: zero remaining findings in scope; full test suite passes; regression tests added for <list>
[/verify]

# Summary
- <N> findings resolved (of <M> approved)
- <K> files edited
- <P> regression tests added
- <Q> findings skipped (with reasons)
- Manual review suggested: <files>
```

## Guardrails

- **Verification is non-negotiable.** Never claim done without green `gate("security")` AND `gate("code")` results in the turn's tool output.
- **Per-finding approval is mandatory.** No "approve all" path. The omnibus enforces via `omnibus.yml` `approval.domain.security = per-finding`; direct invocation collects approval inline per finding.
- **Regression tests where possible.** For every blocking fix, the suite should gain a test that triggers the previous vulnerable input and asserts the new behavior.
- **Minimal edits.** Smallest change that closes the finding. No "while I'm here" security cleanup.
- **No silencing.** Never disable the audit, lower a rule's severity, or add a lint-ignore to make a gate pass.
- **No `Skill()` calls.** The omnibus dispatches; we apply.

## Cross-references

- Rule source: `src/rules/security/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Audit counterpart: `src/skills/security-audit/SKILL.md`
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
- External-standard references: `src/rules/security/owasp-top-10.md`, `src/rules/security/cwe-top-25.md`
