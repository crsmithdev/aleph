# Code Rules

Canonical rule set for the code domain. Read by:

- `src/skills/code-review/SKILL.md` — flags violations in existing code and applies approved fixes (single combined flow)
- CLAUDE.md (project-local + global) — applies these rules silently at write-time

Every rule is **checkable**: it can be evaluated against a real diff and produce a plain-markdown finding citing this file's section anchor. Philosophical guidance lives in CLAUDE.md, not here.

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

*Sources: `src/skills/code-review/SKILL.md` "Fix-shape detail: slop removal", global CLAUDE.md "Doing tasks", Aleph CLAUDE.md "Commandments" §2, §7.*

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

### B.7 No dead code

Unused exports (zero consumers across `src/`), unreachable branches (code after unconditional `return`/`throw`, `if (false)` blocks), stale feature flags whose only reference is their own definition, debug leftovers (`console.log`/`console.debug` newly added to this diff, `debugger;`), unused imports. Public API surfaces, test utilities, and interface implementations don't count — confirm zero consumers across the whole repo before flagging.

- **Detect:** grep for the symbol across `src/` and confirm zero consumers; AST or visual check for unreachable code after `return`/`throw`/`break`
- **Severity:** `important` (`blocking` for unreachable branches)
- **Tag:** `slop`, `dead-code`

### B.8 No placeholder narration, orphan TODOs, or unicode hazards

`// Phase 1:`, `// Step 1:`, `// First we do X`, and similar scaffolding comments that say nothing. `// TODO: handle edge cases` without a ticket reference or actionable next step. Commented-out code blocks left "for reference" (git history is the reference). Unicode hazards in code or comments: non-breaking space (U+00A0), zero-width characters (U+200B, U+200D), smart quotes (`"" ''`) in code or config, homoglyphs in identifiers, emoji in code unless the file already uses them.

- **Detect:** comment lines that contain only scaffolding tokens; TODO comments without a ticket/issue/specific next step; commented-out lines containing identifiers also defined in the file; non-ASCII characters outside string literals
- **Severity:** `nit`
- **Tag:** `slop`

### B.9 No pass-through wrappers or single-use helpers

A function whose body is a single call to another function with no added value (validation, logging, type narrowing, error wrapping). A helper extracted at the top of a file that is called exactly once nearby and would read better inlined. Factory/provider/manager class introduced for small local logic with one implementation. Custom Result/Error wrappers introduced in a module that uses the standard idiom for everything else.

- **Detect:** function with body `return otherFn(args)` and no other behavior; helper called from a single site in the same file with no meaningful name advantage; class with one method that wraps an external call
- **Severity:** `nit`
- **Tag:** `slop`, `needless-abstraction`

### B.10 No deeply nested conditionals

Conditionals nested more than two levels deep. Flatten with guard clauses / early returns. Includes nested ternaries (`a ? b : c ? d : e`) — convert to `switch` or chained `if`/`else if`.

- **Detect:** three or more `if`/`else if`/ternary nesting levels within one function body; nested ternary expressions
- **Severity:** `nit`
- **Tag:** `slop`, `nesting`

### B.11 No band-aid guards or silent fallbacks at trusted boundaries

`if (!data) return null` / `if (!data) return []` that hides an upstream pipeline issue rather than being an intentional loading state. `catch { return defaultValue }` that papers over a real failure. Silent default substitution in a branch that should signal failure. Classify before removing: **masking fallback** (hides errors, suppresses validation, swallows failures) is slop; **grounded compatibility/fail-safe fallback** (scoped to an external/version boundary, documents the rationale, has tests for both primary and fallback) is legitimate. Trust boundaries where defensive checks ARE legitimate: HTTP/CLI/env input, JSON/schema parsing, network responses, filesystem reads of external data, third-party callbacks.

- **Detect:** guard clauses returning falsy defaults on internal call paths whose inputs are already validated upstream; catches that return defaults without logging
- **Severity:** `important`
- **Tag:** `slop`, `silent-fail`

### B.12 Match the local file's conventions

Don't introduce a different style in a file that already has one. Naming, comment density and tone, error-handling idiom (throw vs tagged result), type-annotation pattern (annotated vs inferred), inline imports vs top-of-file, factory class vs plain function. Match the file, not absolute style rules.

- **Detect:** new code in a touched file using a different naming convention, error pattern, or structural shape than the rest of the file
- **Severity:** `nit`
- **Tag:** `slop`, `style-drift`

### B.13 No boolean flag parameters that change function behavior

`function send(msg, urgent: boolean)` where `urgent` switches between two unrelated code paths is two functions wearing one name. Split into `send` and `sendUrgent` (or whatever names actually describe the branches). Boolean params that just configure behavior in a clearly-related way (`trimWhitespace: boolean`) are fine.

- **Detect:** function with a boolean parameter that drives a top-level `if`/`else` branch covering most of the body
- **Severity:** `suggestion`
- **Tag:** `slop`, `interface`

---

## C. Duplication

*Sources: `src/skills/code-review/SKILL.md` "Fix-shape detail: consolidation (drift without reference)".*

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

*Sources: `src/skills/code-review/SKILL.md` "Fix-shape detail: propagation (drift with reference)".*

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

*Sources: `src/skills/code-review/SKILL.md` §6, Aleph CLAUDE.md "Avoiding duplication".*

### F.1 Code lives in the correct module

New code belongs in the module its responsibility dictates: hooks in `src/core/hooks/`, skills in `src/skills/`, rules in `src/rules/`, shared utilities in `src/` directly. Cross-module helpers go in the parent.

- **Detect:** new file imports from a module it doesn't belong to
- **Severity:** `important`
- **Tag:** `placement`

### F.2 No CLAUDE.md duplication

Rules exist in exactly one CLAUDE.md (global, project, or skill-local). Duplication is forbidden per Aleph Commandment 9.

- **Detect:** identical rule text in two CLAUDE.md files
- **Severity:** `important`
- **Tag:** `drift`

### F.3 Hooks live in `src/`, not `.claude/`

Project-local `.claude/settings.json` may only contain permissions, statusline, and MCP server config. Hooks go in `src/` and are installed to `~/.claude/aleph/`. Otherwise hooks double-fire (registered in both places at runtime).

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

*Sources: Aleph CLAUDE.md Commandment 1 ("Nothing may fail silently"), Aleph CLAUDE.md "Server" + "Dev workflow".*

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

## I. Complexity

*Sources: Addy Osmani's `code-simplification` skill (function-length thresholds, nesting depth), Aleph CLAUDE.md Commandment 1 ("simplicity, testability").*

### I.1 Function length thresholds

A single function over ~40 non-comment lines is doing too much. Split by responsibility (validation, transformation, persistence, notification) until each function has one clear job.

- **Detect:** function definitions with > 40 lines of body (excluding comments and blank lines)
- **Severity:** `suggestion` (judgment-driven — long functions can be fine if linear)
- **Tag:** `complexity`

### I.2 Nesting depth ≤ 2

More than two levels of nesting reads as a stack. Flatten with guard clauses, early returns, or extracted helpers.

- **Detect:** function bodies with three or more nesting levels (`if`/`for`/`while`/ternary chained)
- **Severity:** `nit`
- **Tag:** `complexity`, `nesting`

### I.3 Parameter count ≤ 4

A function with five or more parameters is taking an object that hasn't been declared yet. Extract a typed config object.

- **Detect:** function signatures with ≥ 5 positional parameters
- **Severity:** `nit`
- **Tag:** `complexity`, `interface`

---

## J. Cleanup non-goals

When `code-suggest` Flow A or any deslop-style cleanup runs, these are out of scope. Findings that propose them MUST be downgraded or rejected.

### J.1 Don't redesign architecture

Renaming modules, restructuring file layout, redesigning a public API, switching frameworks, or otherwise touching the shape of the system. Those go through `code-suggest` Flow B (architectural deepening) or `code-review`'s structural-restructure fix shape, both of which require explicit user approval of the larger plan.

- **Detect:** cleanup proposals that move files, rename exports, change function signatures used by external callers
- **Tag:** `out-of-scope`

### J.2 Don't rename APIs

Public APIs (anything exported from a package, anything consumed across the module boundary, anything in `src/ui/web/src/api/*`) stay named as they are during cleanup. A rename is a coordinated change, not a slop removal.

### J.3 Don't remove invariant-encoding comments

Comments that document *why* something works the way it does — hidden constraints, subtle invariants, workarounds for specific bugs, surprising behavior — are domain knowledge, not slop. Remove only comments that restate what the code already says.

- **Detect:** before removing a comment, check whether removing it would surprise a future reader who didn't know the constraint
- **Tag:** `out-of-scope`

### J.4 Don't change formatting

Defer to the formatter (prettier / biome / etc.). Cleanup edits should match the file's formatter output, not impose a different style.

### J.5 Don't remove validation at genuine trust boundaries

Input parsing, HTTP/CLI handlers, network responses, FS reads of external data, third-party callbacks. Those checks defend the system from untrusted input — they're load-bearing, not slop. See B.11.

### J.6 Don't remove dead code that's public API, test-only, or contract-required

Before flagging an export as unused, confirm zero consumers across the whole repo, including `*.test.ts` files. Interface implementations required by a contract stay even if no current caller exists. Public API surfaces (anything that could have external callers) stay until you can prove no callers exist outside the repo.

---

## Negative-filter list (uniform with other review leaves)

`code-review` MUST NOT emit findings for:

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
- **Aleph identity** (`src/core/identity/*`) — AGENTS, SOUL, STYLE, USER profile
- **Aleph project** (`.claude/CLAUDE.md`) — Aleph-specific commandments, server/dev workflow, skill extensions, testing philosophy, verification table
- **Global project root** (`CLAUDE.md`) — performance / parallelization defaults

Rules in those files apply at write-time. Rules in this file apply at review-time (via `code-review`). When the two overlap, this file restates them in checkable form so `code-review` can flag violations precisely.

---

## Citation format for findings

Findings cite rules as `code/RULES.md#<section-id>` — e.g., `code/RULES.md#A.1`, `code/RULES.md#H.3`. The section ID is the literal heading number (period preserved).

For findings sourced from external linters, use the linter's prefix and native rule id: `agnix/CC-SK-12`, `eslint/no-explicit-any`.
