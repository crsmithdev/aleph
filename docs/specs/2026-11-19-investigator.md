# Investigator

Status: draft 2026-11-19, for Chris's review. Source: a session on 2026-11-19 that traced issue.3350 by hand (a merge
conflict, an OpenRouter 402, a recheck that could not fix a conflict, and a stale credit hold), and a survey of
investigator agents elsewhere (Sentry Seer, GitLab Duo Root Cause Analysis, Factory.ai Reliability Droid).

## Decision

An Investigate button on a page starts one read-only agent run, role `investigator`, on that page's subject. The run
reads everything the factory recorded about the subject, and replies with typed findings and recommended issues. The
subject page shows the result, and each recommended issue has a File button. Chris starts every run. Nothing starts one
by itself.

| Part | Choice |
|---|---|
| Subject | A key: `issue.<n>` or `job.<n>` in v1. A new kind is one entry in `SUBJECTS` and one button. |
| Run | `openRun` with role `investigator`, read-only tools, in the repo's checkout, no worktree, time box 30 min. |
| Start | `POST /api/investigate {subject}` launches `aleph investigate <subject>` as a systemd unit through `launch.ts`, as a job does, so a UI restart does not kill it. |
| Model | A new role model `investigator`, default `claude-opus-5-5`. |
| One at a time | One live run per subject. The button shows Running while it lasts. |
| Reply | JSON under a schema: summary, timeline, causes, recommended issues. Code checks it and writes `result.json` in the run folder. |
| Record | The run in the ledger, with `name` = the subject key. No new table. |
| Surfacing | An Investigation panel on the subject page, a line in the news, and the run on the Jobs and Agents pages. |
| Filing | Each recommended issue has File and Dismiss. File runs the one issue path (`aleph issue add`) with the spec and `refs` to the subject. |

## Why

- No role studies a failure in depth today. The rescue writes one line per case, the director decides one Ask, and the
  housekeeper keeps parked issues current. On 2026-11-19, issue.3350 needed a by-hand trace through 6 run folders, the
  event log, the models setting and `holds.ts` to find a bug (a3356) that no run reported.
- Chris's click is the stated reason for each run (PRINCIPLES.md rule 6). An automatic trigger waits for evidence that
  the runs Chris starts find real faults (rule 4).
- Chris files, not the agent: a recommended issue is a proposal, and a filed issue starts factory work.
- One record holds it (rule 5): the run in the ledger already has a folder, a cost, a state and a page.

## The subject

`SUBJECTS` maps a kind to the case the run reads. The case is a list of pointers, not content: the agent reads what it
needs. Each pointer is a path, a command or a query.

| Kind | Pointers |
|---|---|
| `issue.<n>` | `aleph issue show`, `aleph status`, every job and run of the issue (`aleph jobs <name>` and each run folder: `log.txt`, `result.md`, `transcript.jsonl`, `check.out`, `diff.patch`), the issue's events, the commits that name it (`Issue: issue.<n>`), and the settings changes in the issue's window. |
| `job.<n>` | The job's runs and their folders, the job's events, its branch and its diff against main, and the issue it belongs to as context. |

Later kinds, not in v1: a session, a memory note, a day's monitor reading, a failed suite run.

## The run

- Tools: `Read`, `Grep`, `Glob`, and `Bash` limited to read-only commands: `git log|show|diff|blame`, `aleph status`,
  `aleph jobs`, `aleph issue show|list`, `aleph models`. No write tool, no web.
- The prompt names the subject, its case, and the question: what happened, why, and what change would stop it from
  happening again.
- The agent must cite evidence for each claim: a `path:line`, a run id with a file, an event time, or a commit.

## The reply

```json
{
  "summary": "one paragraph",
  "timeline": [{ "at": "ISO time", "what": "one line", "evidence": "ref" }],
  "causes": [{ "claim": "one sentence", "evidence": ["ref"], "confidence": "measured|reported|inferred" }],
  "issues": [{ "title": "imperative, at most 60 chars", "kind": "task|bug", "spec": "markdown", "evidence": ["ref"],
               "impact": 1, "risk": 1, "effort": 1, "existing": "issue key or null" }]
}
```

Code drops a cause or an issue with no evidence, and an issue whose title fails `titleProblem`. `existing` names an open
issue that already covers the change. The panel then offers Note in place of File.

## Surfacing

- **Button:** Investigate in the head of the issue page and the job page. While a run is live it reads Running and is
  disabled. After a run it reads Investigate again.
- **Panel:** Investigation, on the subject page, near the bottom: after the Description and the Spec, before Media,
  Notes and Commits. It has a Contents entry. With no investigations the page hides it. A thin left border in the
  accent colour marks it a little. It shows the newest run: when, model, cost, the summary,
  the causes with their evidence, then the recommended issues. Each issue row has its title, kind, the three scores,
  the spec in a fold, and File, Dismiss (or Note when `existing` is set). A filed row shows its issue link. Older runs
  sit in a fold under it.
- **News:** one line when a run ends: `investigated issue.3350: 3 causes, 2 issues`, linked to the panel.
- **Runs:** the run is a job run like any other, so the Jobs page lists it and the Agents page has an Investigator row.
- **Not a Needs-you item:** Chris started it, so its result does not ask for attention beyond the news line.

A dismissed or filed row is a field on `result.json` (`issues[i].fate`: `filed <key>` or `dismissed`), written by the
API that files it.

## Limits

- The case for an issue with many jobs can pass the context window. The agent reads by pointer, so it can skip, and the
  summary must say what it did not read.
- Read-only `Bash` is a list of command prefixes in `--allowedTools`. A prefix such as `git show` can still read any
  file in the repo. That is the intent.
- Cost: an Opus run of about 30 min. Not measured yet. The first ten runs measure it.

## Not in v1

- Automatic runs, for example after two failed lands of one issue.
- Subjects other than issues and jobs.
- An investigator that edits code or files issues itself.
