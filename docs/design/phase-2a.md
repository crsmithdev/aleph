# Aleph-next — Phase 2a ("Autonomy under approval") detailed design

**Status:** implementation design, derived from `docs/design/phase-1.md`, which is the authority
for everything it settles. Phase 1 was itself derived from `aleph-next-design-v1.0.md` §11 and
`cockpit-spec-v0.2.md` §4; **neither of those documents is in this repository or recoverable on
the build host** (2026-08-21). Their F-numbered requirements survive only where phase-1.md quotes
them. Where this document cites a requirement it cites the phase-1 section that carries it, never
the upstream number — a citation nobody can resolve is worse than no citation.

**Revision 2 (2026-08-22).** Revision 1 was red-teamed by four independent reviewers and did not
survive. Five findings were fatal, and three of them were claims this document made about code it
had not read. §14 records what changed and why; the corrections are load-bearing, not editorial.

**Scope of authority:** this document decides the items phase-1.md deferred to 2a and specifies
the approval broker and the first gated capability to implementable depth. Four further subsystems
are **sketched, not specified** (§9) and will get their own design before anyone builds them.

---

## 1. What 2a is

Phase 1 is a **remembering agent that cannot act**. Its safety argument is structural: the agent
has no tools, so there is no path from a message to a file write, a command, or a request
(phase-1 §13). Phase 2a is where that stops being true.

The whole of 2a is therefore organised around one question: *what replaces "it has no tools" as
the reason this is safe?* The answer is the approval broker, and it is built first, before the
first tool exists to need it.

### 1.1 What 2a ships

| Subsystem | One-line contract |
|---|---|
| **Prerequisite corrections to Phase 1** (§2) | Three defects in shipped code that the broker would otherwise be built on top of. |
| **Approval broker + security lane** (§4) | No side effect the agent chose happens without a recorded human decision or a recorded default-deny. |
| **Agent-chosen vault writes** (§5) | The first gated capability. The agent proposes a path and body; the daemon writes it, or does not. |
| **Cron and the heartbeat checklist** (§6) | The scheduler Phase 1 deferred two jobs to, and the zero-LLM checklist §11.5 of that document left to this one. |

### 1.2 What 2a sketches but does not specify

Capture (whisper, classifier), librarian, morning brief, memory promotion gate, ntfy, Syncthing.
§9 records what is known about each and what has to be decided. **They are not in 2a's milestones.**
Revision 1 put all six subsystems at the same depth, which produced five bullets of prose for three
LLM subsystems and a config surface that referenced binaries present on no host this system runs on.

### 1.3 Explicitly out of scope

Verification kernel (2b). Cockpit UI (2b) — 2a continues to ship *the event log the cockpit is a
view over*, and adds the approval ledger it will render. Research (3). Semantic index (4). Shell
execution and web egress for the agent. **Class grants** (§4.7) — cut from revision 1.

### 1.4 The one non-negotiable of Phase 2a

> **Every side effect the agent chose is preceded by an approval decision in the event log, and
> that decision is either a human's or the broker's own default-deny. There is no third case, and
> no code path that performs an agent-chosen side effect without consulting the broker.**

Phase 1's non-negotiable was that nothing is claimed without being run. That still holds. This one
is additive: 2a's runbook must show a real denial, a real expiry, and a real approval, against the
real Telegram bot.

---

## 2. Prerequisite corrections to Phase 1

The broker cannot be built on the current code. These are not 2a features; they are defects the
red team surfaced, and each needs its own gate before M1 starts.

### 2.1 `control` is refused in sentinel mode (fatal)

```ts
const privileged = lane === "interactive" || lane === "control";
if (privileged) {
  const full = w5.share >= 1 || ww.share >= 1 || this.exhausted.size > 0;
  return full ? verdict(false, "window_exhausted") : verdict(true, "ok");
}
```
— `src/core/meter.ts:120-125`

Any exhausted window refuses `control` outright, so an approval prompt — which costs **zero
tokens**, being daemon-templated — cannot be delivered exactly when the system is under pressure.
The delivery job is rejected, no prompt is sent, and the TTL sweeps the approval to `expired`. The
gate would fail closed by outage, silently, and phase-1 §11.4's own rule (`control → share < 1.0`)
says it should not.

**Correction:** admission takes the job's `llm: boolean`. A `control` job with `llm: false` is
admitted whenever the daemon is running; an LLM job in any lane obeys the ladder unchanged. The
same correction is what lets §6's sentinel heartbeat run at all — it is non-privileged today and
would be refused with everything else.

### 2.2 The vault's "today" is UTC and unfakeable

`src/vault/writer.ts:50` and `:125` call `new Date()` — outside `src/core/clock.ts`, violating a
CLAUDE.md invariant, unmoved by the fake clock the tests advance, and **UTC** while
`daemon.timezone` is `America/Los_Angeles` (confirmed, phase-1 §16.4). The `log/` prohibition
therefore rolls over at 17:00 local. `writer.ts:84` mints its temp file from `Date.now()` for the
same reason.

**Correction:** `VaultWriter` takes the `Clock`, and "today" is computed in the configured
timezone. A boundaries test asserts no `Date.now()`/`new Date()` outside `src/core/clock.ts` —
the invariant is currently documented and unenforced.

### 2.3 The tick has no failure boundary

`onTick` (`src/daemon.ts:194-200`) has no `try/catch` and emits no liveness event. A throw in any
sweep kills the meter sweep, the lifecycle sweep, the bus pump and the heartbeat at once, and the
symptom is silence. 2a puts the approval TTL sweep in that same tick, so the blast radius grows to
include the safety gate.

**Correction:** each tick task is individually guarded, a failure emits `daemon.tick_failed`, and
the tick emits a liveness event the heartbeat checks.

---

## 3. Decisions on the open items

Chris's three answers (2026-08-22), which forked the design:

| Item | Decision |
|---|---|
| **Document shape** | One document. Revision 2 keeps that, but at two depths: specified (§4–§6) and sketched (§9). |
| **Approval delivery** | Telegram **inline keyboard**, **default-deny** on a TTL. |
| **First gated capability** | **Agent-chosen vault writes.** |

Decided here, in the manner of phase-1 §2:

| Item | Decision | Why |
|---|---|---|
| **Proposal vs direct tool** | The agent proposes; the daemon executes. | Preserves phase-1 §13's structural property: the daemon still performs every side effect on paths it validates. |
| **Tool return value** | `{ proposed: 'prp_…' }`, never the outcome. | An agent that observes its own approval result inside the turn can retry until it gets a yes, and the transcript stops being evidence of one decision. The cheaper alternative — block the tool on the decision — also holds a `control`-lane slot for the whole TTL and makes a 15-minute human latency an agent-visible timeout. |
| **Writable surface** | An **allow-list**, not the deny-list (§5.1). | Revision 1 said "any file under `wiki/` or `inbox/`" and no such rule exists; `VaultWriter.check` is a deny-list of three prefixes (`src/vault/writer.ts:15`), so `.gitignore`, `.stignore`, `index.md`, `research/` and `archive/` were all approvable. |
| **Approval identity** | `approval_id` (ULID, new `apv` prefix in `src/core/ids.ts`) plus `subject_hash` over kind + path + proposed body **+ the current on-disk content hash of the target**. | Binding only the proposal guards a case that cannot happen (the proposal is immutable) and misses the one that can: the file changing under an approval in flight. |
| **TTL** | `approvals.ttl_seconds`, default **900**. Precision is the tick period (30 s), which is stated rather than implied. | |
| **Concurrency** | Decisions are serialized per approval via the bus's existing `serial_key` (`src/core/bus.ts:26`), and the state transition is a conditional `UPDATE … WHERE state = 'requested'`. | `control` has `max_concurrent = 2`; without both, a double-tap performs the write twice. |
| **Where approvals run** | The `control` lane. No new lane, no fourth admission point. | phase-1 invariant 8. |
| **Sentinel mode** | Works because of §2.1, not because the prompt is templated. | Revision 1 asserted the outcome and skipped the mechanism. |
| **Callback authorization** | Chat **and** sender, matching inbound (`src/channels/telegram/index.ts:122-123`, phase-1 §8.3). Mismatch is `security.unauthorized_decision`, rate-limited per sender. | Revision 1 checked the sender only. Every group member can hold a button down. |

---

## 4. The approval broker

### 4.1 The proposal pattern

```ts
type Proposal = {
  id: string;               // prp_<ulid>
  kind: 'vault.write';      // the union is where later capabilities land
  subject: VaultWriteSubject;
  rationale: string;        // agent-authored, untrusted, rendered under §4.4's rules
  origin: IdTuple['origin'];// the proposing job's origin, carried through
  trace_id: string;         // the proposing turn's trace — the decision joins it, never forks it
};
```

The daemon, on receiving a proposal:

1. Validates against the allow-list (§5.1) **and** `VaultWriter.check`. A proposal that would be
   refused is refused now, with `approval.rejected_invalid`.
2. Computes `subject_hash` including the target's current content hash.
3. Opens an approval row and submits a `control`-lane, `llm: false` delivery job with
   `serial_key = approval_id`.

### 4.2 Lifecycle and the ledger

```
proposed ──► requested ──┬──► granted ──► performed
                         ├──► denied
                         ├──► expired          (TTL, default-deny)
                         └──► superseded       (target changed; §4.5)
```

```sql
CREATE TABLE approvals (
  approval_id   TEXT PRIMARY KEY,
  proposal_id   TEXT NOT NULL UNIQUE,
  state         TEXT NOT NULL,          -- requested|granted|denied|expired|superseded|performed
  kind          TEXT NOT NULL,
  subject       TEXT NOT NULL,          -- JSON
  subject_hash  TEXT NOT NULL,
  trace_id      TEXT NOT NULL,
  origin        TEXT NOT NULL,
  session_id    TEXT,                   -- iff origin = 'channel'
  requested_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  decided_at    TEXT,
  external_id   TEXT,                   -- set AFTER delivery; NULL means never delivered
  UNIQUE (approval_id)
);
CREATE INDEX approvals_state ON approvals(state, expires_at);
```

Every transition is an event, and the row is the authority for state; the JSONL remains the
authority for history. `os approvals reindex` is **not** possible — unlike the events index, this
table is not derivable from the log, because the log cannot record a decision the daemon never
observed. That is a deliberate exception to phase-1 invariant 2 and is called out in §13.

Transitions the diagram must handle and revision 1 did not:

- **`granted` → `expired` cannot happen.** The sweep operates on `state = 'requested'` only.
- **A grant racing the sweep** is resolved by the conditional UPDATE: whichever transaction commits
  first wins, the loser emits `approval.decision_late`.
- **Stranded `granted`.** A perform that dies leaves `granted` with no `performed`. This is
  indistinguishable from an in-flight perform *by state alone*, so the row carries `decided_at` and
  the heartbeat (§6) reports `granted` rows older than a threshold. The boot sweep reports them
  too; neither retries. An approval is permission to act once, not an instruction that must
  eventually happen.
- **`external_id` is written after delivery.** `requested` with `external_id IS NULL` past a tick
  means the prompt was never posted — a state the boot sweep expires with a distinct reason,
  because the bus queue is in memory (`src/core/bus.ts:40`) and nothing re-sends.

The boot sweep runs **before channels start** (`src/daemon.ts:171-188`), not on the first tick,
which is +30 s after they do. Otherwise a TTL that elapsed while the daemon was down can still be
granted by a tap in the first half minute.

### 4.3 The decision's identity

A decision on a proposal from a background job arrives over a channel. Revision 1 left this
unspecified, and both available answers break an invariant.

**Decided:** the decision event keeps the **proposal's** `origin` and `trace_id`, so it joins the
turn or job that proposed it (invariant 4) and does not fabricate a `session_id` for background
work (invariant 5). The channel the decision arrived on is payload — `via_channel`,
`via_message_id`, `decided_by` — not identity. The button press is a fact *about* the proposal, not
a message that starts something.

### 4.4 Telegram delivery

The message is daemon-templated and costs no tokens. The rationale is **agent-authored text**, and
therefore untrusted:

- It is rendered inside a fenced block, truncated to `approvals.rationale_max_chars` (default 280),
  with newlines collapsed. Revision 1 pasted it in raw, which let injected content forge a second
  approval block with a different path and a later expiry — `sendMessage` sends no `parse_mode`
  (`src/channels/telegram/api.ts:51`) so markdown is inert, but newlines are not.
- The **path** is rendered from the validated subject, never from the rationale, and is shown with
  non-ASCII characters escaped: a homoglyph path renders identically to an existing file while
  hashing differently.
- The whole message is length-checked so it cannot reach `splitMessage`
  (`src/channels/telegram/index.ts:33`). A prompt that shards across three messages puts the path
  in part 1 and the keyboard in part 3, and past three parts becomes a document with no keyboard at
  all — a guaranteed expiry.

`callback_data` is `apv:<approval_id>:<verdict>`, under Telegram's 64-byte limit.

**None of this exists today.** `src/channels/telegram/api.ts` has no `answerCallbackQuery`, no
`editMessageReplyMarkup`, and never sends `reply_markup`; `normalize()` returns `null` for
`callback_query` while the offset still advances (`index.ts:81-96`), so decisions would be
consumed and discarded. M2 is that work, and the fake Bot API server needs the same three methods
before it can test any of it.

### 4.5 Replay and supersession

`subject_hash` is re-checked at perform time against both the proposed body and the target's
current content. A mismatch is `approval.superseded` — the write does not happen. This is the case
that actually occurs: Chris edits the file on his phone while the prompt sits unanswered.

### 4.6 The security lane

`security.*` and `approval.*` events are never model-authored. Revision 1 claimed "the kind
registry enforces this at emit time"; it does not — `KINDS` maps kind to *payload* schema only and
`CauseSchema` is kind-blind (`src/core/envelope.ts`). Worse, `strict` is **off in production**
(`src/daemon.ts:88,110`), so a violation is written to the log with `_schema_error` appended rather
than refused.

**Specified:** the registry gains an optional `causes: CauseKind[]` per kind, checked in `emit()`,
and `strict` is on in production for this class of violation. The agent's rationale travels in the
`approval.proposed` **payload**, where it is data; the event's own cause is `computed`. Revision 1
gave that event a `self-reported` cause, contradicting its own rule one section later.

### 4.7 Class grants — cut

Revision 1 specified `Approve <prefix> for 1h`. It is removed from 2a:

- Its only consumer was the librarian pass, which 2a no longer builds (§9).
- It had no revocation, only expiry — the mitigation offered for it in revision 1 ("grants are
  events") does not stop a live one.
- Combined with §5.2 it was the amplifier that made a prompt-injected proposal catastrophic rather
  than annoying: one tap, one hour, every file under `wiki/`.
- "Ten prompts a night is too many" was a prediction about unbuilt code.

The button layout is therefore `[ Approve ] [ Deny ]`. If prompt fatigue turns out to be real,
it will be real with evidence, and a bounded grant (count *and* time, with revocation) can be
designed then.

### 4.8 Event kinds

| Kind | Payload | Cause |
|---|---|---|
| `approval.proposed` | `proposal_id`, `kind`, `subject`, `subject_hash`, `rationale` | `computed` |
| `approval.rejected_invalid` | `proposal_id`, `reason` | `computed` |
| `approval.requested` | `approval_id`, `proposal_id`, `expires_at` | `computed` |
| `approval.delivered` | `approval_id`, `channel`, `external_id` | `computed` |
| `approval.granted` | `approval_id`, `via`, `decided_by` | `user` |
| `approval.denied` | `approval_id`, `via`, `decided_by` | `user` |
| `approval.expired` | `approval_id`, `reason` (`ttl` \| `never_delivered`) | `computed` |
| `approval.superseded` | `approval_id`, `expected`, `actual` | `computed` |
| `approval.decision_late` | `approval_id`, `state`, `verdict` | `computed` |
| `approval.performed` | `approval_id`, `result_event` | `computed` |
| `approval.stranded` | `approval_id`, `granted_at` | `computed` |
| `security.unauthorized_decision` | `approval_id`, `from`, `suppressed` | `computed` |
| `daemon.tick_failed` | `task`, `error` | `computed` |

`capPayload` drops the longest top-level string when a payload exceeds the cap
(`src/core/envelope.ts:130-146`) — for `approval.proposed` that would be the body, so `subject` is
stored as `{ path, bytes, sha256 }` and the body itself never enters the event. The event log
records *what was approved*, not the content.

---

## 5. Agent-chosen vault writes

### 5.1 The allow-list

```
wiki/**            EXCEPT  wiki/projects/*/session-brief.md
inbox/**
```

Everything else is refused, including every path revision 1 left open by relying on the deny-list.
`VaultWriter` keeps its deny-list for the daemon's own writes; proposals are checked against the
allow-list **first**, then the deny-list.

### 5.2 Why `session-brief.md` is excluded — the finding that changed this design

`session-brief.md` lives at `wiki/projects/<topic>/session-brief.md`
(`src/sessions/lifecycle.ts:209`) and is what a rehydrated session reads (phase-1 §7.4). An
approved write to it is not a wiki edit; it is the agent editing its own future prompt. Revision 1
both allowed it and offered `Approve wiki/ for 1h` as an example.

The general form is worse than the instance: **anything the agent writes and later reads back is a
persistent injection channel.** `index.md` and `MEMORY.md` are in VAULT.md's mandatory read order
(phase-1 §10.2). This is why §5.1 is an allow-list, why `MEMORY.md` is not proposable in 2a, and
why the memory promotion gate is deferred rather than sketched-and-built (§9).

### 5.3 The blast radius, restated honestly

An approved write can create or rewrite a note under `wiki/` or `inbox/`, excluding the brief. It
cannot touch `human/`, `VAULT.md`, `MEMORY.md`, `index.md`, `.gitignore`, `.stignore`, the event
log, the database, or anything outside the vault. It **can** still influence a later session that
happens to read that note. That residual is the honest cost of the capability, and it is why the
prompt shows the path and the diff size, and why every write is committed with `Session:` and
`Event:` trailers.

---

## 6. Cron and the heartbeat checklist

Phase 1 deferred two jobs here (the nightly `log/` commit, §10.4; the nightly join audit, §6.3) and
left the heartbeat checklist's content to this document (§11.5).

- **Schedule:** `[[cron]]` entries — `{ name, schedule, lane, job, llm }` — evaluated in the daemon
  tick. Timezone is `daemon.timezone`; **`Clock` gains a timezone-aware local-date API**, since it
  exposes only UTC today (`src/core/clock.ts`).
- **Firing state:** a `cron_runs` table keyed `(name, fire_time)`. A 30 s tick evaluating a
  minute-resolution expression matches the same minute twice; without a firing key the 07:00 brief
  fires at `07:00:05` and again at `07:00:35`.
- **Re-entrancy:** one run per `name` at a time, enforced with the bus `serial_key`.
- **Catch-up:** `catchup_grace_minutes` (default 120, and it appears in §8's config surface, which
  revision 1 forgot). Missed beyond that emits `cron.skipped`.
- **DST:** jobs scheduled in the 02:00–02:59 window are rejected **at config load**, not at
  runtime, because that hour does not exist on spring-forward and occurs twice on fall-back.
- **Checklist** (all pure code, runs in sentinel mode by §2.1): process liveness, last-event age,
  event-log write latency, SQLite integrity, disk free on data and vault volumes, per-lane queue
  depth, OTLP export errors, Telegram poll age, approvals `requested` past TTL, approvals stranded
  in `granted`. Each item has an explicit threshold and a consecutive-failure count before it
  alerts; a single WSL2 disk blip must not page anyone.
- **Overlap with `os doctor`:** the checklist is the authority at runtime, `doctor` is the authority
  at setup. Where they check the same thing they call the same function.

---

## 7. Test plan

| Claim | Gate |
|---|---|
| A zero-LLM `control` job is admitted with both windows exhausted | unit, `src/core/meter.ts` |
| The vault's "today" follows `daemon.timezone` and moves with the fake clock | unit + boundaries test |
| A tick task that throws does not kill the other tick tasks | integration |
| A proposal outside the allow-list is refused before Chris is asked | unit |
| `wiki/projects/x/session-brief.md` is refused | unit |
| An unanswered approval expires denied, and a restart does not resurrect it | integration, fake clock + restart before channels start |
| A double-tap performs exactly one write | integration, two concurrent callbacks |
| A press from a non-owner changes nothing and is rate-limited | integration, forged `callback_query.from` |
| A target edited under an in-flight approval supersedes it | integration |
| An approval never delivered expires with `never_delivered` | integration |
| Cron fires once per window, skips a stale one, and rejects a DST-ambiguous schedule | integration, fake clock |
| The whole loop against the real bot: request, deny, request, approve, perform | **live**, `docs/RUNBOOK-phase2a.md` |

`docs/VERIFICATION.md` gains `live-approvals`.

---

## 8. Config surface

```toml
[approvals]
enabled = true
ttl_seconds = 900
rationale_max_chars = 280
unauthorized_rate_limit_per_minute = 3

[cron]
catchup_grace_minutes = 120

[[cron]]
name = "nightly-log-commit"
schedule = "5 0 * * *"
lane = "control"
job = "vault.commit_log"
llm = false
```

No `${VAR}` reference enters the committed config unless every host must set it: `resolveEnv`
throws on an unresolved reference **before** validation (`src/core/config.ts:143-146`), so a
reference for a disabled subsystem makes the daemon unbootable. Revision 1 put
`whisper_model = "${WHISPER_MODEL_PATH}"` in the committed surface.

---

## 9. Sketched, not specified

Each of these needs its own design before it is built. Recorded here so the thinking is not lost.

- **Capture (whisper + classifier).** No model is installed on any host this runs on, and the
  container image (`compose/daemon.yml`) mounts no binary — capture would fail at exec time inside
  the deployment the `container` gate certifies. Open: local vs API transcription (revision 1 chose
  local, and that choice stands only if local proves usable), temp-file ownership and deletion,
  subprocess timeouts, concurrency, and the classifier's failure branch, which revision 1's diagram
  did not have. Also: capture in the `librarian` lane is droppable background work at `share >= 0.7`
  — a user's voice note is not background work.
- **Librarian, morning brief, weekly review.** Three LLM subsystems that revision 1 gave five
  bullets. Each needs input selection, prompt, output schema and failure path. The brief is in the
  `synthesis` lane, so a heavy night suppresses the one report that would explain the suppression;
  it needs a zero-LLM skeleton fallback.
- **Memory promotion gate.** Nothing writes `MEMORY.md` today, and §5.1 makes it unproposable.
  The gate needs the capability to exist first.
- **ntfy.** One HTTP POST. `127.0.0.1` inside a container is the container — the exact defect
  already recorded against Langfuse in `compose/README.md`. Needs a reachable address and a named
  reader for its own delivery-failure event.
- **Syncthing.** `.stignore` excludes `inbox`, `log`, `attachments` and `.git`
  (`src/vault/bootstrap.ts:26-32`), so captured notes are invisible on the phone and synced edits
  arrive as unversioned mutations in a tree the daemon commits to. The `.sync-conflict-*` pattern
  in `GITIGNORE` (`bootstrap.ts:21`) does not match Syncthing's actual filenames. This is a design
  problem, not a deployment step.

---

## 10. Operator surface

Revision 1 named `os approvals` once and specified nothing.

```
os approvals                       outstanding, with age and expiry
os approvals show <id>             the subject, the hash, the rationale, the state history
os approvals deny <id>             the escape hatch when Telegram is the broken thing
os approvals stranded              granted, never performed
```

`via: 'cli'` exists in §4.8 because these commands emit it.

---

## 11. Milestones

| M | Content | Done when |
|---|---|---|
| **M0** | §2's three corrections | Each has its gate green; the boundaries test fails on a reintroduced `Date.now()` |
| **M1** | `approvals` table, states, kinds, TTL sweep, boot sweep | Integration: request → expire → denied, across a restart, with no race in the first 30 s |
| **M2** | Telegram: `reply_markup`, `answerCallbackQuery`, `editMessageReplyMarkup`, callback normalisation, and the same three in the fake server | Integration incl. forged sender and double-tap |
| **M3** | `propose_vault_write`, allow-list, `subject_hash`, perform, supersession | Live: a real approval performs a real wiki write; a real denial does not |
| **M4** | `os approvals` surface | Integration: deny from the CLI while Telegram is down |
| **M5** | Cron + heartbeat checklist + the two Phase 1 deferrals | Integration with a fake clock; a thrown tick task does not stop the others |

---

## 12. Risks and questions for Chris

1. **The residual injection channel is real** (§5.3). Excluding `session-brief.md` closes the
   direct path; a note the agent wrote and later reads is still influence. The alternative is to
   forbid the agent reading anything it wrote, which would make the capability useless.
2. **Default-deny will bite.** The first time something silently does nothing because you were
   asleep, it will feel like a bug. It is not. Nothing in 2a reports it to you, though — that was
   the morning brief's job and the brief is deferred (§9). `os approvals` is the stopgap.
3. **The ledger is not rebuildable** (§4.2) — a deliberate exception to invariant 2. Losing
   `aleph.db` loses approval state while the JSONL still reads `requested`. phase-1 §5.5 names
   litestream and nothing implements it.
4. **The prompt is only as good as its subject line.** If M3 shows path + size is not enough to
   decide on a phone, the fix is a diff preview, which is a design change.
5. **Confirm:** cutting class grants; deferring capture, librarian, brief, memory gate, ntfy and
   Syncthing out of 2a entirely; and 15 minutes as the TTL.

---

## 13. Corrections this design took from being red-teamed

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
