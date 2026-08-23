# Aleph — design

A personal agent that lives on your box, answers on Telegram, remembers things,
and does coding work by driving the Claude Code CLI in a worktree.

The daemon owns the conversation: its own agent loop, its own tools, its own
transcript. `claude` is not the runtime — it is the thing the agent reaches for
when the work is code. Chat tokens are metered on the API and are small; coding
tokens run on the CLI against the subscription and are large. That split is the
reason this shape exists.

Supersedes `phase-1.md`, `phase-2a.md` and `aleph-v0.md`. The A-vs-B comparison
that chose this shape is kept in `aleph-shapes.html`.

The same design as a page, scenes first:
<https://claude.ai/code/artifact/e20e67d9-7a68-447f-afd1-ab1fab566244>
(source `docs/design/aleph.html`; republish that file to the same URL).

---

## 1. What using it looks like

Everything below is the target for M0–M4. None of it runs yet.

### 1.1 A bug you found at your desk

```
$ cd ~/aleph-next
$ aleph do "reindex dies on a torn last line — skip it and warn instead"
job 7f3a · worktree .worktrees/job-7f3a · branch job/7f3a
  ▸ Read src/core/eventlog.ts
  ▸ Edit src/core/eventlog.ts
  ▸ Bash bun test tests/unit/eventlog.test.ts → 12 pass
done · 2 files · +31 −4 · 12 tests pass

$ aleph diff 7f3a
$ aleph land 7f3a
merged job/7f3a into main (squash) · worktree removed
```

`aleph do` is the conversation with the small talk skipped. It is the same code
path as asking in chat.

### 1.2 Directing it from a train

```
you    the daemon died overnight, look at the journal and fix it if it's obvious

aleph  journalctl -u aleph, last 200 lines.
       OOM at 03:12 while restarting a job whose stream log had reached 412MB.
       two fixes: cap and rotate the log, or spool it to disk and keep a tail
       in memory. cap is 20 lines, spool is a day. which?

you    cap it, 20MB, keep the last one

aleph  job 91c2 · aleph-next · branch job/91c2
       ▸ Edit src/jobs/log.ts
       ▸ Write tests/unit/joblog.test.ts
       ▸ Bash bun test → 44 pass
       done · +36 −7 · /diff 91c2

       ⚠ it wants to run: git push origin job/91c2
         [allow]  [deny]

you    [deny]

aleph  held. the branch is local. land it when you're back at the desk.
```

Three things in that exchange are design constraints, not politeness: it asked
a real question instead of guessing, the job could not push on its own, and
landing is yours.

### 1.3 Picking the remote session up locally

```
$ aleph jobs
7f3a  landed    2h ago    aleph-next   reindex torn-line guard
91c2  waiting   18m ago   aleph-next   cap job stream log at 20MB
a0d7  running   4m ago    dotfiles     migrate to fish

$ aleph attach 91c2
cd ~/aleph-next/.worktrees/job-91c2
claude --resume 3f0e2c81-…    ← now interactive, full history, your skills
```

The job *was* a Claude Code session all along, so attaching is not an import —
it is the same session, with its transcript, its CLAUDE.md and its skills. While
you are attached the daemon marks the job `attached` and will not spawn anything
on that session id; two processes on one session id interleave writes into one
transcript, which is measured behaviour, not a hypothetical.

`aleph land 91c2` when you are happy. `aleph drop 91c2` removes the worktree and
the branch.

### 1.4 It tells you something before you ask

```toml
# ~/.aleph-next/config.toml
[[cron]]
at = "07:30"
prompt = "morning: overnight job outcomes, anything waiting on me, today's calendar"

[[cron]]
at = "02:00"
prompt = "run the aleph-next test suite in a scratch worktree; message me only if it fails"
quiet = true          # no message unless the turn calls notify()
```

```
aleph  07:30 · two jobs landed overnight. 91c2 is still waiting on you.
       nothing else needs a decision today.
```

### 1.5 It remembers, and the memory reaches the work

```
you    remember: bun, never npm. and i squash-merge everything.

aleph  noted (2 memories)

… a week later, on a different repo …

you    add a changelog script

aleph  job c41f · dotfiles · branch job/c41f
       brief includes: "package manager is bun; merges are squashed"
```

Memories are injected into the job's task brief as *facts about you*, in a block
that says so. They never become system-prompt instructions, and `aleph memory`
lists everything the agent has written about you, so poisoning is visible.

### 1.6 What it declines

```
you    push that to prod

aleph  i don't have a deploy tool, and jobs run without push credentials.
       i can open a PR, or print the command for you to run.
```

---

## 2. Shape

```
  Telegram    aleph chat    cron
      │           │           │
      └───────────┴───────────┘
                  │
      ┌───────────▼─────────────────────────────┐
      │ aleph d                                 │      ┌──────────────┐
      │  ┌───────────────┐  ┌────────────────┐  │◀────▶│  Messages    │
      │  │  agent loop   │  │ tools (TS)     │  │      │  API         │
      │  │  history      │  │ remember/recall│  │      │  metered     │
      │  │  compaction   │  │ dispatch_code  │  │      └──────────────┘
      │  │  retries      │  │ notify/schedule│  │
      │  └───────────────┘  └────────────────┘  │      ┌──────────────┐
      │  ┌───────────────────────────────────┐  │─────▶│ claude -p    │
      │  │ gate — plain code, real arguments │  │      │ in a worktree│
      │  └───────────────────────────────────┘  │◀─────│ subscription │
      │  conversations · memory · jobs · events │      └──────┬───────┘
      └─────────────────────────────────────────┘             │
                                              you, later: claude --resume
```

## 3. The loop

One turn:

1. Inbound message → resolve `(channel, chat) → conversation`. Unpaired chat:
   refuse, and say how to pair.
2. Build the request: `soul.md` + memory block + rolling history.
3. Call the Messages API. Stream text to the channel, throttled to one edit per
   3s (Phase 1 turned streaming edits off because an unthrottled edit loop is a
   rate-limit footgun; the throttle is the price of turning them back on).
4. `tool_use` → `gate()` → run → `tool_result` → loop. Cap: 12 iterations or the
   turn's token budget, whichever first.
5. Append every message to `conversations/<id>.jsonl`, every decision to
   `events.jsonl`.

Compaction: when history exceeds the model's window minus headroom, summarize
the oldest half into one assistant-authored note and keep the tail verbatim. The
summary is data in our own store — we never feed model output back in as
instructions.

Models: chat on the cheap tier by default, escalation per conversation with
`/model`. Coding is not on this path at all.

## 4. Tools and the gate

| Tool | Notes |
|---|---|
| `remember(text, tags?)` | writes `memory/<slug>.md`; the write is echoed to you |
| `recall(query)` | FTS over memory + past conversations |
| `dispatch_code(repo, task, base?)` | starts a job (§6), returns its id |
| `job_status(id?)`, `job_log(id, tail)` | reads only |
| `skill(name)` | loads a skill body when the index line looks relevant |
| `notify(text)` | out-of-band message; the only way a cron turn speaks |
| `schedule(when, prompt)` | see below |

Every call goes through `gate(tool, args, conversation)` → `allow | ask | deny`,
from rules in `config.toml`. `ask` sends inline buttons and blocks that turn;
default timeout 10 minutes, then deny. Unknown tool: deny. The gate sees real
arguments, not a prefix pattern, and rules take effect on the next call — no
process restart, no 60-second hook ceiling.

`schedule()` is the one tool that lets the model write text that later runs
unattended. Three constraints make it safe enough: scheduled turns run with
`dispatch_code` removed from the tool set, the scheduled prompt is shown to you
at creation with `[keep] [drop]`, and `aleph cron` lists everything pending.

Not in v0: web search, fetch, arbitrary shell from chat. Chat is for talking and
for starting jobs; the sharp tools live inside jobs, where the worktree is the
blast radius.

## 5. Skills and memory

Two kinds of knowledge, entering from opposite directions.

| | Memory | Skills |
|---|---|---|
| Is | facts — about you, your machines, your habits | procedures — how to do a recurring thing |
| Written by | the agent, with `remember()` | you, as files |
| Reviewed | after the fact: every write is echoed, `aleph memory` lists them | before: a skill is a diff you land |
| Shape | one fact per file | `SKILL.md` with name + description frontmatter |
| Reaches chat as | a facts block in every turn | one index line each; the body on `skill(name)` |
| Reaches a job as | the same facts block, inside the task brief | the CLI loads it natively, via the symlink below |

### Where each one lives

```
~/.aleph-next/memory/<slug>.md         facts · aleph writes, you review
~/.aleph-next/skills/<name>/SKILL.md   procedures · you write, aleph reads
~/.claude/skills → ~/.aleph-next/skills   symlink · jobs and your own
                                          interactive claude get the same set
<repo>/.claude/skills/                 procedures only jobs in that repo see
<repo>/CLAUDE.md                       the repo's own facts · aleph never writes
                                          this outside a job you land
```

`SKILL.md` is the format Claude Code and Hermes already use, so one file is
readable by the chat loop, by every job, and by an interactive `claude` at your
desk. Nothing is converted, copied or kept in sync.

### What a turn actually carries

- **A chat turn:** `soul.md`, the facts block, the skills index — one line per
  skill, a few hundred tokens — and the rolling history. `skill(name)` pulls a
  body in when it becomes relevant, which is the CLI's own progressive
  disclosure, reimplemented in about sixty lines.
- **A job:** the task brief with the facts block inside it, plus everything the
  CLI finds for itself — the repo's `CLAUDE.md`, the repo's skills, and the
  symlinked Aleph skills.

### Why the asymmetry

The agent may write a fact unprompted because a fact is cheap to check and cheap
to delete. It may not write itself a procedure. A skill is a file in a repo, so
authoring one is a job, and a job ends in a diff you land — nothing that changes
*how it acts* enters the system without passing through your hands.

## 6. Jobs

```
git -C <repo> worktree add .worktrees/job-<id> -b job/<id> <base>
claude -p --session-id <uuid> --permission-mode acceptEdits \
       --output-format stream-json <task brief>
```

- cwd is the worktree. Env is stripped of `CLAUDE*`/`ANTHROPIC*` except the auth
  path — the daemon may itself be started from inside a Claude Code session, and
  `CLAUDE_CODE_SESSION_ID` leaking into a child collapses session identity.
- No push credentials: `GIT_ASKPASS=/bin/false`, no agent socket, no
  `GIT_CONFIG_GLOBAL` credentials. A job can commit; it cannot publish.
- One process per job, pid in `jobs/<id>/state.json`. On daemon start, reconcile:
  live pid → adopt, dead pid → mark `abandoned`, never orphan a worktree.
- Wall-clock cap (default 30 min) → SIGTERM → `timed_out`, log kept.
- The stream log is capped and rotated (20MB), which is also §1.2's bug.
- Terminal states are `waiting` (needs you), `landed`, `dropped`, `abandoned`,
  `timed_out`. `aleph jobs gc` removes worktrees for the last three.

Landing is human-only in v0: `aleph land <id>` squash-merges and removes the
worktree. There is no tool the agent can call to merge anything.

## 7. State

```
~/.aleph-next/
  soul.md                  identity, prepended to every chat turn
  config.toml              pairing, channels, models, gate rules, cron
  conversations/<id>.jsonl the loop's own transcript — ground truth
  memory/*.md              one fact per file, agent-written, human-readable
  skills/<name>/SKILL.md   procedures you write; symlinked into ~/.claude/skills
  jobs/<id>/               task.md, state.json, stream.jsonl
  events.jsonl             every message, gate decision, job transition, cron fire
  index.db                 FTS + job/session index — delete it and it rebuilds
```

Files are truth; `index.db` is derived and disposable. The rebuild skips a torn
final line and warns rather than failing the whole reindex.

## 8. Security posture

The honest frame first: a job runs as your Linux user with your files. There is
no OS sandbox in v0, so every control below is a fence, not a wall. Hermes says
the same thing in its own `SECURITY.md`, and saying it out loud is the point.

1. **Pairing before anything.** An unknown chat id gets one line telling it to
   send the code printed by `aleph pair`. Five wrong codes → that id is locked
   out. Group chats are refused outright. Without this, the bot handle *is* the
   credential.
2. **Jobs cannot publish or land.** No push credentials, no merge tool.
3. **The gate defaults to deny** and sees real arguments.
4. **Memory is data.** Injected as facts in a delimited block, never as
   instructions; every write is echoed and `aleph memory` lists them.
5. **Model output never becomes a future instruction** except through
   `schedule()`, which is fenced in §4. This was an explicit rule in Phase 1 and
   it survives.
6. **Secrets are redacted** on the way into `events.jsonl` and memory.

## 9. Milestones

| M | Ships | Usable when | Verified by |
|---|---|---|---|
| **M0** | loop, `aleph chat`, `remember`/`recall`, the skills index + `skill()`, events | a local assistant that remembers, and that you can teach a procedure | a real 20-turn conversation, restart, recall the fact; a skill that changes what it does |
| **M1** | Telegram, pairing, throttled streaming | you use it from your phone all week | pairing refusal + a week of real use |
| **M2** | `dispatch_code`, jobs, `aleph jobs/attach/diff/land/drop` | it fixes a real bug in this repo end to end | §1.1 and §1.3 performed, not described |
| **M3** | the gate, approvals over Telegram, redaction | unattended turns are safe to leave running | a denied push, a timed-out ask |
| **M4** | cron, `schedule`, quiet jobs | it speaks first, usefully | a week of 07:30 briefings |

Containment in M2 comes from the job design — worktree, no credentials, no
landing — not from the gate, which is why the gate can land in M3 without M2
being reckless.

## 10. From the Phase 1 tree

**Ported:** `core/ids`, `core/clock`, `core/config`, `core/emit` + `eventlog`,
`platform/db`, `channels/telegram/api`, and `obs/otel` + `obs/langfuse` — which
become *more* useful here than they were in Phase 1, because now the daemon owns
the model calls and can trace them.

**Dropped:** lanes and the starvation ladder, the brief loop, the SDK and echo
runners, `routing/`, `vault/`, the join audit.

Files this doc names that do not exist yet — forward references, declared rather
than left indistinguishable from dead ones:

```planned
src/jobs/log.ts
tests/unit/joblog.test.ts
```

## 11. Open questions

1. Chat model tier — one cheap default with manual escalation, or route by
   message shape? Cost data first, decision after M1.
2. Does a conversation need any notion of context (repo, project) before M2, or
   is "which repo" just an argument to `dispatch_code`?
3. Attach-while-running: block it, or let it interrupt the job's process
   cleanly? M2 needs an answer; blocking is the default until measured.
4. How much of a job's stream belongs in Telegram — every tool call, or only
   file writes and test results?
