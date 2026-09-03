# aleph

A Claude Code plugin: four skills, hooks against the 2.1.x hook API, and
Langfuse as the only observability sink. It replaces the earlier Aleph at
`~/aleph` (skills, hooks, installer, SQLite telemetry, research, UI) and the
daemon design that lived in this repository until `a7540fa`.

| | |
|---|---|
| `skills/` | `red-team`, `interview`, `handoff`, `pickup`, invoked as `/aleph:<name>` |
| `hooks/obs.ts` | every hook event becomes one OTLP span posted to Langfuse |
| `hooks/git-guard.ts` | denies `Edit`/`Write` on `main` outside `.worktrees/` |
| `hooks/hooks.json` | the wiring; every observability entry is `async` |
| `compose/langfuse.yml` | self-hosted Langfuse on `127.0.0.1:3010` |

## Install

```bash
ln -s ~/aleph-next ~/.claude/skills/aleph     # loads as aleph@skills-dir
```

`SKILL.md` edits are live. Hook changes need `/reload-plugins`. For a one-off
session against a checkout: `claude --plugin-dir <path>`.

## Langfuse

```bash
cp .env.example .env            # fill it; openssl rand -hex 32 for each secret
docker compose -p aleph-langfuse --env-file .env -f compose/langfuse.yml up -d
curl -s http://127.0.0.1:3010/api/public/health
```

The `LANGFUSE_INIT_*` block creates the org, project, user and API key pair
on first boot. Put the pair where the hooks read it:

```
# ~/.aleph/.env
LANGFUSE_BASE_URL=http://127.0.0.1:3010
LANGFUSE_PUBLIC_KEY=pk-lf-…
LANGFUSE_SECRET_KEY=sk-lf-…
```

Without those two keys the hooks exit silently.

## Traces

One session is one trace; its id is `sha256(session_id)[:32]`.

```
session                 root, tags source:* and mode:*
└─ turn                 one per prompt, output = last assistant message
   ├─ prompt            event, input = the prompt
   ├─ <model id>        one generation per API request, usage and cost
   ├─ <tool name>       real start and end via a Pre→Post handshake file
   ├─ <agent type>      subagent, with its own tool spans beneath it
   └─ verify-gate       guardrail, verdict and reason (docs/verify-gate.md)
```

Generations come from the transcript at `Stop`: one per `requestId`, with
`input`, `output`, `cache_read_input_tokens` and `cache_creation_input_tokens`
as usage and a cost computed from the price table in `hooks/lib/pricing.ts`.
The hook prices them itself because Langfuse's public models API keeps only
input and output prices, and cache reads are most of a Claude Code request.

Compaction, permission denials, API failures and session end are events on
the trace. A trace is at
`http://127.0.0.1:3010/project/aleph-local/traces/<id>`.

## Tests

```bash
bun test                        # hooks, with a mock Langfuse
ALEPH_LIVE=1 bun test tests/live  # posts a span and fetches the trace back
```

A 200 on the OTLP POST proves nothing; the worker can drop a batch silently
(`compose/README.md`, defect 2). The live test asserts the trace is
retrievable.

## Not here

Research, memory hooks, the keyword skill router, behavioral modes, goals,
eval, the UI, and the `plan`/`sketch`/`git`/`debug`/`code-review` skills.
`debug` and `code-review` are bundled in Claude Code now. The rest is in
`~/aleph`'s history.
