# Aleph — design

Aleph is a personal agent. It runs on your machine. You speak to it from Telegram
or from a terminal. It writes code with the Claude Code CLI.

This document replaces `aleph-v0.md`. The file `aleph-shapes.html` keeps the
comparison that selected this shape. The file `aleph.html` shows the same design
as a page.

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
memory bridge (§5). It can take the session later (§2.5).

**The rule this makes:** a pane that never speaks to Aleph must work correctly.
Aleph is present, but it is passive at your desk.

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

Later you send a message to Aleph. You ask what is in progress. Aleph shows the
jobs that it drives. It also shows the sessions at your desk that it can adopt.

You select one. Aleph makes a WIP commit, adopts the session, and makes a topic
for it. You continue from the telephone.

**The rule this makes:** Aleph offers to adopt when you arrive, not when you
leave. It must not interrupt you at your desk to ask.

### 2.6 A mobile session that continues at your desk

You come home. You run `aleph attach 91c2`. Aleph opens a herdr pane in the
worktree of that job, with the same session.

The session is the same session. It has the same transcript, the same skills and
the same `CLAUDE.md`. Aleph stops to drive it while you hold it.

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
directions:

| Direction | Command | Workflow |
|---|---|---|
| The daemon → you | `aleph attach <id>` | §2.6 |
| You → the daemon | adoption, which Aleph offers | §2.5 |

Before Aleph completes a handover, it must know that the other driver stopped.
It reads `/proc` to find a live process in that worktree. It does not use your
word for this.

---

## 4. Surfaces

| Surface | You use it to | Notes |
|---|---|---|
| A herdr pane | write code at your desk | Aleph does not control the pane |
| The Telegram group | speak to Aleph, and drive jobs | one topic for each job |
| `aleph` (CLI) | list, attach, merge, remove | thin; it speaks to the daemon |
| Cron | let Aleph speak first | see §10, M4 |

The Telegram group is one private supergroup with topics. The General topic is
the conversation with Aleph. Each job gets its own topic.

Aleph refuses every other chat, and it refuses direct messages. §9 gives the
reason.

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

Each job has an origin:

| Origin | Aleph made the worktree | Aleph can remove it |
|---|---|---|
| `dispatched` | yes | yes |
| `adopted` | no | no |

An adopted job keeps your branch name and your worktree. Aleph must not remove
them.

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

The repository holds this policy. This repository has `docs/VERIFICATION.md`
already, thus Aleph reads that and does not make a second rule.

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
3. **Jobs cannot publish and cannot merge.**
4. **The permission gate refuses by default.** It runs in the daemon, thus it
   reads the true arguments. You set the time limit.
5. **Memory is data.** Aleph puts facts in a block that says they are facts. They
   are never instructions. `aleph memory` lists each one.
6. **Adoption looks only at the repositories in `config.toml`.** The daemon must
   not read transcripts that you did not give it.
7. **Aleph removes secrets** before it writes to `events.jsonl` or to memory.

---

## 10. Milestones

| M | What it adds | It is useful when | The test |
|---|---|---|---|
| **M0** | the loop, `aleph chat`, memory, the skill index, events | it remembers between restarts, and you can teach it a procedure | one long conversation, a restart, then a correct recall |
| **M1** | the Telegram group, topics, pairing | you use it from your telephone for one week | a refused chat, and one week of true use |
| **M2** | jobs, `aleph jobs / attach / diff / land / drop`, the memory bridge | it corrects a true defect in this repository | workflows 2.3 and 2.6, done and not described |
| **M3** | the permission gate, permissions in Telegram, secret removal | you can leave it without supervision | a refused push, and a permission that expires |
| **M4** | adoption, cron, `schedule` | work moves in both directions | workflow 2.5, and one week of morning reports |

M2 is safe before M3 because the job design contains it: a worktree, no
credentials, and no way to merge.

---

## 11. From the Phase 1 tree

**Aleph uses:** `core/ids`, `core/clock`, `core/config`, `core/emit` and
`eventlog`, `platform/db`, `channels/telegram/api`, `obs/otel` and
`obs/langfuse`. The observability code is more useful here than in Phase 1,
because the daemon now makes the model calls itself.

**Aleph does not use:** the lanes and the starvation ladder, the brief loop, the
SDK runner, the echo runner, `routing/` and `vault/`.

These files do not exist yet. This document names them:

```planned
src/jobs/log.ts
tests/unit/joblog.test.ts
```

---

## 12. Open questions

1. Which model does a conversation turn use? Start with the low-cost model.
   Decide after M1, with true cost data.
2. Can herdr open a pane from a command? Its site says that the CLI and the
   socket are one surface for agents. `aleph attach` is better if the answer is
   yes. Test this at M2.
3. What quantity of the stream of a job goes to its topic? Each tool call, or
   only file changes and test results?
4. Does adoption need a WIP commit each time, or only when the worktree is
   dirty?
