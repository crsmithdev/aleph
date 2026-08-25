# Aleph — design

Aleph is a personal agent. It runs on your machine. You speak to it from Telegram
or from a terminal. It writes code with the Claude Code CLI.

The file `aleph-shapes.html` keeps the comparison that selected this shape, and
`aleph.html` shows the same design as a page.

**Nothing here is built.** This repository holds the design and no code. Each
workflow in §2 is a target.

This document obeys ASD-STE100 Simplified Technical English.

---

## 1. Why Aleph exists

Claude Code writes code. Herdr runs many Claude Code sessions at your desk.
Neither tool moves work between your desk and your telephone.

Aleph moves the work. This is its purpose. All other functions support this
purpose.

The six workflows in §2 are the full test of that purpose. If Aleph does all six
well, it is done. If it does a seventh thing, that thing is not v0.

---

## 2. The six workflows

Aleph does not do these things yet. Each workflow is a target.

### 2.1 One local session

You open a herdr pane. You start `claude` in a repository. You write code. You
commit. You merge.

Aleph does almost nothing here. It gives the session your facts through the
memory bridge (§5.2). It watches the session, and if the session parks it makes a
topic (§4).

**The rule this makes:** a pane that never speaks to Aleph must work correctly.
Aleph is present, but it is passive at your desk. It watches, and it does not
interrupt.

### 2.2 Many local sessions

You open six panes in herdr. Herdr shows you which agent works, which one waits
for you, and which one is complete.

Aleph gives all six panes the same facts and the same skills. A fact that you
teach in one pane is available in all of them.

**The rule this makes:** the daemon and your panes use the same repositories.
Thus branch names and worktree paths are a shared resource. The daemon uses the
prefix `job/` and the directory `.worktrees/`. It must not use a name that your
pane holds.

### 2.3 One mobile session

You send a message to the General topic of the Aleph group. Aleph starts a job.
Telegram makes a new topic for that job.

The job topic shows the progress. If the job needs permission, Aleph asks in that
topic. When the job stops, Aleph shows the difference and the test result.

You merge from the telephone, or you keep the job for your desk (§7). Aleph
closes the topic when the job is complete.

### 2.4 Many mobile sessions

Three jobs run. Telegram shows three topics.

A message in a topic is a message to that job. Aleph does not need a command to
know which job you mean. You can make one topic silent if its job speaks too
much.

**The rule this makes:** the topic list is the job list. It is the same
information that herdr gives you at your desk.

### 2.5 A local session that continues on your telephone

You write code in a pane. You must leave. You close the computer.

The session parks. Aleph makes a topic for it and writes three things there: a
headline, a summary, and the last exchanges (§4.2).

Later you open that topic on your telephone. Everything is there already. You
type your next instruction. That message attaches the session and starts the
turn. You give no command.

**The rule this makes:** Aleph writes the context when the session parks, not
when you arrive. §4.1 gives the reason.

### 2.6 A mobile session that continues at your desk

You come home. You run `aleph attach 91c2`. Aleph parks the job, asks herdr for a
pane in the worktree, and starts the same session again.

The session does not change. It has the same transcript, the same skills and the
same `CLAUDE.md`. The topic stays, but it becomes a view: while you hold the
pane, a message in that topic gets a refusal that tells you where the pane is.

**The rule this makes:** each direction supplies the one thing that the other
side has already.

| Direction | What is missing | What Aleph supplies |
|---|---|---|
| Desk → telephone | the transcript. A telephone cannot hold it | a summary and the last exchanges |
| Telephone → desk | a terminal. The daemon needs none | a herdr pane, on the same session |

---

## 3. The driver rule

A job is one Claude Code session. Each job has a worktree, a branch and a
session ID.

Each job has one driver. The driver is the process that sends turns to the
session.

| Driver | The process | You see it in |
|---|---|---|
| You | an interactive process in a herdr pane | herdr |
| The daemon | a headless process that the daemon started | a Telegram topic |
| Nobody | no process | `aleph jobs` |

Two processes must not use one session ID. If they do, they write into one
transcript at the same time and the transcript becomes bad. This is measured
behaviour, not a risk.

Thus a handover is a change of driver, and it is the same change in both
directions. You change the driver when you act. You do not give a command:

| You do this | The result |
|---|---|
| Send a message in a job topic | The daemon drives it |
| Start `claude` in the worktree | You drive it. The daemon stops after its turn |

Two commands stay, and both are conveniences. `aleph attach` finds the worktree
and asks herdr for a pane, and it makes the daemon park the job first. `aleph
jobs` lists the work.

### 3.1 The check before each handover

Before Aleph completes a handover, it must prove that the other driver stopped.
It uses two signals together:

- **The working directory.** Aleph reads `/proc/<pid>/cwd` for each `claude`
  process and compares it to the worktree.
- **The transcript.** A recent change time on
  `~/.claude/projects/<slug>/<uuid>.jsonl` shows that a session is alive.

Aleph does not use your word for this. If a process holds the worktree, Aleph
refuses and tells you where that process is.

I do not know if the CLI holds the transcript file open. If it does, then
`/proc/<pid>/fd` gives a better answer than both signals. This is a test for M2.

### 3.2 What `aleph attach` does when a pane is open

The command is idempotent. It never makes a second driver.

| What holds the worktree | The result |
|---|---|
| Nothing | The daemon parks the job. Aleph opens a pane |
| A process, and Aleph opened its pane | Aleph moves you to that pane |
| A process, but Aleph did not open the pane | Aleph refuses. It prints the PID and asks herdr which pane holds it |
| The state says a pane exists, but the process is gone | Aleph corrects the state and opens a pane |

If the daemon is in a turn, `attach` waits for that turn to stop. The daemon must
not stop in the middle of a turn.

If herdr does not answer on its socket, Aleph does not start herdr. It prints the
two commands and stops.

---

## 4. The mirror

The Telegram group is one private supergroup with topics. The General topic is
the conversation with Aleph. Each piece of work gets its own topic.

The topic list is the state of your machine. It holds the jobs that the daemon
drives **and** the local sessions that parked. Thus the work that you started at
your desk is on your telephone before you look for it.

Your desk is herdr, with one Claude Code session in each pane. The design
assumes that and nothing else. Aleph does not replace it, does not wrap it, and
does not need you to change it.

| Surface | You use it to | Notes |
|---|---|---|
| A herdr pane | write code at your desk | a normal Claude Code session. It reaches Aleph's facts through the bridge (§5.2) |
| The Telegram group | speak to Aleph, and drive each job | one topic for each job |
| Any chat client | speak to Aleph at your desk | `llm` in a pane, or Chatbox in a window. Both use the endpoint (§4.6) |
| `aleph` (CLI) | list, attach, merge, remove, and `doctor` | thin; it speaks to the daemon |
| Cron | let Aleph speak first | see §10, M5 |

### 4.1 Why Aleph writes the context early

A Telegram bot cannot see that you opened a topic. It receives messages, edits
and button presses. It receives no event when you read.

Thus Aleph cannot make the summary at the moment you arrive. It writes the
context when the session **parks**.

This also keeps the cost small. A session parks a few times each day, not
continuously. Aleph pays one cheap model call for each park, and only for work
that stopped.

A session parks when its process stops, or when it is idle and holds files that
are not committed. A session that you type in does not need a topic.

### 4.2 What a topic holds

```
# 4e81 torn-line · aleph-next

headline · Aleph edits this one message in place
  aleph-next · branch torn-line
  you parked this 40 minutes ago
  3 files not committed · last: bun test → 2 fail

summary
  You corrected the reindex so that it does not stop on a torn last
  line. The guard operates correctly. Two tests fail because no
  fixture has a torn line. You started to write that fixture.

recent
  you     add a fixture with a torn last line
          ▸ Read   tests/fixtures/events.jsonl
          ▸ Write  tests/fixtures/torn.jsonl
          ▸ Bash   bun test → 2 fail
  aleph   the fixture is written, but the test looks for the old
          path. i must change eventlog.test.ts line 44.
```

Each part has one purpose. The headline is live and cheap, and Aleph derives it
from the tool names and from `git status`. The summary tells you what the work is
about. The recent part tells you where the work stopped.

The recent part is rendered, not raw. The last ten messages of a coding session
are usually ten tool calls, and those are not useful on a telephone. Aleph shows
the last ten **exchanges**: your instructions and its replies in full, with each
tool call made short to one line. This also keeps the text inside the Telegram
limit of 4096 characters.

### 4.3 The life of a topic

| Event | The topic |
|---|---|
| A session parks, or a job starts | Aleph makes the topic |
| You send a message, and no process holds the worktree | Aleph attaches the session and starts the turn |
| You hold the pane | The headline says so. A message gets a refusal, not a turn |
| The work merges, or you drop it | Aleph closes the topic. Telegram keeps the history |
| The session stops with work not committed | The topic stays open |
| A topic that Aleph did not make | not its business. It never posts there, never closes it, and never counts it in the job list |
| Anything | Aleph never deletes a topic. The history is context |

### 4.4 Three failures

| Failure | What the topic says |
|---|---|
| The worktree is gone | This work is not available. The directory does not exist. |
| The branch merged while you were away | This work merged. The topic closes. |
| The session will not start again | I cannot continue this session. Here is the summary and the branch. |

### 4.5 Pairing, and the preflight

Aleph needs one private supergroup with topics on, and admin rights with
manage-topics. It cannot make either for you.

`aleph pair` prints a link that carries a one-time token, and arms the daemon
for five minutes:

```
https://t.me/<bot>?startgroup=8f3c1a
```

You open it, pick or make the group, and grant admin when Telegram asks.
Telegram then delivers `/start 8f3c1a` in that group, the token matches, and
Aleph binds that chat ID.

Do not depend on the link's `&admin=` parameter. Its behaviour differs between
clients and Telegram prompts for rights anyway. A second path exists for a group
that you have already:

```
aleph pair --code       # add the bot yourself, then send the code in the group
```

The bind ends with a preflight, because a group you made months ago carries
state you did not choose today:

```
paired · "Aleph" · -100…
  type            supergroup
  topics          enabled          ← getChat.is_forum
  manage topics   granted          ← getChatMember.can_manage_topics
  status          administrator
ready.
```

If topics are off or the rights are missing, Aleph pairs anyway and works in one
thread. It then prints `no topic` on each job message, so the limit stays
visible instead of becoming normal.

| State | Behaviour |
|---|---|
| Unpaired, disarmed | ignores everything |
| Unpaired, armed | accepts a matching token from any chat. Nothing else |
| Paired | only the bound chat. **Every other chat is ignored in silence** — a reply tells a stranger that the bot is alive |
| `aleph pair --reset` | unbinds |

### 4.6 The endpoint, and why there is no `aleph chat`

**Aleph has no chat interface of its own.** It has two protocols instead:

| Protocol | What it gives | Who reasons | Ships at |
|---|---|---|---|
| The MCP bridge (§5.2) | Aleph's **facts** to your panes | the pane's model. Your subscription pays | M0 |
| `/v1/chat/completions` | Aleph's **agent** to any client | Aleph's loop. Metered, and small | M1 |

A client sends the whole message list on each turn, and Aleph owns the history
(§8). Thus the `model` field carries the conversation instead of a model name —
`aleph:home` — and the daemon reads only the last user message.

```yaml
# llm, in extra-openai-models.yaml
- model_id: aleph
  model_name: aleph:home
  api_base: http://127.0.0.1:7717/v1
```

A REPL written here would compete with `llm` and aichat and lose. For "is the
loop alive", the answer is `aleph doctor`, which is a health check and not a
conversation. For a raw turn, the answer is `curl`.

---

## 5. Skills and memory

Aleph holds two types of knowledge. They move in opposite directions.

| | Memory | Skills |
|---|---|---|
| What it is | facts about you and your machines | procedures for work that repeats |
| Who writes it | Aleph, with `remember()` | you, as files |
| When you examine it | after: Aleph shows each write, `aleph memory` lists them | before: a skill is a change that you merge |
| The shape | one fact in one file | `SKILL.md` with a name and a description |
| In a conversation | a block of facts in each turn | one line for each skill; `skill()` reads the body |
| In a job | the same block, in the task text | the CLI reads it |

### 5.1 Where the knowledge is

```
~/.aleph-next/memory/<slug>.md         facts. Aleph writes, you examine
~/.aleph-next/skills/<name>/SKILL.md   procedures. You write, Aleph reads
~/.claude/skills → ~/.aleph-next/skills   a symbolic link. Jobs and your panes
                                          read the same set
<repo>/.claude/skills/                 procedures for one repository
<repo>/CLAUDE.md                       the rules of that repository
```

`SKILL.md` is the format that Claude Code and Hermes read now. Thus one file is
sufficient for the daemon, for each job, and for each herdr pane. Aleph does not
convert the file and does not copy it.

### 5.2 The memory bridge

The daemon holds the memory. Your herdr panes are usual Claude Code sessions,
thus they cannot read it.

A small MCP server corrects this. It is a client of the daemon. It gives
`recall`, `remember` and `job_status` to each pane. You add it one time.

The bridge gives read access and write access to facts. It does not start jobs.
You are already at a keyboard, thus you do not need that.

**This bridge is M0's only surface.** Before the loop exists, every pane you open
is already an Aleph client — you add the server one time and each session has
your facts.

### 5.3 Why the two types are different

Aleph can write a fact without permission. A fact is easy to examine and easy to
delete.

Aleph cannot write a procedure. A skill is a file in a repository. To make one is
a job, and a job stops at a change that you must merge. Nothing that changes how
Aleph operates enters the system without your approval.

---

## 6. Jobs

A job is a worktree, a branch, a session ID and a driver.

```
git -C <repo> worktree add .worktrees/job-<id> -b job/<id> <base>
claude -p --session-id <uuid> --permission-mode acceptEdits \
       --output-format stream-json <the task text>
```

| Rule | Reason |
|---|---|
| No credentials to push | A job can commit. It cannot publish. |
| The environment holds no `CLAUDE*` or `ANTHROPIC*` variable, except the one for authentication | The daemon can start from inside a Claude Code session. A variable that leaks makes two sessions into one. |
| One process, and its PID is in `jobs/<id>/state.json` | The daemon compares this list to real processes each time it starts |
| A limit of 30 minutes | Then SIGTERM, and the state becomes `timed_out` |
| The log has a maximum size, and rotates at 20 MB | A log that has no limit filled the memory once |

### 6.1 What bounds a job

Jobs and your herdr panes draw on the same subscription. A cap here is not about
safety. It stops Aleph from starving you out of your own desk at two in the
afternoon.

| Cap | Default | It prevents |
|---|---|---|
| running at one time | 3 | Aleph taking the whole window while you work |
| per repository | 1 | two jobs racing for `job/<id>` and `.worktrees/` |
| started in one turn | 1 | one sentence becoming six sessions |

When a cap blocks a job, Aleph refuses and names the cap and what runs. **It does
not queue.**

**The job record precedes the process.** `start_job` writes
`jobs/<id>/state.json`, then checks the caps, then spawns. A refused job deletes
its record.

That ordering costs nothing today and it is what makes a queue cheap later: a
`queued` state, and a tick that takes the oldest queued job when a slot frees.
About thirty lines. Add it when refusing annoys you, and not before.

### 6.2 Why the split pays

A job runs the `claude` binary, and that binary authenticates itself. Thus your
subscription pays for the coding turn, and the daemon is not in that path.

**The subscription travels with the CLI, not with the model.** A program that
calls the model API is a client, and it bills you as a client. This is why the
daemon calls the API only for a conversation turn, which is small, and never for
a coding turn, which is large.

Keep this rule when you choose any tool. It decides the cost more than the
feature list of that tool does.

Each job has an origin:

| Origin | Aleph made the worktree | Aleph can remove it |
|---|---|---|
| `dispatched` | yes | yes |
| `mirrored` | no | no |

A mirrored job is a local session that parked. It keeps your branch name and your
worktree, and Aleph must not remove them. Aleph gives it a job ID and a topic so
that the two types look the same on your telephone. They are not the same on
disk.

---

## 7. Landing

Only a person merges a branch. Aleph has no tool to merge. This does not change.

But the quantity of examination that is sufficient changes with the work. Thus
the policy is a property of the repository, not of Aleph.

| Class of change | Sufficient from the telephone |
|---|---|
| documents | the list of changed files |
| logic | the verification gate of the repository is green, and you read the difference |
| migration, or a change to the release process | no. Keep it for the desk |

Each repository holds its own policy, in the file that says how to verify a
change there. Aleph reads that file. It does not make a second rule.

This repository holds no code today, thus it holds no such file. It gets one
again when it gets code.

A job proposes its class and shows the evidence. You can always move a job down
to "keep it for the desk". You cannot move it up.

---

## 8. State on disk

```
~/.aleph-next/
  soul.md                  the identity. Each conversation turn starts with it
  config.toml              the group, the repositories, the models, the rules
  conversations/<id>.jsonl the transcript of the daemon. This is the truth
  memory/*.md              one fact in one file
  skills/<name>/SKILL.md   procedures. A symbolic link makes them global
  jobs/<id>/               task.md, state.json, stream.jsonl
  events.jsonl             each message, permission, job change and cron start
  index.db                 an index. If you delete it, Aleph builds it again
```

The files are the truth. `index.db` is an index. When Aleph builds the index
again, it ignores a bad last line and gives a warning. It does not stop.

---

## 9. Security

A job runs as your Linux user, with your files. There is no sandbox in v0. Each
control below is a fence. It is not a wall. Hermes says the same about itself.

1. **One group.** Aleph replies only in the supergroup that you paired. It
   ignores each other chat and each direct message.
2. **Membership of that group is the credential.** To add a person to the group
   is to give that person your machine. Keep the group private.
   Telegram reports `has_visible_history: true`, thus a person you add later
   reads everything Aleph has ever written there, not only what comes after
   them.
3. **Jobs cannot publish and cannot merge.**
4. **The permission gate refuses by default.** It runs in the daemon, thus it
   reads the true arguments. You set the time limit.
5. **Memory is data.** Aleph puts facts in a block that says they are facts. They
   are never instructions. `aleph memory` lists each one.
6. **The mirror looks only at the repositories in `config.toml`.** The daemon
   must not read a transcript that you did not give it.
7. **The mirror sends data all day.** Before the mirror, only the work that you
   dispatched went to Telegram. Now the names of your repositories and branches,
   and your activity, go there each time a session parks. Decide this on
   purpose. `config.toml` can exclude a repository, and an excluded repository
   gets no topic.
8. **Aleph removes secrets** before it writes to `events.jsonl` or to memory.

---

## 10. Milestones

| M | What it adds | It is useful when | The test |
|---|---|---|---|
| **M0** | the store, memory, skills, **the MCP bridge**, events, `aleph doctor` | every pane you open already knows your facts | teach a fact in one pane, restart, recall it in another |
| **M1** | **the loop**, Telegram, topics, pairing, **the endpoint** | you use it from your telephone for one week | a refused chat, and one week of true use |
| **M2** | jobs, **the caps**, `aleph jobs / attach / diff / land / drop` | it corrects a true defect in this repository | workflows 2.3 and 2.6, done and not described |
| **M3** | the mirror: the watcher, the park rule, the summary, `attach` from a message | work moves in both directions with no command | workflow 2.5, done from a train |
| **M4** | the permission gate, permissions in Telegram, secret removal | you can leave it without supervision | a refused push, and a permission that expires |
| **M5** | cron, `schedule` | Aleph speaks first | one week of morning reports |

**M0 has no loop.** The bridge needs none: a pane brings its own model, and it
reaches Aleph only for facts. The loop arrives at M1, because Telegram is the
first surface with no Claude Code on the other end — and the endpoint rides
along with it, since it is one more transport over the same loop.

M2 is safe before the gate because the job design contains it: a worktree, no
credentials, no way to merge, and the caps in §6.1.

The mirror moved from last to M3. Workflow 2.5 is one of the two workflows that
justify this design, thus it must not be the last thing that Aleph learns.

---

## 11. What to take from the Phase 1 tree

This repository holds no code. An earlier implementation is in the history at
`dca908d`, and you read it with `git show dca908d:<path>`.

**Take:** `src/core/ids`, `src/core/clock`, `src/core/config`, `src/core/emit`
and `src/core/eventlog`, `src/platform/db`, `src/channels/telegram/api`,
`src/obs/otel` and `src/obs/langfuse`. The observability code is more useful
here than it was in Phase 1, because the daemon now makes the model calls
itself.

**Leave:** the lanes and the starvation ladder, the brief loop, the SDK runner,
the echo runner, `src/routing/` and `src/vault/`.

Take a file only when a milestone needs it. A file that you copy before you need
it is a file that you must understand twice.

---

## 12. Open questions

Grouped by the milestone each one blocks. Three questions closed in the last
pass: the chat surface (§4.6), the job caps (§6.1), and pairing (§4.5).

### Before M1

1. **Is a conversation the same kind of thing as a job?** A job is a session with
   a worktree and an ID. The General topic is a conversation with neither. Does
   it get a row in `conversations/*.jsonl`? Does the 12-turn cap apply? Does
   compaction? The document uses both words for one thing in places, and they are
   not one thing.
2. **Which model does a conversation turn use?** Start with the low-cost model.
   Decide with true cost data.

### Before M2

3. **What is the landing policy file?** §7 says the repository holds it. No
   format is named, and this repository holds no code and no such file.
4. **What claims a branch name?** §2.2 says branch names and worktree paths are a
   shared resource. It names no mechanism. The per-repository cap in §6.1 hides
   this, and does not solve it.
5. **Can herdr open a pane in a chosen space or tab?** Its site says the CLI and
   the socket are one surface for agents. If it cannot, each pane lands in one
   place and you move it.
6. **Does the CLI hold the transcript file open?** If it does, `/proc/<pid>/fd`
   beats both signals in §3.1.
7. **How much of a job's stream goes to its topic?** Each tool call, or only file
   changes and test results?

### Before M3

8. **Who maintains the repository allowlist?** §9 says the mirror reads only the
   repositories in `config.toml`. One you forget gets no topic, and it fails in
   silence. Warning, prompt, or nothing?
9. **How long must a session be idle before it parks?** Too short makes noise.
   Too long makes you wait. Start at 10 minutes and measure.
10. **Does a park always need a WIP commit,** or only when the worktree holds
    files that are not committed?
11. **The cost of the summary at each park is arithmetic, not a measurement.**

### Not blocking anything yet

12. **What does a torn turn leave behind?** The daemon dies mid-turn. §8 says the
    files are the truth. It does not say what a half-written turn leaves, or how
    the next start cleans it.
13. **`notify()` has no rate bound.** It is the one tool that reaches you without
    you asking.
