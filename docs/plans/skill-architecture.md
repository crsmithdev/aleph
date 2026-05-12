# Skill Architecture — Verb × Domain Matrix with Omnibus Orchestration

## Framing

The current skill set (13 skills as of 2026-05) has accumulated three kinds of drag:

1. **Structural duplication** — the three `*-conform` skills share an ~80% identical 7-step process; the only real differences are domain-specific pattern dimensions and the verification gate.
2. **Overlapping audit scope** — `design-audit`, `design-standards`, and `design-type` all check the design surface with intersecting dimensions; `code-review` and `code-simplify` overlap on "over-engineering"; `docs-audit` already invokes `docs-conform` and `docs-optimize` internally, making it an implicit omnibus.
3. **No way to run a comprehensive pass** — users wanting a full codebase review run each skill individually with no consolidation, no dedup, no shared phasing.

This document defines a target architecture that:

- **Eliminates the duplication** by extracting the shared spine into reference files leaf skills load.
- **Makes the matrix explicit** so every domain has a uniform set of capabilities (audit / fix / author / suggest).
- **Adds an omnibus orchestrator** as the *only* place skills chain — leaf skills become pure.
- **Standardizes the contract** between leaves and omnibus on SARIF.
- **Borrows validated patterns** from Kubernetes (verb × resource), LangGraph (supervisor), Anthropic's official `code-review` plugin (validation pass, confidence scoring), and the `awesome-skills/code-review-skill` (6-tier severity, progressive disclosure).

It is a design, not a migration plan. A migration sequence is sketched at the end.

---

## 1. The matrix

Skills are organized along two axes: **verb** (what kind of operation) × **domain** (what target).

### Verbs

| Verb | Purpose | Output | Cognitive frame |
|---|---|---|---|
| **audit** | Find findings against the domain's `RULES.md` | SARIF findings, phased report | "What violates the rules?" |
| **fix** | Apply changes for approved findings (slop removal, consolidation, drift conformance, restructure) | Edits, then `gate(<domain>)` verification | "Resolve the named findings minimally" |
| **author** | Apply rules silently while creating a new artifact | The new artifact, rule-conformant | "Generate correctly the first time" |
| **suggest** | Propose opportunities that don't violate rules but would be wins | Prioritized suggestions with leverage/effort | "What would be markedly better even though nothing is broken?" |

The cross-domain test: a verb is real only if it has a meaningful instance in **every** domain. `audit / fix / author / suggest` pass this test; `simplify / deduplicate / optimize` fail it (they're finding-classes within `audit`, not separate verbs).

### Domains

| Domain | Scope | Rules source |
|---|---|---|
| **code** | TypeScript/JS source, build config, runtime behavior | `code/RULES.md` + CLAUDE.md |
| **design** | UI surfaces, layout, typography, interaction, accessibility | `design/RULES.md` |
| **docs** | Markdown, READMEs, SKILL.md, AGENTS.md, SPEC.md | `docs/RULES.md` (already exists as `docs-author-v2/RULES.md`) |
| **skills** | SKILL.md files themselves — frontmatter, registry, triggers | `skills/RULES.md` |
| **hooks** | `settings-hooks.json` registrations + hook implementations | `hooks/RULES.md` |
| **agents** | Subagent definitions, triggers, tool whitelists | `agents/RULES.md` |
| **config** | CLAUDE.md, settings.json, MCP, AGENTS.md structure | `config/RULES.md` |
| **security** | OWASP/CWE/NIST/ASVS/MITRE-mapped vulnerabilities | `security/RULES.md` |

### The grid

| | code | design | docs | skills | hooks | agents | config | security |
|---|---|---|---|---|---|---|---|---|
| **audit** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **fix** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| **author** | — | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| **suggest** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**26 populated leaves; 6 deliberately empty.** Empty cells are intentional:

- `code-author` / `security-author` — authoring rules live in CLAUDE.md and apply silently every turn; no invocable skill needed.
- `config-fix` / `config-author` — config writes are schema-driven (agnix territory); `config-audit` finds problems but fixes are case-by-case.
- `security-author` — handled by `code-author` (i.e., CLAUDE.md rules) for write-time; no separate skill.

### Prior art for the matrix shape

The pattern is conventional in API design (Kubernetes' RBAC: `get/list/watch/create/update/patch/delete/deletecollection` × `pods/services/deployments/...`; REST's `GET/POST/PUT/PATCH/DELETE` × `/resource`; Rails resourceful actions × resources). The novelty is applying it to **AI agent skill organization** — every published Claude/Cursor/Codex skill taxonomy I surveyed (4200+ skills on the official marketplace; 7000+ packages on PRPM) is either flat-namespaced, role-based, or category-hierarchical. None is verb × domain typed.

---

## 2. Architectural rules

### R1. Only the omnibus invokes `Skill()`

Leaf skills consume **files** and **scripts** — never other skills. The omnibus is the only orchestrator. This mirrors Microsoft Copilot Studio's explicit constraint: *"Subagents cannot spawn their own subagents — don't include Task in a subagent's tools list."*

Consequence: every leaf is standalone-invocable with no hidden side effects. Cross-skill behavior is explicit and visible in the omnibus dispatch table.

### R2. Shared logic is shared via files, not skill invocations

The 7-step conform process that currently appears in `code-conform / design-conform / docs-conform` becomes a single `references/conform-process.md` that all three leaves read. Same for c7score scoring (currently invoked from `docs-audit` via `Skill('docs-optimize')` — becomes a script or reference doc).

### R3. Findings emitted in SARIF

Every leaf-skill audit emits SARIF v2.1.0 (OASIS standard). The omnibus reads SARIF; humans read the prose alongside. We do not invent a custom JSON shape — SARIF is the industry standard and lets the same finding stream be consumed by any SARIF-aware tool in the future.

### R4. Per-project verification gates loaded from `VERIFICATION.md`

Skills do not hardcode commands like `bun test.ts` or `bun run ui:smoke`. Each project has a `VERIFICATION.md` with a table:

```
| Domain | Gate command |
|---|---|
| code | bun test.ts |
| design | bun run ui:smoke |
| docs | markdown-lint && cross-ref-check |
| hooks | bun test.ts (hook subset) |
```

Leaves call `gate("code")`. Project-portable.

### R5. Author = rules in context, not (always) a skill

For most domains, authoring follows rules baked into CLAUDE.md and applies every turn — no invocation needed. Author **skills** exist only when there's a structured net-new artifact whose creation benefits from a checklist (a new doc family, a new hook, a new skill). `code-author` and `security-author` are deliberately empty; the rules live in CLAUDE.md.

### R6. Diff-aware by default

Every audit defaults to current-branch diff (`git diff --name-only origin/main...HEAD`). `--module <path>` narrows; `--all` widens. Both Anthropic's official `code-review` plugin and `claude-code-security-review` use diff-aware defaults — it dramatically cuts noise from pre-existing code.

---

## 3. The leaf-skill contract

### Structure

Every leaf skill follows the same shape:

```
src/skills/<domain>-<verb>/
├── SKILL.md                     # ~30-80 lines, frontmatter + brief process
├── references/                  # progressive-disclosure detail files
│   ├── <domain>-rules-<area>.md # loaded only when checking that area
│   └── ...
└── examples/                    # optional worked invocations
```

The SKILL.md frontmatter declares:

```yaml
---
name: code-audit
description: <triggering description per Claude Skills convention>
verb: audit
domain: code
modes: [report]                 # report | fix | scaffold
---
```

### Output: SARIF + prose

Audit leaves emit SARIF v2.1.0. Minimal shape:

```json
{
  "version": "2.1.0",
  "runs": [{
    "tool": { "driver": { "name": "code-audit", "version": "1.0.0" } },
    "results": [{
      "ruleId": "code/RULES.md#A.2",
      "level": "error",
      "message": { "text": "Hardcoded API key in source." },
      "locations": [{
        "physicalLocation": {
          "artifactLocation": { "uri": "src/foo.ts" },
          "region": { "startLine": 42, "endLine": 42 }
        }
      }],
      "properties": {
        "confidence": 92,
        "severity": "blocking",
        "fix": "Load from env via getEnv('KEY').",
        "tag": "secret"
      }
    }]
  }]
}
```

Alongside the SARIF, leaves emit a human-readable phased report for standalone runs. The omnibus reads the SARIF only.

### Severity (6 tiers, lifted from `awesome-skills/code-review-skill`)

| Tier | When |
|---|---|
| **blocking** | Compile/parse failure, certain wrong-result logic, exploitable vulnerability |
| **important** | Real bug or rule violation that should be fixed before merge |
| **nit** | Style/cosmetic issue; ignore unless cleaning a file already being edited |
| **suggestion** | Alternative worth considering |
| **learning** | Teaching note; the code is fine but there's a pattern worth knowing |
| **praise** | Code is notably well-done; surface it explicitly |

The `praise` tier matters — positive reinforcement is the most-skipped review behavior in AI-assisted workflows, and naming it as a finding class makes it intentional.

### Confidence (0-100, lifted from Anthropic's `code-review` plugin)

Every finding carries a numeric confidence:

| Score | Read |
|---|---|
| 0 | Not confident, likely false positive |
| 25 | Somewhat confident, might be real |
| 50 | Moderately confident, real but minor |
| 75 | Highly confident, real and important |
| 100 | Absolutely certain |

The omnibus filters by threshold (default 80). `--threshold 60` widens the report for exhaustive runs.

### Guardrails (uniform across all audit leaves)

Lifted from Anthropic's plugin — strong negative-filter list. **DO NOT FLAG:**

- Code style or quality concerns (unless required by RULES.md)
- Potential issues depending on inputs/state not in scope
- Subjective suggestions presented as bugs
- Pre-existing issues outside the audit window
- Pedantic nitpicks
- Issues a linter would catch (cite agnix/eslint/etc. instead)
- Issues silenced by lint-ignore comments

These exclusions eliminate the bulk of audit-noise.

---

## 4. The omnibus

### Invocation

```
/audit                       → all domains, audit verb
/audit code                  → row slice
/audit code design           → multi-domain slice
/audit --module src/foo      → narrowed scope
/fix                         → fix verb (requires prior findings)
/fix --auto                  → auto-approve docs-level findings, single-approval for code
/suggest                     → suggest verb (proactive)
/audit --threshold 60        → widen to lower-confidence findings
/audit --all                 → full codebase, not just diff
```

### Registry

`omnibus/registry.json` mirrors the matrix:

```json
{
  "audit": {
    "code": "code-audit",
    "design": "design-audit",
    "docs": "docs-audit",
    "skills": "skills-audit",
    "hooks": "hooks-audit",
    "agents": "agents-audit",
    "config": "config-audit",
    "security": "security-audit"
  },
  "fix": { "...": "..." },
  "author": { "...": "..." },
  "suggest": { "...": "..." }
}
```

Empty cells skipped silently with a "Skipped: <reason>" line in the report.

### Process

1. **Resolve.** Parse verb + domain slice + scope. Look up leaves in registry. Skip empty cells.
2. **Pre-flight.** Cheap Haiku-class check: skip if PR is closed/draft/trivial/already-reviewed (when invoked against a PR). Per Anthropic's `code-review` plugin pattern.
3. **Fan out.** Spawn one subagent per leaf, in parallel. Pass scope + reference + `mode=report-only` (always read-only first). Subagent contract: emit SARIF.
4. **Validation pass.** For each candidate finding, a separate validator subagent assigns confidence 0-100 and decides whether it survives. Per Anthropic's plugin: this is the mechanism behind low false-positive rates.
5. **Merge + dedupe.** Collect SARIF runs. Dedupe on `(file, region, ruleId)` — keep the most specific. Cross-skill collisions resolved by preferring the leaf with the more specific rule cite.
6. **Filter.** Drop findings below threshold (default 80).
7. **Phase.** Group by severity (blocking → important → nit → suggestion → learning → praise), then by domain, then by skill.
8. **Report.** One phased document. Each finding tagged with originating skill, rule cite, confidence, suggested fix.
9. **Approval gate (risk-tiered).** Per Anthropic 2026 Agentic Coding Trends report:
   - **Docs / nit / praise** — auto-approve unless user disables.
   - **Code, design, skills, hooks, agents** — single approval (all / by phase / by domain / individual).
   - **Security, auth, payments, infrastructure** — always human-review, per finding.
10. **Fix dispatch (fix verb only).** Route each approved finding to `<domain>-fix` with the SARIF result as input. Parallel within a phase; sequential across phases. After each phase, run `gate(<domain>)` for every touched domain. No phase advances until green.

### Form

The omnibus is invoked as a slash command (`/audit`, `/fix`, `/suggest`) inside Claude Code. SARIF output is captured to a file under the project for review and replay. Out-of-band invocation (CLI / CI) is out of scope for v1; nothing in the architecture precludes it later, but it isn't a deliverable.

---

## 5. Configuration: `omnibus.yml`

Per-project config (per MegaLinter's `.mega-linter.yml` convention):

```yaml
# omnibus.yml — project root
version: 1

defaults:
  scope: diff                      # diff | module | all
  threshold: 80                    # 0-100 confidence floor
  phases: [blocking, important]    # default phases to report

active:
  audit: [code, design, docs, hooks, security]
  fix:   [code, design, docs, hooks]
  suggest: [code, design, docs]
  # author skills are invoked directly, not orchestrated

leaves:
  code-audit:
    rules: code/RULES.md
    exclude:
      - "src/legacy/**"
      - "*.generated.ts"
  design-audit:
    rules: design/RULES.md
    references: [design/RULES-react.md, design/RULES-typography.md]
  security-audit:
    rules: security/RULES.md
    framework_mappings: [OWASP, CWE, NIST-CSF, ASVS]

verification:
  code: bun test.ts
  design: bun run ui:smoke
  docs: bun run docs:check
  hooks: bun test src/core/hooks

approval:
  docs:    auto
  nit:     auto
  praise:  auto
  code:    single
  design:  single
  hooks:   single
  agents:  single
  config:  single
  security: per-finding
  auth:    per-finding
  payments: per-finding
```

CLI flags layer on top: `/audit --threshold 60 --all` overrides `omnibus.yml`'s defaults for that run.

---

## 6. Rules files per domain

Each domain has a `<domain>/RULES.md` shared between `audit` (post-hoc check) and `author` (write-time enforcement). Same rules; two execution modes.

```
src/rules/
├── code/
│   ├── RULES.md                    # primary rule set, sectioned by area
│   ├── react.md                    # framework-specific guides (progressive disclosure)
│   ├── typescript.md
│   └── ...
├── design/
│   ├── RULES.md
│   ├── typography.md
│   ├── accessibility.md
│   └── ...
├── docs/
│   └── RULES.md                    # existing docs-author-v2/RULES.md moves here
├── security/
│   ├── RULES.md
│   ├── owasp-top-10.md
│   ├── cwe-top-25.md
│   ├── nist-csf.md
│   └── asvs.md
└── ...
```

Rule citations in findings reference `<domain>/RULES.md#<section>` so they're machine-locatable.

---

## 7. Security domain — scoping

Security is split from `code` because:

1. **Distinct rule sources.** OWASP Top 10, CWE Top 25, NIST CSF 2.0, ASVS 5.0, MITRE ATT&CK, SOC 2, ISO 27001:2022 — these are maintained external standards, not project conventions.
2. **Different audit cognition.** Code-audit catches "this is sloppy"; security-audit catches "this is exploitable." Different reasoning, different tolerances.
3. **Different approval policy.** Security findings always require human review, never auto-approval.

`security-audit` checks (lifted from Anthropic's `claude-code-security-review`):

| Category | Examples |
|---|---|
| Injection | SQL, command, LDAP, XPath, NoSQL injection, XXE |
| Auth / authz | Broken auth, privilege escalation, IDOR, bypass |
| Data exposure | Hardcoded secrets, PII logging, sensitive data in errors |
| Crypto | Weak algorithms, improper key management, weak RNG |
| Input validation | Missing validation, improper sanitization, buffer overflow |
| Business logic | Race conditions, TOCTOU |
| Configuration | Insecure defaults, missing security headers |
| Supply chain | Vulnerable dependencies, suspicious additions |
| Code execution | RCE via deserialization, pickle, eval |
| XSS | Reflected, stored, DOM-based |

Default exclusions (also lifted): DoS, rate-limiting, memory/CPU exhaustion, generic input validation without proven impact, open redirects — these are noise generators in practice.

---

## 8. Migration from the current 13 skills

| Current skill | New leaf | Notes |
|---|---|---|
| `code-review` | `code-audit` | Drop §6's slop overlap with code-simplify; cite explicitly. Adopt validation pass + 0-100 confidence. |
| `code-simplify` | `code-audit` (find) + `code-fix` (write) | Split into audit and fix halves; the "find slop" half emits findings, the "remove slop" half is one of code-fix's shapes. |
| `code-conform` | `code-audit` (with reference) + `code-fix` (consolidate) | Reference becomes an optional audit input. |
| `code-refactor` | `code-fix` (restructure shape) | One of code-fix's fix shapes. |
| `design-audit` | `design-audit` | Keep. Drop the typography and accessibility *rows* from the 15-dimension table; they become references to `design/typography.md` and `design/accessibility.md`. |
| `design-standards` | `design/accessibility.md` + `design/RULES.md` | Folded into `design-audit` as a reference file. |
| `design-type` | `design/typography.md` (audit) + `design-author` (enforcement) | Folded; enforcement mode becomes `design-author`. |
| `design-conform` | `design-fix` (drift shape) | One of design-fix's shapes. |
| `docs-audit` | `docs-audit` | Keep. Remove the `Skill('docs-optimize')` and `Skill('docs-conform')` calls — they become finding tags (`tag: c7score`, `tag: peer-drift`) that the omnibus routes to follow-up leaves. |
| `docs-optimize` | `docs/c7score.md` (audit) + `docs-fix` (optimize shape) | c7score becomes a script or reference; the optimization edits become one of docs-fix's shapes. |
| `docs-conform` | `docs-fix` (drift shape) | One of docs-fix's shapes. |
| `config-audit` | `config-audit` | Keep. Split out hook-specific checks into a new `hooks-audit` (it already has the structure for that). |
| `verify-completion` | Stays as-is | Stop-hook gate; not invocable; excluded from omnibus dispatch. |

**Net change:** 13 skills → 26 leaves, but each leaf is much smaller (target: ~30-80 lines per SKILL.md, with detail in reference files that load on demand per Claude Skills' progressive disclosure pattern). Total surface area is similar; structure is uniform; the omnibus is new.

---

## 9. Sample omnibus run

```
$ /audit --module src/research

[omnibus] verb=audit, scope=src/research/
[omnibus] dispatching in parallel: code-audit, design-audit, docs-audit, hooks-audit, security-audit
[omnibus] (skipped: skills-audit, agents-audit, config-audit — no matching artifacts under scope)

[omnibus] preflight: PR open, non-draft, 12 commits, no prior review — proceeding

  [code-audit]    14 candidates (4.2s)
  [design-audit]   4 candidates (3.8s)
  [docs-audit]     8 candidates (5.1s)
  [hooks-audit]    0 candidates (0.6s)
  [security-audit] 2 candidates (6.4s)

[omnibus] validation pass: 28 candidates → 19 confirmed at threshold 80

[omnibus] merging: 19 confirmed → 17 after dedup

# Omnibus Audit — src/research/
Date: 2026-05-12

## Summary
audit ran across [code, design, docs, hooks, security]
3 blocking · 6 important · 4 nit · 3 suggestion · 0 learning · 1 praise

## BLOCKING

[security-audit] src/research/providers/openai.ts:34 — security/RULES.md#A03-injection — confidence 96
  API key read from process.env directly; bypasses central getEnv() that masks in logs.
  Fix: route through getEnv("OPENAI_API_KEY"). [tag: secret]
  → Approval: per-finding (security domain)

[code-audit] src/research/engine/runner.ts:128 — code/RULES.md#C-duplication — confidence 91
  Inline `name.slice(5).split("__")` — same parse appears in 4 files; canonical helper exists at utils/format.ts:fmtToolName.
  Fix: replace inline parse with import + call. [tag: drift]
  → Approval: single (code domain)

[docs-audit] src/research/README.md:22 — docs/RULES.md#E-drift — confidence 88
  Claim "providers fall back automatically" — code in providers/index.ts:88 shows fallback was removed in c038e38.
  Fix: remove the claim, or restore the behavior. [tag: drift]
  → Approval: single (docs domain)

## IMPORTANT
[...]

## PRAISE

[design-audit] src/research/ResearchQueryDetailPage.tsx — design/RULES.md#L-state-coverage — confidence 95
  Loading, empty, and error states are all explicitly handled — the file is a good reference for design-fix to align peers against.

---
Approve: [all] / [by phase] / [by domain] / [individual]
```

---

## 10. Open questions and deferred work

These are not blockers for v1 but should be tracked:

1. **Graph-index audit (Greptile v3 pattern).** For cross-file findings (drift, duplication, dead code), a code-graph index gives much better recall than per-file scans. Worth exploring after v1 ships. Built on Claude Agent SDK in Greptile's case.
2. **Marketplace install vs. reimplementation.** Several skills exist on the Claude plugin marketplace that overlap with our leaves (`/security-review`, Anthropic's `code-review` plugin, `great_cto`'s SDLC pipeline). v1 should default to our own leaves but be installable side-by-side; reach for the marketplace skill if ours misses something.
3. **`praise` finding generation.** Reliably generating `praise` findings from a model trained to find faults is non-trivial. May need an explicit prompt addition: "find one thing that's especially well done, separately."
4. **Author-mode CLAUDE.md surface area.** As more domains gain `author` skills, the CLAUDE.md rule footprint grows. May need to load `<domain>/RULES.md` on demand instead of inline.
5. **Cross-project portability.** This design assumes a single Construct-style project. To ship as a plugin to other repos, `omnibus.yml` defaults + per-project `VERIFICATION.md` must be enough; verify on at least one non-Construct repo.

---

## 11. Recommended migration sequence

1. **Phase 1 — Foundation.** Write `omnibus.yml` schema, `VERIFICATION.md` for this repo, the SARIF finding contract, `references/finding.md`. No skill changes yet.
2. **Phase 2 — Rules consolidation.** Create `src/rules/<domain>/RULES.md` for each domain. Move `docs-author-v2/RULES.md` content into `src/rules/docs/RULES.md`. Author the missing ones (`code`, `design`, `security` first; `skills`, `hooks`, `agents`, `config` after).
3. **Phase 3 — One vertical, end-to-end.** Build `code-audit` + `code-fix` + omnibus dispatch for the code domain only. Run on this repo. Compare findings against Anthropic's `code-review` plugin (installed side-by-side). Iterate until the vertical is clean.
4. **Phase 4 — Replicate for design and docs.** Apply the v1 pattern to design and docs domains. These have the most existing skills to consolidate.
5. **Phase 5 — Fill in security.** New domain; build `security-audit` + `security-fix` against OWASP/CWE rules.
6. **Phase 6 — Fill in skills, hooks, agents, config.** These are Construct-specific and mostly net-new audit content.

Each phase is mergeable on its own. Phases 3-6 are independent vertical slices and can run in parallel if a team wants. Out-of-band invocation (CLI / CI) is deliberately out of scope; v1 is a slash-command-only architecture.
