---
name: code-review
description: Review TypeScript/JavaScript code under src/ against code-quality and security rules — scan, present findings, apply approved fixes, verify with the test suite. Walks src/rules/code/RULES.md (A type safety, B AI slop, C duplication, D drift, E test coverage, F architectural fit, G performance, H error handling, I complexity, J cleanup non-goals) plus src/rules/security/RULES.md (OWASP/CWE/NIST/ASVS/MITRE-ATT&CK mappings). Security findings require per-finding approval. Covers slop removal (dead code, pass-through wrappers, deeply nested conditionals, swallowed catches, band-aid guards, style drift, boolean flag params, placeholder narration, unicode hazards), simplification (complexity thresholds, single-use helpers, scope creep), consolidation, propagation, structural restructure, and security remediation. For forward-looking architectural redesigns (module deepening, interface alternatives, RFC issues), see `code-suggest`. Triggers on /code-review, /audit code, /audit security, "review the diff", "audit my code", "audit the code", "fix the findings", "apply the audit fixes", "deslop", "remove slop", "simplify this", "simplify before commit", "simplify code", "clean up code", "clean this up", "remove boilerplate", "too much boilerplate", "over-engineered", "unnecessary comments", "swallowed errors", "silent fallback", "band-aid guard", "dead code", "unused exports", "unused imports", "deep nesting", "deeply nested", "nested conditionals", "needless abstraction", "pass-through wrapper", "single-use helper", "style drift", "consolidate", "deduplicate", "refactor this", "restructure the code", "security audit", "audit for vulnerabilities", "scan for security issues", "find vulnerabilities", "fix the vulnerabilities", "remediate", "OWASP", "CWE", "ASVS", "SQL injection", "XSS", "XXE", "SSRF", "IDOR".
---

# code-review

Scans TypeScript/JavaScript under `src/` against the code-quality and security rule families, presents findings grouped by severity, asks per-finding for security issues, applies approved fixes, runs `bun test.ts`.

<!-- BEGIN: orchestration -->

## Process

1. **Scope.** `git diff --name-only $(git merge-base HEAD main)..HEAD`. If empty on clean main, fall back to `--since HEAD~10`; if still empty, scope defaults to the entire codebase — every file matching the Domain table below. Pass `--module <path>` to narrow.
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

- Rules: `src/rules/code/RULES.md` (sections A–J), `src/rules/security/RULES.md`
- Gate: `bun test.ts`
- Exclude: `src/ui/**` (use `design-review`), `*.generated.ts`, `.worktrees/**`
- Security findings cite `security/RULES.md#<anchor>` and attach OWASP / CWE / NIST / ASVS / MITRE-ATT&CK inline. They route through step 5's per-finding path with no bulk-approval option.
- Fix shapes:
  - **Slop removal** — defensive code (B.1), restating comments (B.2), backwards-compat shims (B.3), scope creep (B.4), impossible-case throws (B.5), three-lines abstraction (B.6), `as any` casts (A.1), dead code (B.7), placeholder narration / orphan TODOs / unicode hazards (B.8), pass-through wrappers / single-use helpers (B.9), deeply nested conditionals (B.10), band-aid guards / silent fallbacks (B.11), local-file style drift (B.12), boolean flag params (B.13)
  - **Complexity reduction** — function length / nesting depth / param count thresholds (I.1–I.3)
  - **Consolidation** onto a canonical helper (C.1, C.2)
  - **Propagation** from a reference file to peers (D.1, D.2)
  - **Structural restructure** — file moves with the importer-update matrix (F.1)
  - **Security remediation** — parameterise SQL, swap weak crypto, route secrets through env, add ownership checks
- **Cleanup non-goals** (J.1–J.6): don't redesign architecture, rename APIs, remove invariant-encoding comments, change formatting, remove validation at trust boundaries, or remove dead code that's public API / test utility / contract-required. For forward-looking architectural redesigns, route to `code-suggest`.
