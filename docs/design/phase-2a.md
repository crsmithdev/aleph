# Aleph-next — Phase 2a ("Useful to its own build")

**Status:** implementation design, derived from `docs/design/phase-1.md`, which is the authority for
everything it settles. Phase 1 was itself derived from `aleph-next-design-v1.0.md` §11 and
`cockpit-spec-v0.2.md` §4; **neither is in this repository or recoverable on the build host**
(2026-08-21). Their requirements survive only where phase-1.md quotes them.

**Revision 4 (2026-08-22).** Revisions 1–3 designed a broker for an agent that would grow tools.
That premise is retired: Chris codes with Claude Code and will not be doing much by hand, so
aleph-next is **the record and the governor**, not a second coding agent. §12 keeps the history of
what two red teams corrected; this revision is a restructure, not a patch.

**The goal that decides everything here: aleph-next should be useful while building aleph-next.**
Every milestone is judged against that, not against feature count.

---

## 1. What 2a is

### 1.1 The division of labour

| | Role | Lifetime |
|---|---|---|
| **Claude Code** | the hands — tools, edits, tests, the work | ephemeral, per session |
| **aleph** (skills, hooks) | sensors and workflow shaping, where the work happens | in-process with Claude Code |
| **aleph-next** | the record, the governor, the always-on | persistent, causal, gated |

The daemon's agent keeps **no tools** (phase-1 §13). That was starting to read as a limitation of
Phase 1; under this division it is the design. Hermes — the closest comparable system — chose the
opposite pole and is a coding agent with 40+ tools, seven execution backends and 5,498 lines of
shell-command approval regex. That is the scope this phase declines.

### 1.2 In scope

| Subsystem | Contract |
|---|---|
| **Two stores** (§4) | An append-only event log for *evidence*; a reconciled memory for *facts*. They are not the same thing and Phase 1 conflated them. |
| **Hook ingest** (§5) | aleph's existing Claude Code hooks emit typed observations into the event log. Without this the daemon's memory is a diary of chat. |
| **MCP server** (§6) | `recall`, `brief`, `approvals_list`, `approvals_respond`, `verify`. Claude Code is the primary interface. |
| **The broker** (§7) | Gates what is *promoted into memory*. Default-deny, TTL, audit trail. |
| **Verification gates** (§8) | The daemon runs a domain's gate and records the result causally. Daemon-defined gates only. |

### 1.3 Out of scope

Telegram approval buttons (§7.3 — deferred, not cut). Agent-chosen vault writes. Cron, capture,
librarian, briefs, ntfy, Syncthing (§10). Cockpit UI — **dropped entirely**: Claude Code is the UI,
and everything authoritative is a file you can open. Research. Shell execution and egress for the
agent, permanently.

### 1.4 The non-negotiable

> **Nothing enters long-term memory without a recorded decision — a human's or a default-deny — and
> every observation the daemon holds can be traced to what produced it.**

Phase 1's was "nothing is claimed without being run"; that still holds.

### 1.5 Acceptance — the dogfood test

2a is done when, working in this repo with Claude Code, asking *"what do I know about X"* returns
something you would otherwise have gone looking for. If it returns noise, the architecture is wrong
and one day found that out.

---

## 2. What changed from revision 3, and why

Three consequences of the reframing, each removing more than it adds:

1. **Approvals are answered where you work.** `approvals_respond` over MCP plus `os approvals`
   replaces the Telegram inline keyboard. That deletes the single most expensive unbuilt item in
   revision 3 — new Bot API methods, `callback_query` normalisation, forged-sender authorization,
   and matching work in the fake server. Phone approval returns when there is something worth
   approving from a phone.
2. **The broker's subject changes from vault writes to memory promotion.** An agent with no tools
   proposes no writes. But if hooks feed observations automatically, *what gets believed* is the
   decision that needs a gate — and a poisoned memory outlives the session that created it. 2026
   research: >90% of agents vulnerable to memory poisoning, **100% relapse** when corrected
   conversationally. Correcting it in chat does not work; gating the write does.
3. **`MEMORY.md` becomes proposable.** Revision 3 forbade it, correctly, for a tool-having agent.
   Here it is the whole point.

---

## 3. Phase 1 corrections

Defects in shipped code that this phase sits on top of. **Retirement rule:** when an item lands it
is recorded in phase-1 §17, the phase-1 body is amended, and the entry here becomes a pointer. An
item that has shipped but still reads as future work is the defect this section exists to prevent.

| Item | State |
|---|---|
| `log/` keyed on a UTC clock outside `clock.ts`; per-directory temp file; `commit()` committing the whole index | **shipped** `206a9d9` — phase-1 §17.13 |
| Invalid `daemon.timezone` booting clean, then killing every write | **shipped** `dcc4416` — phase-1 §17.14 |
| The brief was an ungated agent-write channel into its own next prompt | **shipped** `605c6d6` — phase-1 §17.15 |
| An unguarded tick: one throw killed the other tasks silently | **shipped** `4fe35cf` — phase-1 §17.16 |
| **`control` refused in sentinel mode** — `src/core/meter.ts:121-125` treats any exhausted window as full for privileged lanes, so zero-token work is refused exactly when the system is stressed | **open**, M0 |

The remaining one matters less than it did — approvals no longer travel over a metered channel —
but the daemon still refuses zero-cost `control` work under pressure, and the fix is small: `Job`
gains `llm: boolean`, `Meter.admit` takes it, `lane_disabled` stays checked first so
`os lane control --disable` remains an operator kill switch.

---

## 4. Two stores

Phase 1 has one durable record and calls it both things. The 2026 memory literature is blunt about
why that fails: *"If your store is append-only, the old version of a fact and the new version
coexist, and the agent has to guess which is current"*, and *"forgetting is the most underrated
operation"*.

| | Event log (exists) | Memory (new) |
|---|---|---|
| Holds | what happened | what is currently believed |
| Shape | append-only JSONL, SQLite index, rebuildable | files + index, mutable |
| Operations | `emit()` only | `add`, `replace`, `remove` |
| Truth | immutable; never edited | reconciled; entries die |
| Provenance | `caused_by` + typed `cause` | every entry cites the events that justify it |

The memory API is taken from Hermes' `tools/memory_tool.py`, which is the best-argued thing in that
repository:

- **`replace` and `remove` match on a short unique substring**, not an id and not full text. That is
  the reconciliation primitive an append-only store lacks.
- **Character limits, not token limits** — "because char counts are model-independent".
- **Drift detection**: the file may have been edited underneath (Obsidian, Syncthing, you). A
  changed file is a conflict to surface, not a write to clobber.
- **Two stores, not one**: what the agent knows about the world, and what it knows about you.

### 4.1 The frozen snapshot

Hermes injects memory into the system prompt **as a snapshot at session start**; mid-session writes
hit disk immediately but do not change the prompt, preserving the prefix cache for the whole
session.

aleph-next calls `seedPrompt()` at the top of every `runTurn`, so the prefix changes whenever
`MEMORY.md` or the brief changes. This is visible in the soak's own meter events: four consecutive
turns reused a 19,657-token prefix, then turn five — the checkpoint that rewrites the brief —
re-created 5,114 tokens and fell back to the stable 15,688-token floor.

**Decided:** the prompt prefix is built once per session and reused for its lifetime; writes are
durable immediately and visible to the *next* session. `session.rehydrated` already marks the
boundary where a new snapshot is correct.

---

## 5. Hook ingest

aleph has thirteen hooks sitting exactly where the work happens. aleph-next has a causal log and no
eyes. Connecting them is the highest-value piece of this phase.

- **Shape:** hooks POST *typed observations* — decision, fix, dead-end, surprise, artifact — not raw
  transcripts. The claude-mem lineage settled on this shape and on extracting with a cheap model
  *with existing memories in context*, so it only records what is new.
- **Identity:** a new `origin: "external"`. Phase-1 invariant 5 (`session_id` iff
  `origin === "channel"`) holds unchanged — an observation from a Claude Code session is not a
  daemon session. The external session id travels in the payload.
- **Transport:** the existing Unix socket. It is already 0600 and already the CLI's path; a hook is
  just another local client. No new listener, no port.
- **Volume is the risk.** Every observation is an event, forever. Ingest is rate-limited and the
  extractor is responsible for saying nothing when nothing happened.
- **Git is the other sensor.** Commit messages in this repository are already the explanations, and
  ingesting them is nearly free next to parsing transcripts.

Observations are **evidence, not belief**. They land in the event log. Promotion into memory is §7.

---

## 6. The MCP server

Claude Code is the primary interface, so this is how aleph-next is used most of the time.

| Tool | Does |
|---|---|
| `recall(query)` | search memory and the observation log; returns entries with the events that justify them |
| `brief(topic)` | the current `session-brief.md` for a topic |
| `approvals_list()` | outstanding promotions awaiting a decision |
| `approvals_respond(id, verdict)` | decide one |
| `verify(domain)` | run that domain's gate, record the result, return pass/fail |

`approvals_list` / `approvals_respond` is lifted directly from Hermes' `mcp serve` surface, which
exposes `permissions_list_open` / `permissions_respond` for the same reason: you approve from where
you already are.

**The daemon owns the session** (Letta's rule: the server holds all state, clients send messages).
An MCP client addresses a topic; it does not fork its own copy of the context.

**Not a channel.** `Channel` is message-shaped — topics, threads, `createTopic`. These are queries
against state. A conversational MCP channel that joins a topic is a later decision (§11.2).

---

## 7. The broker

Unchanged in mechanism from revision 3, retargeted at promotion. The state machine, the conditional
`UPDATE ... WHERE state = 'requested'`, `serial_key` per approval, the boot sweep before any channel
accepts input, TTL default-deny, and `subject_hash` binding all carry over verbatim — they were
reviewed twice and the reasoning holds regardless of what is being approved.

### 7.1 What is proposed

```ts
type Proposal =
  | { kind: 'memory.add';     target: 'MEMORY.md' | 'USER.md'; text: string }
  | { kind: 'memory.replace'; target: ...; find: string; text: string }
  | { kind: 'memory.remove';  target: ...; find: string };
```

Each carries the observation events that justify it. The prompt shows the entry, the target, and
what it replaces — small enough to read in full, which removes revision 3's preview-on-request
problem: **for memory, the body *is* the subject.**

### 7.2 Who proposes

A consolidation pass over recent observations, run on demand (`os memory consolidate`) or by the
librarian later. Not the conversational agent — it has no reason to and no tool to.

### 7.3 Deferred: phone approval

The Telegram inline keyboard, `callback_query` normalisation, `answerCallbackQuery`, and the fake
server's matching support. Nothing is lost: `approvals_respond` and `os approvals` cover the case
where you are working, which is when promotions happen. Revive when there is a promotion you want
to answer from a chairlift.

---

## 8. Verification gates

The trigger stays a Claude Code hook; the daemon becomes the judge.

- `verify(domain)` resolves the domain against `docs/VERIFICATION.md`'s table, runs it, and emits
  the outcome with a real `cause` and `caused_by`. The gate table stops being a document only
  discipline enforces.
- **Daemon-defined gates only** — `bun run typecheck`, `bun test`, `bun run docs:check`. Not
  arbitrary commands. This is what makes an execute gate unnecessary: the daemon runs a fixed set of
  its own commands, so there is nothing for an agent to smuggle. Hermes needed 5,498 lines and 159
  regexes because it gates arbitrary shell; a fixed set needs none of it.
- A failing gate is an event, not an exception. The Stop hook decides what to do about it.

---

## 9. Milestones

Each is judged against §1.5, not against completeness.

| M | Content | Done when |
|---|---|---|
| **M0** | §3's remaining correction: `llm` on `Job`, meter admission, amend phase-1 §11.4 | A zero-LLM `control` job is admitted with both windows exhausted |
| **M1** | The memory store: files, index, `add`/`replace`/`remove`, drift detection, frozen snapshot | Round-trip and reconciliation tests; a stale entry can be removed |
| **M2** | Ingest: `origin: "external"`, the socket endpoint, one aleph hook emitting real observations | A day of real work in this repo produces observations worth reading |
| **M3** | MCP server: `recall`, `brief` | **The dogfood test** — `recall` in this repo returns something you would have gone looking for |
| **M4** | Broker retargeted: promotion proposals, `approvals_list`/`respond`, `os approvals` | A promotion proposed, denied, re-proposed, approved, all from Claude Code |
| **M5** | `verify(domain)` + the Stop hook | A failed gate is refused and recorded before a claim is made |

M3 is the milestone that matters. M1 and M2 exist to make it possible; M4 and M5 are what make it
trustworthy.

---

## 10. Deferred, with reasons

- **Cron, heartbeat, capture, librarian, briefs, ntfy, Syncthing.** None is needed for the dogfood
  test. The two Phase 1 deferrals that need a scheduler — the nightly `log/` commit and the nightly
  join audit — keep running as they do now.
- **Phone approvals** (§7.3).
- **Conversational MCP channel** (§11.2).
- **`.stignore` excludes `inbox`, `log` and `.git`** (`src/vault/bootstrap.ts:26-32`) and the
  conflict pattern in `GITIGNORE` does not match Syncthing's real filenames. That is a **shipped
  Phase 1 defect**, filed here only because nobody has turned Syncthing on.

---

## 11. Open questions

1. **How much does ingest cost?** Every observation is an event forever, and an extraction call per
   session. If a day of work produces a hundred observations and two are useful, the shape is wrong.
   M2 answers this with real volume before M3 depends on it.
2. **Should MCP also be a conversational channel?** `recall` is a query. "Continue on my laptop the
   topic I started on my phone" is a channel. The second is cheap once the first exists — the
   `Channel` interface already supports it — but it is a different product decision.
3. **Where do promoted facts live?** `MEMORY.md` is one file with a line budget. Real memory wants
   many entries with structure. Hermes uses a `§` delimiter in one file; basic-memory uses a note
   per subject with a semantic schema. Decide at M1.
4. **Does the conversational agent read memory it did not have gated?** It reads `MEMORY.md` today.
   If promotion is gated but reading is not, an unapproved observation still reaches the prompt by
   another route. M1 must keep observations out of the prompt until promoted.

---

## 12. Corrections from two red teams

Retained from revisions 1–3 because the pattern is the point: three of the five fatal findings in
round one, and two in round two, were claims the document made about **code it had not read**.

### Round 2 (revision 2 → 3)

1. **The agent already writes its own future prompt** (§2.4). Ungated, live, every five turns, with
   a regex-delimited parser that turns ordinary reply text into structured fields and unescaped
   wrapper tags. Confirmed by running the real parser against hostile input. This reordered the
   phase: it is M0a, ahead of the broker.
2. **Revision 2 described code that had been fixed since it was written** — §2.2 and §6 still spoke
   of the UTC clock and a `Clock` with no local-date API, both landed in `206a9d9`. The previous
   round's failure mode, inverted, and the reason §2 now carries a retirement rule.
3. **The allow-list matched before normalising**, so `wiki/x/../projects/<t>/session-brief.md`
   reached the excluded file. Also: dotfiles, symlinks, and case-insensitive mounts (§5.1).
4. **A newline in the *path* forges the prompt** — revision 2 collapsed newlines in the rationale
   only, and a newline is ASCII (§4.4). The "fenced block" mitigation was theatre: the transport
   sends no `parse_mode`.
5. **Nothing held the proposed bytes** — not the event (capped), not the queue (in memory), not the
   table. A restart between delivery and approval left nothing to write (§4.2).
6. **No terminal state for a failed perform**, and `superseded` was unreachable from `granted`, so a
   permanent refusal was reported as a liveness bug (§4.2).
7. **The boot sweep ran after the CLI socket was already listening** (§4.2).
8. **`serial_key` covers one job**, so a separate perform job reopened the window the conditional
   UPDATE had just closed (§4.1).
9. **`llm: boolean` would have deleted the lane kill switch** and defaulted every existing caller to
   non-LLM privileged (§2.1).
10. **The broker had no module, and the tool had no schema** — the thing the model actually sees was
    named once, in a milestone row (§4.0).
11. **Kinds promised in prose were missing from the registry**; `via` had no values; `prp` was
    minted but never registered; `granted_at` and `decided_at` were the same field (§4.8).
12. **`cron_runs` reinvented `jobs_done`**, and the DST rule was US-shaped in a configurable-zone
    system (§6).
13. **Two dead cross-references**, and every heartbeat threshold promised and unspecified (§8).

### Round 1 (revision 1 → 2)

Revision 1 was reviewed by four independent adversarial reviewers before any code was written.
Three of the five fatal findings were claims this document made about **code it had not read** —
the same failure mode phase-1 §17 records, caught one step earlier.

1. **`control` is refused in sentinel mode.** The document asserted approvals keep working when the
   window is exhausted; `src/core/meter.ts:120-125` refuses them. Found independently by three of
   the four reviewers. Now §2.1, a prerequisite correction with its own gate.
2. **"The worst case is a bad wiki edit" was false.** `wiki/` contains `session-brief.md`, which is
   what a rehydrated session reads. The document's own example class grant authorised rewriting the
   agent's future prompt. Now §5.1/§5.2.
3. **The writable surface did not exist.** The document described an allow-list; the code has a
   deny-list, leaving `.gitignore`, `.stignore`, `index.md`, `research/` and `archive/` approvable.
   Now §5.1.
4. **The security-lane guarantee was unenforceable and self-contradictory.** The kind registry does
   not constrain causes, `strict` is off in production, and the document gave `approval.proposed` a
   `self-reported` cause one section after forbidding it. Now §4.6.
5. **The callback path did not exist in the client, and dropped updates advanced the offset.** Now
   §4.4 and M2, with the fake server's gap budgeted.
6. **The agent's rationale was pasted unescaped into a security prompt.** Newlines alone let
   injected text forge a second approval block. Now §4.4.
7. **Class grants were cut** (§4.7) — unearned, unrevocable, and the amplifier for (2).
8. **Concurrency was unspecified**: no table, no `UNIQUE`, no `serial_key`, `max_concurrent = 2`.
   A double-tap performed twice. Now §3 and §4.2.
9. **The boot sweep ran 30 s late**, after channels start. Now §4.2.
10. **The decision's identity broke an invariant either way.** Now §4.3.
11. **Scope.** Six subsystems at one depth produced three LLM subsystems in five bullets and a
    config surface referencing a binary present on no host. Now §1.2 and §9.
12. **`whisper_model = "${WHISPER_MODEL_PATH}"` made the daemon unbootable** wherever it was unset,
    capture disabled or not. Now §8's rule.
