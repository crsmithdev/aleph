---
name: retro
description: "Retrospective: find behavioral and technical patterns that repeat across sessions, factory runs, git history and issues, and propose fixes to the agent's environment (identity, skills, hooks, checks, vault, tooling)."
disable-model-invocation: true
---

The user has asked for a **retrospective**. You find **patterns**: things that happen again and again across the history, and propose changes to the agent's **environment** so they stop. One event is an anecdote. A pattern has at least two occurrences in different sessions, runs or days.

## Scope

The argument sets the scope:

- No argument: the last 7 days, every source below.
- A window (`3d`, `30d`, `since 2026-11-01`): that window, every source.
- A repo name: the default window, only that repo's sessions, runs, commits and issues.
- A session id: one session. Read its trace and transcript in full and skip the survey in step 3.

## Sources

Survey each source with a counting command first, and read raw text only for the clusters the counts show. The commands below are tested starting points; adapt the filters to the pattern you chase.

**Transcripts**: `~/.claude/projects/<cwd-slug>/<session_id>.jsonl`. `entrypoint` is `cli` for Chris's sessions and `sdk-cli` for headless factory workers: analyse the two apart. A user message whose content starts with `Stop hook feedback:` is a verify-gate denial, not Chris.

```sh
S=$(find ~/.claude/projects -name '*.jsonl' -mtime -7)
# tool errors, normalised and counted
echo "$S" | xargs jq -r 'select(.type=="user") | .message.content[]? | select(.type=="tool_result" and .is_error==true) | (.content|if type=="array" then .[0].text else . end) // "" | split("\n")[0:2] | join(" ") | .[0:100]' 2>/dev/null | sed -E 's/[0-9a-f]{7,}|[0-9]+/N/g' | sort | uniq -c | sort -rn | head -30
# Chris's prompts
echo "$S" | xargs jq -r 'select(.type=="user" and .entrypoint=="cli" and (.message.content|type)=="string") | .message.content | select(startswith("<") or startswith("Stop hook") | not)' 2>/dev/null
```

**Langfuse**: one trace per turn, grouped by session; it holds every tool call, generation, verify-gate verdict and price. Keys are in `~/.aleph/.env`.

```sh
curl -s -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" "${LANGFUSE_BASE_URL:-http://127.0.0.1:3010}/api/public/sessions?fromTimestamp=<iso>&limit=100"
```

`/api/public/sessions/<id>` gives one session's traces, and `/api/public/observations?traceId=<id>` gives one trace's spans.

**Factory**: `~/.aleph/runs/<run>/` holds one run (`exit`, `result.md`, `stderr.log`, `spec.md`, `diff.stat`). `~/.aleph/factory/` holds `corrections.json` (lessons already mined, with their state), `flaky.json`, `stalls.json`, `followups.log` and `suite-history.jsonl`. `~/.aleph/needs-you-log.md` lists items that reached Chris and what would have kept them off the list.

**Git**: every repo in `~/.aleph/repos.json`. Count reverts and fix commits, files that churn, and fixes to code that landed days before.

```sh
git -C <repo> log --since=7.days --format='%h %s'
git -C <repo> log --since=7.days --name-only --format= | sort | uniq -c | sort -rn | head
```

**Issues**: `aleph issue list <repo> --status <open|done|dropped> [--kind bug]`. Look for titles that repeat, bugs filed against the same area, and issues dropped after work started.

## Steps

1. Call the Skill tool with `aleph:writing-for-agents` for the writing style guide.

2. Set the scope from the argument.

3. **Survey**. Run a counting command on every source in scope. Done when each source has a count or a stated reason it has none.

4. **Cluster**. Group occurrences that share a cause into candidate patterns, across sources: a tool error in transcripts, a failed run and a fix commit can be one pattern. Read the raw evidence for each cluster with two or more occurrences until you can name its cause. Drop a candidate that `corrections.json` or an open issue already covers, and name what covers it.

5. **Classify** each pattern by the categories below. Done when every category has a verdict: a pattern with evidence, or "none found".

6. **Report** the patterns in order of cost (occurrences × the time or tokens each one wasted). Each one states its count, two or more cited occurrences (session id and line, trace id, run id, commit or issue), the proposed change, and where the change lives. Apply nothing until Chris asks. When he approves one, file it with `aleph issue add`.

## Categories

**Behavioral**: what the agent or Chris does.

- **Corrections**: Chris gives the same correction or repeats a request in more than one session. The fix is a rule where it would have fired.
- **Verify gate**: the gate denies turns that were fine, or the same denial reason repeats.
- **Memory**: the agent re-derives a fact the vault holds, or learns a fact and never writes it down.
- **Rework**: work is done, undone and redone: reverts, dropped issues, a factory job rerun on the same failure.
- **Interruptions**: tool calls Chris rejects, permission prompts, needs-you items. Each class of these is a candidate for a standing rule or an Always permission.

**Technical**: what the code and tools do.

- **Recurring errors**: the same tool error or test failure across sessions or runs. Classify each mistake first. A **mechanical** one (a fixed syntax pattern, a banned API, an import shape, a file-location rule, a schema limit) gets a deterministic check: a linter rule, a pre-commit hook, a CI job or an aleph hook, whichever is cheapest. A check that exists but is not wired is the finding, not a new check. A **judgement call** gets a written instruction.
- **Flakes and stalls**: tests or runs that fail and pass on the same code.
- **Hot spots**: files that churn or draw repeated fixes. Propose a seam, a test or a navigation pointer.
- **Navigation**: sessions that spend many calls to find the same file or fact. A **navigation pointer** fixes it.
- **Tool economy**: tool calls or CLIs that repeat expensive output. Propose a cheaper call or a tool change.
- **Information access**: a fact the agent needed and could not reach (server logs, CI logs, a third-party service).
- **No-ops**: instructions in steering files that change no behavior. Propose to delete them.

## Where a fix lives

- `identity/CLAUDE.md`, `~/.claude/CLAUDE.md`: loaded every session. Only what would cause mistakes if missing; navigation pointers over content.
- Skills: sometimes-relevant workflows and reference. The description is the always-loaded part; write it as the trigger.
- Hooks and checks: anything that must happen every time with no exceptions.
- The vault (`/aleph:vault`): facts about how things actually behave, decisions, corrections.
- Factory code (`jobs/`): a pattern in headless runs that a prompt, spec check or gate change would stop.
