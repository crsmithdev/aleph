---
name: security-audit
description: >
  Audit TypeScript/JavaScript code under src/ against `src/rules/security/RULES.md`
  — exploitable vulnerabilities, not code quality. Covers injection, auth/authz,
  data exposure, crypto, input validation, business logic, configuration, supply
  chain, code execution, and XSS. Emits SARIF findings (per
  `src/skills/_shared/finding.md`) with framework mappings to OWASP/CWE/ASVS.
  Read-only — no edits. Every finding requires per-finding approval before any
  fix dispatch. Triggers on "security audit", "audit for vulnerabilities",
  "scan for security issues", "/security-audit", "/audit security", "OWASP",
  "CWE", "find vulnerabilities", or when the omnibus dispatches the audit verb
  to the security domain.
verb: audit
domain: security
modes: [report]
---

# Security Audit

Walks code in scope, evaluates each rule in `src/rules/security/RULES.md`, and emits SARIF findings. Does **not** apply remediations — that's `security-fix`. Security is split from `code` for distinct rule sources (external standards), distinct audit cognition (exploitable vs sloppy), and a stricter approval policy (every finding requires per-finding sign-off).

Pure leaf: no `Skill()` calls. The omnibus chains us; we report.

## When to use

- User asks to audit the diff or a module for security issues.
- User invokes `/security-audit` directly, or `/audit security` via the omnibus.
- The omnibus dispatches the `audit` verb to the `security` domain.

## When NOT to use

- General code quality / slop / drift → `code-audit`.
- Visual / a11y / typography → `design-audit`.
- Documentation review → `docs-audit`.
- Fix-mode work (applying remediations) → `security-fix`.

## Inputs

1. **Scope** (default: smart — see below) — `--diff` against `origin/main`, `--module <path>`, `--since <git-ref>`, or `--all`.
2. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`. Security findings frequently warrant a lower threshold (60-70) on first pass; the validation step still applies.
3. **Include exclusions** (optional) — `--include dos,rate-limit` to override `omnibus.yml`'s default exclusion list for projects where those categories matter.

## Process

### 1. Resolve scope

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

### 2. Walk the rules

For each in-scope file, evaluate every section A through J in `src/rules/security/RULES.md`. Each rule's `Detect:` line specifies the signal (grep, structural check, or dataflow trace). Concrete examples of high-value checks:

- **A.1 (SQL injection):** grep template literals containing `${` inside the first argument of `db.query` / `db.exec` / `prisma.$queryRawUnsafe` / similar.
- **A.2 (shell injection):** grep `exec(\`` / `execSync(\`` / `spawn(\`` with interpolated arguments.
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

### 3. Apply negative-filter list

Per `src/rules/security/RULES.md` "Default exclusions" + the shared list in `src/skills/_shared/finding.md`:

- Denial of Service / rate limiting → drop unless `--include dos`
- Memory/CPU exhaustion → drop unless `--include exhaustion`
- Generic input validation without proven downstream impact → drop (covered by E.1 / E.4 only with a real consequence)
- Open redirect → drop unless tied to credential leak
- Detection evasion concerns → drop (not a defensive concern)
- Issues a linter would catch (`eslint-plugin-security`, `semgrep`) → cite the linter, mark `severity: nit` if including
- Lint-ignored lines → drop

The omnibus validation pass is the second line; this skill is the first.

### 4. Emit SARIF

Single SARIF v2.1.0 run with `tool.driver.name = "security-audit"`. Per `src/skills/_shared/finding.md`, each `result` has:

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
    "tag": "injection" | "auth" | "secret" | "pii" | "info-leak" | "crypto" | "validation" | "path-traversal" | "ssrf" | "toctou" | "race" | "misconfig" | "hardening" | "supply-chain" | "rce" | "prototype-pollution" | "xss",
    "scope": "diff" | "module" | "all",
    "frameworks": ["OWASP:A03:2025", "CWE-89", "ASVS:V5.3.4"]
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

`properties.frameworks` is the security-domain extension: an array of standard-citation strings so downstream consumers (compliance reports, SOC 2 evidence, security dashboards) can link findings to control frameworks without re-parsing the ruleId.

Security findings rarely qualify for `praise` — surface defensive patterns (parameterized queries, constant-time comparison, sanitized markdown renderer) only when the code solves a typical anti-pattern that peers in the same scope get wrong. Praise with `tag: defense-in-depth` and a propagation pointer in `fix`.

### 5. Emit a phased prose summary

After the SARIF block, output a phased report for human readers:

```
# Security Audit — <scope>

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

The omnibus reads the SARIF; humans read the prose. The "Excluded by default" section is unique to security-audit — it surfaces what was deliberately filtered so the user can opt in.

## Scope discipline

- **Read-only.** No `Edit`, `Write`, or mutating `Bash`. Bash for `git diff`, `grep`, `find` only.
- **No `Skill()` calls.** The omnibus chains; we audit.
- **No verification gate.** Audit is non-mutating; `gate("security")` runs when `security-fix` finishes applying remediations.
- **Every finding requires per-finding approval.** The audit produces findings; the omnibus enforces approval; `security-fix` never auto-applies without it.

## Output template

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Security Audit — <scope>
<phased prose>
```

When invoked by the omnibus, return the SARIF as the structured result; the omnibus assembles the cross-domain phased report and routes per-finding approval prompts.

## Guardrails

- **Confidence is provisional.** Omnibus validation refines it. Security findings often need a second look — false positives matter.
- **Cite rules precisely.** Every finding includes `security/RULES.md#<section>.<n>` and at least one external-standard citation in `properties.frameworks`.
- **Don't double-report.** If `semgrep` / `eslint-plugin-security` / a SAST tool catches it natively, cite that tool and mark `severity: nit` to avoid duplicate noise.
- **Per-finding approval is non-negotiable.** No "approve all" path. The omnibus enforces this via `omnibus.yml` `approval.domain.security = per-finding`.
- **Negative-filter is non-negotiable.** When in doubt about whether a category falls under the exclusion list, don't flag.

## Cross-references

- Rule source: `src/rules/security/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Fix counterpart: `src/skills/security-fix/SKILL.md`
- Orchestrator: `src/skills/omnibus/SKILL.md`
- External-standard references (loaded on demand): `src/rules/security/owasp-top-10.md`, `src/rules/security/cwe-top-25.md`
