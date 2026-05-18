# Construct public face: portfolio + product

Synthesis of two sketches:
- `~/.construct/sketches/construct-as-portfolio-showcase.md` — how the repo reads to a senior engineer arriving from a link
- `~/.construct/sketches/construct-as-a-product.md` — how Construct gets installed and used by someone who isn't its author

The sketches are complementary, not alternatives. Portfolio is the *perception* layer (what the repo says it is). Product is the *distribution* layer (how someone runs it). They share a precondition — public-facing artifacts need to exist before either lands — and they interact: once Construct ships as a Claude Code plugin, the README's "Quick Start" leads with `/plugin install`, not `bun install.ts`. Sequencing matters.

This plan threads them into four phases. Phase 0 + 1 are cheap and unblock everything. Phase 2 is a week. Phase 3 is a month. Phase 4 is gated on a privacy audit.

---

## Phase 0 — Positioning + audit (1–2 days)

Decisions that block downstream work. None of them require code changes.

1. **Positioning label.** Pick one for the README headline. Candidates from the sketches: "Claude Code infrastructure", "personal AI substrate", "agentic development substrate". The label drives search discoverability for the target audience (AI-infra hiring, Claude Code power users) and frames Phase 2's marketplace listing.
2. **SPEC.md shape.** One monolithic file vs. per-module. Monolithic = more impressive as a standalone artifact for a drive-by reader; per-module = lower drift cost. Pick before Phase 1 starts.
3. **Privacy audit of `src/ui`.** Walk every route and ask: would a public read-only deploy expose data the author wouldn't want public? Session contents, research queries, memory entries, telemetry. Output: a list of routes safe to expose + routes that need scrubbing before Phase 4 is viable.
4. **Distribution lead.** Is the plugin story (Phase 2) or the menubar story (Phase 3) the primary product narrative? The README and demo materials should anchor to one. The other can be a "see also." Plugin is faster to ship and cheaper to maintain; menubar is more visceral.

Output: a one-page `docs/positioning.md` capturing the four decisions so Phase 1 doesn't relitigate them.

---

## Phase 1 — Portfolio readiness (3–5 days)

Lowest-cost, highest-signal work. Unblocks linking the repo from a resume or blog post. Independent of Phases 2 and 3.

### 1.1 README rewrite

Current `README.md` is install-first (271 lines, leading with `bun install.ts`). Target shape from the sketch:

```
# Construct

One paragraph: what problem, who has it, what this does about it.

## What's interesting here
- Hook architecture: <one line on why it's designed that way>
- Skill router: <one line on the classification model>
- Eval harness: falsifiable quality bar, not vibes
- Research engine: branching loops with budgeted exploration
- Verify gate: structured proof-of-work before any "done" claim

## Structure
Annotated directory map — each module gets one line on what and why.

## Running it
One block, three commands. Detail in INSTALL.md.
```

The "What's interesting here" section is the portfolio signal. Each bullet should name a real file or two. The reader's question is "did the author understand what they were building" — bullets that say *why* a design decision was made answer it.

**Touch files**
- `README.md` — rewrite top-to-bottom
- `INSTALL.md` — already exists at 104 lines; extend with anything the README sheds

### 1.2 SPEC.md

A behavior-oriented spec is a portfolio artifact on its own — proves the system was thought about as a system. Currently absent. Per the sketch, must cover:

- Every hook: trigger event, input contract (stdin JSON shape), output contract (stdout/exit), error behavior
- Every skill: trigger keywords, what it does, what it explicitly doesn't
- Eval targets and pass/fail criteria
- Verify gate contract (the `[verify]` block schema)

Per the Phase 0 decision, this lands as either `SPEC.md` (one file) or `docs/spec/<module>.md` (per-module). Phase 1 generates the content either way; the shape decision is upstream.

**Touch files**
- `SPEC.md` or `docs/spec/*.md`
- Drives content from `src/core/hooks/settings-hooks.json`, `src/skills/skill-rules.json`, `src/eval/`

### 1.3 Demo recording

90 seconds, no narration, timestamped captions only. One scenario, not three. Strongest candidate from the sketch: **the verify gate blocking a Stop and the agent recovering** — it's visual, it's the most novel piece, and it shows the system thinking. Alternative: a skill route classify → dispatch → execute trace.

Host: GitHub-hosted MP4 in README (no external dependency, no link rot). Re-record cost is low.

### 1.4 Code-quality signals visible to a scanner

A senior engineer's scan of an unfamiliar repo is fast and pattern-based. Make the patterns visible:

- CI badge at top of README (badge for `bun test.ts` on `main`)
- One-line eval-harness summary in README (pass rate, last-run date) — pull from `src/eval/` output
- Git log audit: any junk commits or AI-slop messages get squashed before going public
- `bun test.ts` output visible in the README's "What's interesting here" → "eval harness" bullet

### 1.5 Public commit hygiene gate

Before any of Phase 1 ships publicly: a quick pass on the git log. Sketches and memory files in `~/.construct/sketches/` are personal; nothing in the repo's history should leak them. Confirm.

---

## Phase 2 — Claude Code plugin packaging (~1 week)

Per the product sketch: Claude Code plugins already bundle exactly the 10 component types Construct produces. Anthropic owns the install surface, marketplace, and update path. This is the cheapest path to "feels like a product."

### 2.1 Component mapping

Construct currently ships 9 modules (per the README table). Map each to the Claude Code plugin component types:

| Construct module | Plugin component type |
|---|---|
| `construct-core` (hooks/, identity/, statusline) | hooks + settings + output style |
| `construct-memory` (hooks) | hooks |
| `construct-skills` (skill-rules.json, 37 skills) | skills |
| `construct-goals` (MCP server, slash commands) | MCP server + commands |
| `construct-research` (commands, worker) | commands + (worker as sidecar — open question) |
| `construct-ui` (Fastify + React) | not a plugin component — sidecar, see Phase 3 |
| `construct-telemetry`, `construct-data`, `construct-eval` | internal libs, not user-facing components |

The Fastify+React UI doesn't fit any plugin slot. Two options: (a) plugin ships without UI, UI stays a separate `bun install.ts`; (b) UI launches via menubar shell (Phase 3) and is decoupled from the plugin entirely.

### 2.2 marketplace.json + distribution

- Own marketplace repo first (`github.com/crsmithdev/construct-marketplace` or similar), pinned to release tags.
- Defer submission to `anthropics/claude-plugins-official` until the plugin has been dogfooded by ≥1 outside user.
- Install path: `/plugin install construct@crsmithdev/construct-marketplace`.
- `--plugin-url` install of a release `.zip` documented in README as a try-without-commit path.

### 2.3 README + INSTALL.md update

Once the plugin works, the README's "Running it" block leads with the plugin install. `bun install.ts` becomes the "developing on Construct" path, documented in INSTALL.md.

### 2.4 Test gate

Install on a clean WSL2 instance (or a fresh `~/.claude` directory) from the marketplace URL. Run `/goal`, `/research`, a couple of skills. Verify hooks fire and the skill router classifies. Output: an INSTALL section that reflects what actually worked.

### 2.5 Open question — what about user data?

A plugin install puts Construct's components in `~/.claude/`. Construct's user data lives at `~/.construct/`. The plugin install path needs to create `~/.construct/` and migrate or initialize the DB. Decide whether this is a plugin postinstall step, a first-run prompt in the UI, or a separate `bun init` command users run after `/plugin install`.

---

## Phase 3 — Menubar shell (~1 month, optional)

Largest investment. Highest "feels like a product" payoff but lowest portfolio-pure ROI. Defer until Phase 2 has landed and the plugin has external users. Skip entirely if the menubar story isn't the chosen distribution lead from Phase 0.

### 3.1 Scaffolding

- Tauri 2.x app wrapping `src/ui/web` verbatim — no React rewrite.
- Bun backend runs as a sidecar. Sketch flags this as an open question (packaged Bun runtime vs. external dependency); start with external dep, document `bun` as a prereq, revisit packaging if friction warrants.
- Bundle target: macOS first (largest target audience for Claude Code power users), Linux `.deb` second, Windows last.

### 3.2 Native affordances

- OS notifications on long-running task completion (research loop done, verify gate fired).
- Global hotkey to open the UI.
- Tray icon with status (active loops, recent completions).
- Auto-update via Tauri updater + GitHub releases.

### 3.3 Systemd story

If the menubar shell hosts the backend, the systemd service from `install.ts` becomes redundant on machines that use the shell. Document both paths; don't force migration. Headless WSL2 / server users keep systemd; menubar users get a single binary.

---

## Phase 4 — Public deploy (optional, gated on Phase 0.3)

Gated on the privacy audit. If the UI exposes any data the author wouldn't want public, fix that first.

Two options, in increasing investment:

1. **GitHub Pages static export of a sample session.** No backend. Captures the visual story without running anything. Cheap, link-stable, no infra.
2. **Live read-only instance at `construct.crsmi.dev`.** Higher signal — proves the system runs in production. Requires hosting, scrubbed sample data, no auth surface, no user data leakage. Re-deploy on every push to `main`.

Skip both if the GitHub repo + demo recording from Phase 1 are enough for the target audience. Per the sketch's open question 3, this is a judgment call about whether a personal domain meaningfully raises the bar over a polished GitHub repo. Default: skip until Phase 1 is shipped and feedback indicates otherwise.

---

## Sequencing and dependencies

```
Phase 0  ────►  Phase 1  ────►  Phase 2  ────►  Phase 3
                   │                │
                   └──► Phase 4 (gated on 0.3 audit)
```

- Phase 0 blocks everything (decisions cascade).
- Phase 1 is independent of distribution choice and lands first.
- Phase 2 and Phase 3 are independent of each other per the product sketch; sequence them by which one wins the Phase 0.4 distribution-lead decision.
- Phase 4 needs the Phase 0.3 privacy audit; otherwise independent.

If only one phase ships: Phase 1. It is the highest signal-per-hour and the only phase that requires no infrastructure decisions.

---

## Open questions (consolidated)

From the portfolio sketch:
1. Is the current codebase clean enough to link before the README change ships, or does README go first?
2. SPEC.md: one file or per-module? (Phase 0.2 decision.)
3. Positioning label? (Phase 0.1 decision.)
4. Demo hosting: GitHub MP4, YouTube unlisted, or Loom? Default proposed: GitHub MP4 for link stability.
5. Personal domain + landing page, or is a polished GitHub repo enough? (Phase 4 entry point.)

From the product sketch:
6. Marketplace: own repo or submit to `anthropics/claude-plugins-official`? Default proposed: own repo first, submit after external dogfooding.
7. Tauri sidecar Bun packaging vs. external dependency? Default proposed: external dep first, revisit if friction warrants.
8. How much of the systemd install survives once a menubar shell exists? Default proposed: both paths supported, no forced migration.

New, from synthesis:
9. Plugin install + user-data init: postinstall step, first-run UI prompt, or separate `bun init` command? (Phase 2.5.)
10. Does the UI ship inside the plugin install (forcing a sidecar story) or stay separate (cleaner plugin, harder product story)? (Phase 2.1.)

---

## Effort summary

| Phase | Effort | Blockers | Ship independently? |
|---|---|---|---|
| 0 — Audit + positioning | 1–2 days | — | n/a |
| 1 — Portfolio readiness | 3–5 days | Phase 0 | yes |
| 2 — Plugin packaging | ~1 week | Phase 0.1, 0.4 | yes |
| 3 — Menubar shell | ~1 month | Phase 0.4 | yes |
| 4 — Public deploy | 2–5 days | Phase 0.3, Phase 1 | yes |

Minimum viable shippable slice: Phase 0 + Phase 1. ~1 week, no infra, repo-link ready.
