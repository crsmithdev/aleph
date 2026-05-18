---
name: code-review
description: Review TypeScript/JavaScript code under src/ against code-quality and security rules — scan, present findings, apply approved fixes, verify with the test suite. Walks src/rules/code/RULES.md plus src/rules/security/RULES.md (OWASP/CWE/NIST/ASVS/MITRE-ATT&CK mappings). Security findings require per-finding approval. Triggers on /code-review, /audit code, /audit security, "review the diff", "audit my code", "audit the code", "fix the findings", "apply the audit fixes", "deslop", "clean up code", "remove boilerplate", "consolidate", "deduplicate", "refactor this", "restructure the code", "security audit", "audit for vulnerabilities", "scan for security issues", "find vulnerabilities", "fix the vulnerabilities", "remediate", "OWASP", "CWE", "ASVS", "SQL injection", "XSS", "XXE", "SSRF", "IDOR".
---

# code-review

Scans TypeScript/JavaScript under `src/` against the code-quality and security rule families, presents findings grouped by severity, asks per-finding for security issues, applies approved fixes, runs `bun test.ts`.

<!-- BEGIN: orchestration -->

## Process

1. **Scope.** `git diff --name-only $(git merge-base HEAD main)..HEAD`. If empty on clean main, fall back to `--since HEAD~10`; if still empty, exit `scope empty — pass --all or --module <path>`.
2. **Scan** the rules in Domain below. For each hit: file:line, rule cite, one-line message, fix, severity (blocking / important / nit / suggestion / praise).
3. **Re-read** each cited location. Drop false positives.
4. **Report** grouped by severity. One line per finding: `path:line — rule — message. Fix: ...`.
5. **STOP. Ask.** Security findings (secrets, auth, injection, crypto, RCE, IDOR, SSRF, XSS) → one at a time, no bulk path. Otherwise: apply all / pick / discard.
6. **Apply** approved fixes.
7. **Gate.** Run the command in Domain. On failure: report as a new blocking finding, stop.
8. **Closing:** `Applied N. Touched M files. Gate green. Skipped: <list>.`

## Guardrails

- Leaves never call `Skill()`.
- Nothing edits before step 5.
- No green closing without a green gate.

<!-- END: orchestration -->

## Domain

- Rules: `src/rules/code/RULES.md`, `src/rules/security/RULES.md`
- Gate: `bun test.ts`
- Exclude: `src/ui/**` (use `design-review`), `*.generated.ts`, `.worktrees/**`
- Security findings cite `security/RULES.md#<anchor>` and attach OWASP / CWE / NIST / ASVS / MITRE-ATT&CK inline. They route through step 5's per-finding path with no bulk-approval option.
- The five fix shapes — slop removal (defensive code, restating comments, backwards-compat shims, scope creep, impossible-case throws, `as any` casts), consolidation onto a canonical helper, propagation from a reference file to peers, structural restructure (file moves with the importer-update matrix), and security remediation (parameterise SQL, swap weak crypto, route secrets through env, add ownership checks) — are applied per `properties.tag` in the rule cite. The rules file describes each.
