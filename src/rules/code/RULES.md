# Code Rules

Canonical rule set for the code domain. Read by:

- `src/skills/code-audit/SKILL.md` — flags violations in existing code (post-hoc)
- `src/skills/code-fix/SKILL.md` — applies fixes for violations
- CLAUDE.md (project-local + global) — applies these rules silently at write-time

Every rule is **checkable**: it can be evaluated against a real diff and produce a SARIF finding (per `src/skills/_shared/finding.md`). Philosophical guidance lives in CLAUDE.md, not here.

Scope: TypeScript / JavaScript source under `src/` (excluding `src/ui/` for visual concerns — see `design/RULES.md`). Also covers `install.ts`, `test.ts`, `dev-server.ts` at the repo root.

---

## A. Type safety

*Sources: `src/skills/code-review/SKILL.md` §1, CLAUDE.md "Commandments" §1 (nothing fails silently).*

### A.1 No `any` to bypass type errors

Casting to `any` to silence a type checker error is forbidden. Either narrow the type properly or use `unknown` with explicit narrowing.

- **Detect:** `as any` outside of `JSON.parse` results or genuinely-untyped third-party boundaries
- **Severity:** `important`
- **Tag:** `slop`

### A.2 Explicit return types on top-level functions

Every exported function and every top-level function in a module has an explicit return type annotation. Inferred returns are fine for arrow callbacks and inner helpers; not for the function names that show up in import statements.

- **Detect:** exported functions without `: TypeName` between `)` and `{`
- **Severity:** `nit`
- **Tag:** `style`

### A.3 No implicit `undefined` in unions

Union types must list `undefined` explicitly when it's a valid value: `string | undefined`, not relying on `T?` or optional chaining swallowing the case.

- **Detect:** function returns that can be `undefined` without saying so in the return type
- **Severity:** `important`
- **Tag:** `correctness`

### A.4 No `// @ts-ignore` or `// @ts-expect-error` without justification

If a TypeScript error must be suppressed, the suppression comment carries a one-line reason. Bare `// @ts-ignore` is forbidden.

- **Detect:** `@ts-ignore` or `@ts-expect-error` without a following comment fragment
- **Severity:** `important`
- **Tag:** `slop`

---

## B. AI slop

*Sources: `src/skills/code-simplify/SKILL.md` "AI Slop Patterns", global CLAUDE.md "Doing tasks", Construct CLAUDE.md "Commandments" §2, §7.*

### B.1 No defensive code for impossible cases

Internal code does not validate scenarios that the type system or framework guarantees away. Only system boundaries (user input, external APIs) warrant input validation. Forbidden: try/catch around code that cannot throw; null checks on guaranteed-non-null variables; "just in case" runtime checks.

- **Detect:** try/catch with no rethrow on internal helpers; redundant typeof/instanceof guards
- **Severity:** `important`
- **Tag:** `slop`

### B.2 No comments restating the code

Comments are for the *why* — hidden constraints, invariants, workarounds, surprising behavior. Comments that say what well-named code already says are forbidden.

- **Detect:** single-line comments whose text is a paraphrase of the next line's identifiers
- **Severity:** `nit`
- **Tag:** `slop`

### B.3 No backwards-compat shims for code under active development

Forbidden in this repo: renamed `_unused` parameter prefixes, re-exports of moved symbols, `// removed: X` markers, deprecated aliases that nothing reads. If you remove something, remove it completely (CLAUDE.md Commandment 7).

- **Detect:** `_` prefix on parameters that are never read; `// removed` comments; re-export lines with no current importer
- **Severity:** `important`
- **Tag:** `slop`

### B.4 No scope creep

Changes do only what was requested. Forbidden: adjacent refactoring, "improvements" to unchanged code, added docstrings on functions that weren't touched, type annotations applied to drive-by lines.

- **Detect:** diff hunks where the changed line is functionally equivalent to its predecessor (cosmetic-only) outside the requested change area
- **Severity:** `important`
- **Tag:** `slop`

### B.5 No error handling for scenarios that can't happen

`if (!user) throw new Error("user is required")` inside a function whose caller already guarantees `user` is set — forbidden. Trust internal contracts.

- **Detect:** `throw` on conditions the type system already enforces
- **Severity:** `important`
- **Tag:** `slop`

### B.6 Three similar lines beat a premature abstraction

If a helper exists only to dedupe three lines, the helper is wrong. Wait until the duplication is real (five+ sites, varied call shapes) before abstracting.

- **Detect:** helper functions with ≤3 call sites and a body of ≤5 lines
- **Severity:** `suggestion` (judgment call, not a violation)
- **Tag:** `slop`

---

## C. Duplication

*Sources: `src/skills/code-conform/SKILL.md` "Single-source-of-truth consolidation".*

### C.1 No inline reimplementation of an existing helper

When a helper exists for a recurring operation, every site calls the helper. Inline reimplementations are forbidden.

- **Detect:** grep for distinctive substrings of helper bodies elsewhere in the codebase
- **Severity:** `important`
- **Tag:** `drift`

### C.2 Five or more identical patterns become a helper

When the same shape appears in five+ places, lift it to a shared helper. Until then, leave it inline (per B.6).

- **Detect:** AST-similar function bodies; cluster analysis on identical signatures
- **Severity:** `suggestion`
- **Tag:** `drift`

---

## D. Drift

*Sources: `src/skills/code-conform/SKILL.md` (conform = drift detection + fix).*

### D.1 Peer files share their canonical shape

When the user names a reference (a file, function, or recent edit), peer files in the same family must match it along structural, compositional, behavioral, and surface dimensions. Incidental differences (domain-specific names) are preserved.

- **Detect:** invoked with a reference; peer files diverge along chosen dimensions
- **Severity:** `important`
- **Tag:** `drift`

### D.2 Intentional divergence is marked

A peer that intentionally differs from its family carries `// conform:exempt` (single-line) or a comment block explaining why. Unmarked divergence is treated as drift.

- **Detect:** peer file flagged drifted but no exemption comment present
- **Severity:** `nit`
- **Tag:** `drift`

---

## E. Test coverage

*Sources: `src/skills/code-review/SKILL.md` §7, `.claude/CLAUDE.md` "Testing Philosophy".*

### E.1 New behavior has a test that triggers it

Every change that adds or modifies observable behavior comes with a test that fails before the change and passes after. "All existing tests still pass" is not coverage — those tests cover *existing* behavior.

- **Detect:** changed `src/**/*.ts` with no corresponding change under `src/tests/`
- **Severity:** `important`
- **Tag:** `test-coverage`

### E.2 Test edges and errors, not just the happy path

Every error path the code handles has a test that triggers it. Malformed input, missing files, empty data, exception propagation.

- **Detect:** function has explicit error handling but no test exercising it
- **Severity:** `important`
- **Tag:** `test-coverage`

### E.3 Mock boundaries, not logic

Only mock things that are slow, non-deterministic, or external (network, filesystem, time). Mocking pure-logic helpers means the test isn't testing anything real.

- **Detect:** vi.mock / sinon stubs against modules with no I/O
- **Severity:** `important`
- **Tag:** `test-quality`

### E.4 Hooks tests pipe real JSON

Tests for hooks under `src/core/hooks/` pipe real JSON to the hook script and assert real stdout/exit-code — never call internal functions directly.

- **Detect:** hook test imports the hook module instead of spawning it
- **Severity:** `important`
- **Tag:** `test-quality`

---

## F. Architectural fit

*Sources: `src/skills/code-review/SKILL.md` §6, Construct CLAUDE.md "Avoiding duplication".*

### F.1 Code lives in the correct module

New code belongs in the module its responsibility dictates: hooks in `src/core/hooks/`, skills in `src/skills/`, rules in `src/rules/`, shared utilities in `src/` directly. Cross-module helpers go in the parent.

- **Detect:** new file imports from a module it doesn't belong to
- **Severity:** `important`
- **Tag:** `placement`

### F.2 No CLAUDE.md duplication

Rules exist in exactly one CLAUDE.md (global, project, or skill-local). Duplication is forbidden per Construct Commandment 9.

- **Detect:** identical rule text in two CLAUDE.md files
- **Severity:** `important`
- **Tag:** `drift`

### F.3 Hooks live in `src/`, not `.claude/`

Project-local `.claude/settings.json` may only contain permissions, statusline, and MCP server config. Hooks go in `src/` and are installed to `~/.claude/construct/`. Otherwise hooks double-fire (registered in both places at runtime).

- **Detect:** `.claude/settings.json` contains a `hooks` array
- **Severity:** `blocking`
- **Tag:** `double-fire`

---

## G. Performance

*Sources: `src/skills/code-review/SKILL.md` §3.*

### G.1 No N+1 queries

Fetching in a loop instead of batching is forbidden when the underlying API supports batching.

- **Detect:** `await` inside a `for`/`map` body that targets a remote or DB call
- **Severity:** `important`
- **Tag:** `perf`

### G.2 No O(n²) on hot paths

Nested loops over the same collection on a hot path (request handler, render loop, repeated computation) must be replaced with `Map`/`Set` lookups or batched.

- **Detect:** nested `for`/`filter`/`find` over the same source array in a function on a known hot path
- **Severity:** `important`
- **Tag:** `perf`

### G.3 Memoize stable derivations

If a function call produces the same output for the same inputs and is called repeatedly, memoize it. Especially in React render paths.

- **Detect:** repeated identical-argument calls inside the same scope without `useMemo` / cache
- **Severity:** `nit`
- **Tag:** `perf`

### G.4 Clean up listeners and subscriptions

Every `addEventListener` / `subscribe` / `setInterval` / `setTimeout` has a paired cleanup in the same scope (return from `useEffect`, explicit unsubscribe).

- **Detect:** listener registration with no corresponding removal in the same function
- **Severity:** `important`
- **Tag:** `leak`

---

## H. Error handling

*Sources: Construct CLAUDE.md Commandment 1 ("Nothing may fail silently"), Construct CLAUDE.md "Server" + "Dev workflow".*

### H.1 Hooks fail loudly

Every hook script under `src/core/hooks/` wraps `JSON.parse(await Bun.stdin.text())` in try/catch and exits non-zero with stderr on parse failure. No silent failures, no empty stdout writes pretending success.

- **Detect:** hook script with `JSON.parse` outside try/catch; hook with bare `process.exit(0)` on parse failure path
- **Severity:** `blocking`
- **Tag:** `silent-fail`

### H.2 Errors propagate with context

When catching an error to rethrow, attach context: `throw new Error("loading config: " + err.message)` not bare `throw err`. The catch frame should tell future readers what was being attempted.

- **Detect:** `catch (err) { throw err }` (bare rethrow with no enrichment)
- **Severity:** `nit`
- **Tag:** `debuggability`

### H.3 Internal helpers don't swallow errors

`try { ... } catch { return null }` inside an internal helper is forbidden — either log/rethrow, or let the error propagate. Silent null-returns hide bugs.

- **Detect:** catch block whose body is `return null/undefined/[]/{}` without logging or rethrow
- **Severity:** `important`
- **Tag:** `silent-fail`

---

## Negative-filter list (uniform with `src/skills/_shared/finding.md`)

`code-audit` MUST NOT emit findings for:

- Code style or quality concerns not enumerated above
- Potential issues depending on inputs or state outside the audit scope
- Subjective alternatives presented as bugs (use `severity: suggestion` if proposing an alternative)
- Pre-existing issues outside the audit window (record separately under "Pre-existing Issues" if relevant)
- Pedantic nitpicks (one-character indentation, alphabetization preferences)
- Issues a linter would catch — cite `agnix/<rule-id>` or `eslint/<rule-id>` instead
- Issues silenced by lint-ignore comments

---

## CLAUDE.md cross-references

These rules supplement, not replace, the rules in CLAUDE.md:

- **Global CLAUDE.md** (`~/.claude/CLAUDE.md`) — interaction style, permissions, task execution
- **Construct identity** (`src/core/identity/*`) — AGENTS, SOUL, STYLE, USER profile
- **Construct project** (`.claude/CLAUDE.md`) — Construct-specific commandments, server/dev workflow, skill extensions, testing philosophy, verification table
- **Global project root** (`CLAUDE.md`) — performance / parallelization defaults

Rules in those files apply at write-time (via `code-author` enforcement). Rules in this file apply at audit-time (via `code-audit`). When the two overlap, this file restates them in checkable form so `code-audit` can flag violations precisely.

---

## Citation format for findings

Findings cite rules as `code/RULES.md#<section-anchor>` — e.g., `code/RULES.md#a-1-no-any-to-bypass-type-errors`. The anchor follows GitHub-style markdown heading slug rules.

For findings sourced from external linters, use the linter's prefix: `agnix/CC-SK-12`, `eslint/no-explicit-any`.
