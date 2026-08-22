# Aleph-next — Phase 2a ("Autonomy under approval") detailed design

**Status:** implementation design, derived from `docs/design/phase-1.md`, which is the authority
for everything it settles. Phase 1 was itself derived from `aleph-next-design-v1.0.md` §11 and
`cockpit-spec-v0.2.md` §4; **neither of those documents is in this repository or recoverable on
the build host** (2026-08-21). Their F-numbered requirements survive only where phase-1.md quotes
them. Where this document cites a requirement it cites the phase-1 section that carries it, never
the upstream number — a citation nobody can resolve is worse than no citation.

**Scope of authority:** this document decides the items phase-1.md deferred to 2a and specifies
the approval broker, the first gated capability, the background subsystems, and the test plan for
all of it. It does not re-open Phase 1's settled decisions (§2 of that document, and the six
confirmed in its §16.4).

---

## 1. What 2a is

Phase 1 is a **remembering agent that cannot act**. Its safety argument is structural: the agent
has no tools, so there is no path from a message to a file write, a command, or a request
(phase-1 §13). Phase 2a is where that stops being true.

The whole of 2a is therefore organised around one question: *what replaces "it has no tools" as
the reason this is safe?* The answer is the approval broker, and it is built first, before the
first tool exists to need it.

### 1.1 In scope

| Subsystem | One-line contract |
|---|---|
| **Approval broker + security lane** (§3) | No side effect the agent chose happens without a recorded human decision or a recorded default-deny. |
| **Agent-chosen vault writes** (§4) | The first gated capability. The agent proposes a path and body; the daemon writes it, or does not. |
| **Heartbeat and cron** (§5) | A scheduler that fires jobs on the clock, degrades to pure code in sentinel mode, and never silently stops. |
| **Capture pipeline** (§6) | Voice and text in, transcribed and classified, into `vault/inbox/`. |
| **Librarian, morning brief, memory promotion gate** (§7) | The nightly pass that turns inbox and log into wiki and `MEMORY.md`, and the 07:00 / Sunday 18:00 briefs. |
| **ntfy** (§8) | Out-of-band push for things that must reach Chris when Telegram is not where he is looking. |
| **Syncthing** (§9) | The vault on more than one device, with `.stignore` already written in Phase 1. |

### 1.2 Explicitly out of scope

Verification kernel (2b). Cockpit UI (2b) — 2a continues to ship *the event log the cockpit is a
view over*, and adds the approval ledger it will render. Research (3). Semantic index (4). Shell
execution and web egress for the agent (deliberately **not** in 2a; see §4.4 — the broker is
proven against the narrowest capability first, and widening it is a later decision with its own
design).

### 1.3 The one non-negotiable of Phase 2a

> **Every side effect the agent chose is preceded by an approval decision in the event log, and
> that decision is either a human's or the broker's own default-deny. There is no third case, and
> no code path that performs an agent-chosen side effect without consulting the broker.**

Phase 1's non-negotiable was that nothing is claimed without being run. That still holds. This one
is additive: 2a's runbook must show a real denial, a real expiry, and a real approval, against the
real Telegram bot.

---

## 2. Decisions on the open items

Confirmed by Chris on 2026-08-22 (the three that forked the design):

| Item | Decision | Consequence |
|---|---|---|
| **Document shape** | One `phase-2a.md` covering all six subsystems, milestones inside | This document. Longer before anything runs, one authority to review. |
| **Approval delivery** | Telegram **inline keyboard**, **default-deny** on a TTL | The adapter gains `buttons` for real (it already declares the capability), and the daemon gains a callback path (§3.3). Silence is a denial, so an unattended daemon cannot act by inattention. |
| **First gated capability** | **Agent-chosen vault writes** | Narrowest real escalation: `VaultWriter` already refuses the prohibited paths, so the broker is proven against a blast radius that is already fenced (§4). |

Decided here, in the manner of phase-1 §2 — these are implementer's calls, recorded so they are
not re-litigated:

| Item | Decision | Why |
|---|---|---|
| **Proposal vs direct tool** | The agent gets a tool that **proposes**; the daemon executes. `allowedTools` stays effectively empty of anything that acts. | Preserves phase-1 §13's structural property — the daemon still performs every side effect on paths it validates. The tool returns "proposed, id X", not a result. |
| **Approval identity** | An approval is keyed by `approval_id` (ULID) **and** a `subject_hash` = SHA-256 over the exact normalised action (kind, path, content hash). | A button press approves *that* action, not "the last thing you asked". A proposal that changes after approval fails closed. |
| **Scope of an approval** | Single-use by default; `Approve for 1h` grants a **class** (kind + path prefix) with an expiry, recorded as its own event. | The three-button layout Chris chose implies a class grant; making it explicit and expiring keeps it auditable. |
| **TTL** | `approvals.ttl_seconds`, default **900** (15 min). | Long enough to notice a phone notification, short enough that a stale prompt is not sitting live overnight. |
| **Where approvals run** | The `control` lane, which phase-1 §4.3 already reserves for "approvals, alerts, verification of in-flight work". No new lane. | Lane admission stays in exactly three places (phase-1 invariant 8). |
| **Sentinel mode** | Approval prompts and decisions are **daemon-templated, zero-LLM**, so they continue to work when the window is exhausted (phase-1 §11.5). | An exhausted window must not silently disable the safety mechanism; it disables the *work*, not the gate. |
| **Callback authorization** | `callback_query.from.id` is checked against `owner_user_id` exactly as inbound messages are (phase-1 §8.3), and a mismatch is a **security event**, not a dropped update. | The buttons are posted in a group. Anyone added to that group can press them. |
| **Capture transcription** | Local `whisper.cpp` via a subprocess, model path in config. No audio leaves the host. | Audio is the most private thing the system will hold. Sending it to an API for convenience is the wrong default; if it proves unusable, that is a decision to revisit with evidence. |
| **Classifier** | One LLM call in the `librarian` lane, structured output, on the *transcript*, never on the audio. | It is a routing decision over text, which is the cheapest thing the model does well. |
| **ntfy vs Telegram** | ntfy carries **only** what must arrive when Telegram is not being watched: sentinel entry, heartbeat failure, and approval expiry. Everything else stays in Telegram. | Two notification channels that both carry everything is one channel nobody reads. |

---

## 3. The approval broker

### 3.1 The proposal pattern

The agent never acts. It **proposes**, and the proposal is data:

```ts
type Proposal = {
  id: string;               // prp_<ulid>
  kind: 'vault.write';      // 2a ships exactly one kind (§4); the union is where new ones land
  subject: VaultWriteSubject;
  rationale: string;        // cause.kind 'self-reported' — text already in the transcript
  session_id?: string;      // present iff the proposal came from a channel turn
};
```

The SDK tool the agent is given is `propose_vault_write`, and its return value is
`{ proposed: 'prp_…' }` — never the outcome. The turn ends without knowing whether it happened.
This is deliberate: an agent that can observe its own approval outcome inside the same turn can
retry until it gets a yes, and the transcript stops being evidence of a single decision.

The daemon, on receiving a proposal:

1. Validates the subject against the same rules `VaultWriter` enforces (phase-1 §10.4). A proposal
   that would be refused is refused **now**, with `approval.rejected_invalid` — Chris is never
   asked to approve something that cannot be performed.
2. Computes `subject_hash`.
3. Checks standing class grants (§3.4). A match short-circuits to granted, with the grant's id
   recorded as the cause.
4. Otherwise opens an approval and submits a `control`-lane job to deliver it.

### 3.2 Lifecycle

```
                 ┌────────────► rejected_invalid   (fails our own validation)
                 │
proposed ──► requested ──┬──► granted ──► performed
                         ├──► denied
                         └──► expired            (TTL elapsed, default-deny)
```

Every transition is an event. `performed` is not an approval state so much as the join point: it
carries the `approval_id` **and** the resulting `vault.written` event id, so "what did this
approval actually cause" is one query, not a reconstruction.

States are persisted in SQLite (`approvals` table) because the daemon must survive a restart with
a prompt outstanding. On boot, any approval still in `requested` whose TTL has elapsed while the
daemon was down is expired immediately, with a cause that says so — a restart is not an approval.

### 3.3 Telegram delivery

The message is daemon-templated. No model is in the path, which is what lets it work in sentinel
mode:

```
🔐 Approval — vault write
wiki/projects/aleph-next.md  (rewrite, 2.1 KB)

"…the session brief says the soak started, so I want to record it
 in the project page." — self-reported

expires 15:42 (15m)
[ Approve ]  [ Deny ]  [ Approve wiki/ for 1h ]
```

`callback_data` is `apv:<approval_id>:<verdict>`, under Telegram's 64-byte limit. The adapter's
job stops at normalisation (phase-1 invariant 7): it turns a `callback_query` into

```ts
type InboundDecision = {
  approval_id: string;
  verdict: 'grant' | 'deny' | 'grant_class';
  from: string;            // telegram user id, unvalidated
  callback_id: string;     // for answerCallbackQuery
};
```

and hands it off. Authorization, state transition and idempotency are the broker's, in the daemon.

- `from !== owner_user_id` → `security.unauthorized_decision`, the callback is answered with a
  neutral toast, and **the approval is not touched**. It is a security event because it is someone
  in the group pressing a button meant for Chris, and it must be as visible as an unauthorized
  message.
- A decision on an approval that is no longer `requested` → answered with what actually happened
  ("already expired"), no state change, `approval.decision_late` recorded. Double-taps and stale
  phone screens are normal and must be boring.
- On success the keyboard is edited away and replaced with the outcome, so the message is not a
  live button after the fact.

### 3.4 Default-deny, class grants, replay

- **Default-deny.** A `requested` approval whose TTL elapses becomes `expired`, and expiry is a
  denial with a different reason, not a separate outcome. The daemon tick (already the third and
  final admission point, phase-1 §11.4) sweeps expiries; no new timer subsystem.
- **Class grants.** `Approve <prefix> for 1h` writes an `approval.class_granted` with
  `{ kind, path_prefix, expires_at }`. Subsequent matching proposals short-circuit, each emitting
  its own `approval.granted` with `cause.kind: 'user'` and `source` naming the *grant* event —
  so a month later it is answerable why a write happened at 03:00 with nobody awake.
- **Replay.** `subject_hash` is checked at perform time. If the proposal's content changed between
  request and grant, the perform fails closed with `approval.subject_changed`. There is no path
  where a button approves one thing and another is performed.
- **Idempotency.** `approval.performed` is written *after* the side effect, carrying the
  `vault.written` id it caused. A crash between grant and write therefore leaves an approval in
  `granted` with no `performed`, and the boot sweep **reports** that rather than retrying it. An
  approval is permission to act once, not an instruction that must eventually happen.

### 3.5 The security lane

Phase-1 §4.3 reserves `control` for approvals. 2a adds no lane. What it adds is a **class of event
that is never model-authored**: everything under `security.*` and `approval.*` has
`cause.kind: 'computed'` or `'user'`, never `'self-reported'`. The kind registry enforces this at
emit time — a `self-reported` cause on a security event is a schema violation, not a code review
comment.

### 3.6 New event kinds

| Kind | Payload | Cause |
|---|---|---|
| `approval.proposed` | `proposal_id`, `kind`, `subject`, `subject_hash` | `self-reported` (the agent's rationale) |
| `approval.rejected_invalid` | `proposal_id`, `reason` | `computed` |
| `approval.requested` | `approval_id`, `proposal_id`, `channel`, `external_id`, `expires_at` | `computed` |
| `approval.granted` | `approval_id`, `via` (`button` \| `class_grant` \| `cli`), `grant_id?` | `user` |
| `approval.denied` | `approval_id`, `via` | `user` |
| `approval.expired` | `approval_id`, `ttl_seconds` | `computed` |
| `approval.class_granted` | `grant_id`, `kind`, `path_prefix`, `expires_at` | `user` |
| `approval.class_expired` | `grant_id` | `computed` |
| `approval.decision_late` | `approval_id`, `state`, `verdict` | `computed` |
| `approval.subject_changed` | `approval_id`, `expected`, `actual` | `computed` |
| `approval.performed` | `approval_id`, `result_event` | `computed` |
| `security.unauthorized_decision` | `approval_id`, `from` | `computed` |

Added to `KINDS` in `src/core/envelope.ts` with Zod payloads, `docs/EVENTS.md` regenerated
(phase-1's "adding an event kind" procedure, three steps, CI-enforced).

---

## 4. Agent-chosen vault writes

### 4.1 What changes

Today: the daemon writes `log/<today>.md` from the turn's output, on a path it chooses.
In 2a: the agent may additionally *propose* a write to `wiki/**` or `inbox/**`, with a path and a
body it chooses.

### 4.2 What does not change

`VaultWriter` remains the only thing that touches the vault, and it refuses rather than sanitises
(phase-1 invariant 6). The prohibition table is unchanged: `human/**` and `VAULT.md` refuse,
`MEMORY.md` has a line budget, `log/` is today-only, `../` escapes are refused. **A proposal is
validated against these before Chris is asked**, so the broker never surfaces a request that would
fail anyway.

### 4.3 The blast radius, stated plainly

An approved write can create or rewrite any file under `wiki/` or `inbox/`. It cannot touch
`human/`, `VAULT.md`, the event log, the database, the config, or anything outside the vault. The
worst case is a wrong or destructive edit to Chris's own wiki — recoverable, because every write
is committed with `Session:` and `Event:` trailers (phase-1 §10.4) and `vault.commit_failed` now
says so when it is not (2026-08-21).

### 4.4 Why not more

Shell and web egress are excluded from 2a on purpose. Phase-1 §13 notes the lethal trifecta cannot
form while egress does not exist; adding egress in the same phase that first adds tools would
retire the structural argument and the procedural one's proof at the same moment. The broker earns
its wider scope by first being correct against a capability whose failure is a bad wiki edit.

---

## 5. Heartbeat and cron

Phase 1 ships a stub heartbeat (health ping, zero-LLM) and a daemon tick. 2a makes it a scheduler.

- **Schedule source:** `config/aleph.toml` `[[cron]]` entries — `{ name, schedule, lane, job }`,
  where `schedule` is a 5-field cron expression interpreted in `daemon.timezone`
  (`America/Los_Angeles`, confirmed §16.4).
- **Firing:** the existing daemon tick evaluates due jobs. No new timer, no new admission point.
- **Catch-up:** a job whose window was missed while the daemon was down fires **once** on boot if
  it is still within `catchup_grace_minutes`, otherwise it is skipped with `cron.skipped`. A
  morning brief delivered at 14:00 because the laptop was shut is worse than no brief.
- **The checklist** (phase-1 §11.5 defers its content here): process liveness, last event age,
  event-log write latency, SQLite integrity check, disk free on the data and vault volumes, queue
  depth per lane, OTLP export error count, Telegram poll age, and — new — approvals outstanding
  and class grants live. Every item is pure code. In sentinel mode this is the whole heartbeat.
- **Failure is loud:** `heartbeat.failed` goes to ntfy (§8), not only to Telegram, because the case
  that matters is the one where the daemon is unwell and Chris is not looking at the group.

Jobs 2a schedules: the librarian pass, the morning brief (07:00), the weekly review (Sunday 18:00),
the nightly `log/` commit (phase-1 §10.4 defers it here), the nightly join audit (phase-1 §6.3),
and class-grant expiry sweep.

---

## 6. Capture pipeline

```
voice note / text  ──►  telegram adapter  ──►  capture job (librarian lane)
                                                 │
                                    ┌────────────┴────────────┐
                                    │                         │
                             whisper.cpp                  (text: skip)
                                    │                         │
                                    └────────────┬────────────┘
                                                 ▼
                                        classifier (1 LLM call)
                                                 ▼
                                   VaultWriter → vault/inbox/<date>-<slug>.md
```

- Telegram `voice` and `audio` messages are downloaded via `getFile` to a temp path the daemon
  owns. Audio is **not** written into the vault; the transcript is.
- `whisper.cpp` runs as a subprocess with the model path from config. A missing model is a
  `doctor` failure, not a runtime surprise.
- The classifier returns `{ title, tags, kind: 'note'|'task'|'idea'|'reference', body }` as
  structured output. It runs on the transcript.
- The inbox file carries the source message id and the transcript's confidence, so a bad
  transcription is diagnosable rather than mysterious.
- Capture is a **background** origin (`origin: 'cron'`/`'librarian'`, no `session_id` — phase-1
  §5.1's rule holds: no pseudo-sessions for background work).

---

## 7. Librarian, morning brief, memory promotion gate

- **Librarian pass** (nightly, `librarian` lane): reads yesterday's `log/` and `inbox/`, proposes
  wiki edits **through the broker** — the librarian is an agent with the same tool and the same
  gate, not a privileged path. This is the first real test of class grants: a nightly pass that
  needs ten writes should ask once, not ten times.
- **Morning brief** (07:00): a daemon-templated skeleton filled by one `synthesis`-lane call —
  what happened yesterday, what is outstanding, what the heartbeat is unhappy about, and any
  approvals that expired unanswered. Delivered to the Telegram `General` topic.
- **Weekly review** (Sunday 18:00): the same shape over seven days, plus meter actuals against the
  configured capacity — which is how phase-1 §16.1's "the numbers are a guess" gets closed with
  evidence rather than another guess.
- **Memory promotion gate:** nothing reaches `MEMORY.md` without a proposal and an approval. The
  line budget stays. Promotion is the highest-leverage write in the system — it changes what the
  agent believes — and it is the one place where "ask every time" is correct.

---

## 8. ntfy

Self-hosted, tailnet-only, one topic. Carries exactly three things: sentinel entry/exit,
`heartbeat.failed`, and `approval.expired`. Delivery failure is itself an event; a notification
channel that fails silently is worse than none.

---

## 9. Syncthing

The vault, on the laptop and the phone. `.stignore` was written in Phase 1 and its contents are
the scope — read from `src/vault/bootstrap.ts`, not from memory:

```
.git
attachments
log
inbox
.obsidian
```

So Syncthing carries `wiki/`, `human/`, `MEMORY.md`, `index.md` and `VAULT.md`, and deliberately
does **not** carry the episodic log, the inbox or attachments: the durable, hand-edited layer
syncs; the machine's working set does not.

**This collides with capture (§6), which writes into `inbox/`.** A voice note captured on the
phone would land in an inbox the phone cannot see. Three ways out, and it is a decision, not a
detail: (a) sync `inbox/` and accept conflict files on the noisiest directory; (b) leave capture
output invisible on the phone until the librarian promotes it to `wiki/` — which makes the
librarian pass the only way to see your own note; (c) have the capture job deliver the inbox entry
back into the Telegram topic as a message, so the phone sees the *content* without syncing the
*file*. (c) is the default this document assumes, because it keeps the sync scope honest and the
feedback immediate; it is question 6 in §13.

Conflict files (`*.sync-conflict-*`) are surfaced by the heartbeat rather than resolved
automatically — a three-way merge of Chris's notes is not the daemon's decision to make.

---

## 10. Config surface additions

```toml
[approvals]
enabled = true
ttl_seconds = 900
class_grant_max_seconds = 3600
channel = "telegram"          # where prompts are delivered

[capture]
enabled = true
whisper_bin = "/usr/local/bin/whisper-cli"
whisper_model = "${WHISPER_MODEL_PATH}"
max_audio_seconds = 600

[ntfy]
enabled = true
base_url = "http://127.0.0.1:8080"
topic = "aleph"

[[cron]]
name = "morning-brief"
schedule = "0 7 * * *"
lane = "synthesis"
job = "brief.morning"
```

---

## 11. Test plan

Layers as phase-1 §14. What is new and what proves it:

| Claim | Gate |
|---|---|
| A proposal that violates the vault rules is refused before Chris is asked | unit, `approvals` |
| An unanswered approval expires denied, and a restart does not resurrect it | integration, fake clock + daemon restart |
| A button press from a non-owner is a security event and changes nothing | integration, fake Bot API server with a forged `callback_query.from` |
| A double-tap and a tap on an expired prompt are boring | integration |
| A proposal whose content changed between request and grant fails closed | integration |
| A class grant short-circuits and expires | integration, fake clock |
| The whole loop works against the real bot: request, deny, request, approve, perform | **live**, recorded in `docs/RUNBOOK-phase2a.md` |
| Approvals still work with the window exhausted | integration, forced sentinel |
| Capture: a real voice note becomes an inbox file | live |
| Cron fires on schedule, skips a stale window, and says which | integration, fake clock |

`docs/VERIFICATION.md` gains `live-approvals` and `live-capture` gates.

---

## 12. Milestones

| M | Content | Done when |
|---|---|---|
| **M1** | `approvals` table, states, event kinds, TTL sweep in the tick | Integration: request → expire → denied, across a restart |
| **M2** | Telegram inline keyboard + callback path + authorization | Integration against the fake Bot API server, including the forged sender |
| **M3** | `propose_vault_write` tool, validation, perform, `subject_hash` | Live: a real approval performs a real wiki write |
| **M4** | Class grants + `os approvals` CLI surface | Integration: one grant, ten writes, one prompt |
| **M5** | Cron + heartbeat checklist + ntfy | Integration with a fake clock; live heartbeat failure reaches ntfy |
| **M6** | Capture: whisper + classifier + inbox | Live: a real voice note in the group becomes an inbox file |
| **M7** | Librarian pass + morning brief + weekly review | Live: a real 07:00 brief, judged by Chris |
| **M8** | Memory promotion gate + Syncthing | Live: a promotion asked, approved, and synced to the phone |

---

## 13. Risks and questions for Chris

1. **The prompt is only as good as its subject line.** An approval that says
   `wiki/projects/aleph-next.md (rewrite, 2.1 KB)` is approvable on a phone; one that says
   `12 files` is not. If M3 shows the rationale is uninformative, the fix is a diff preview in the
   message, and that is a design change, not a tweak.
2. **Class grants are the weak point.** They exist because ten prompts for one librarian pass is
   how a person learns to tap Approve without reading. But a live grant is a standing permission,
   and an hour is a long time. Mitigation: `class_grant_max_seconds` is config, grants are events,
   and the morning brief lists any that fired.
3. **Default-deny will bite.** The first time a librarian pass silently does nothing because Chris
   was asleep, it will feel like a bug. It is not. The morning brief reporting expired approvals is
   what makes it legible.
4. **whisper.cpp on WSL2 is unproven here.** No model is installed on the build host. If local
   transcription is unworkable, the decision to keep audio on-host has to be re-made explicitly
   rather than quietly traded away for an API call.
6. **The sync scope and capture disagree** (§9). Answer (a), (b) or (c) — this document assumes
   (c), delivering captured content back into the topic, but it is your vault and your phone.
7. **Confirm:** ntfy self-hosted on the tailnet (vs. ntfy.sh); 15-minute TTL; one hour as the
   class-grant ceiling; and that the librarian proposing wiki edits through the same broker Chris
   answers by hand is what you want, rather than a separate trust level for it.
