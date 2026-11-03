# Langfuse

The hooks send each Claude Code session to a self-hosted [Langfuse](https://langfuse.com) on `127.0.0.1:3010`. Langfuse is optional: without its keys the tracing hooks exit silently.

## Set it up

1. Fill in the compose secrets. Use `openssl rand -hex 32` for each secret:
   ```bash
   cp .env.example .env
   ```
2. Start Langfuse and check its health:
   ```bash
   docker compose -p aleph-langfuse --env-file .env -f compose/langfuse.yml up -d
   curl -s http://127.0.0.1:3010/api/public/health
   ```
   On the first boot, the `LANGFUSE_INIT_*` block creates the org, the project, the first user and an API key pair.
3. Put the key pair where the hooks read it, in `~/.aleph/.env`:
   ```bash
   LANGFUSE_BASE_URL=http://127.0.0.1:3010
   LANGFUSE_PUBLIC_KEY=pk-lf-…
   LANGFUSE_SECRET_KEY=sk-lf-…
   ```

[compose/README.md](../compose/README.md) covers Docker inside WSL2 and checks the project with the API.

## What a trace holds

One turn is one trace. A Claude Code session is the Langfuse session that groups its turns, so the Sessions page shows a session as its prompts and replies. Each trace has the name of the session's start directory and an `environment`: `interactive`, `headless` (an ancestor process is `claude -p`), or the value of `ALEPH_ENV`.

```text
turn                    root: input = the prompt, output = the last assistant
│                       message, tags source:* and mode:*, metadata cwd
├─ <model id>           one generation per API request, with usage and cost
├─ <tool name>          real start and end, from a Pre→Post handshake file
├─ <agent type>         a subagent, with its own tool spans below it
└─ verify-gate          guardrail: verdict and reason
```

At `Stop`, the hook reads the generations from the transcript, one per `requestId`, with cache reads and cache writes as usage. It prices them from `hooks/lib/pricing.ts`, because the Langfuse models API keeps only input and output prices, and cache reads are most of a Claude Code request.

## Scores

| Score | Set by | Value |
|---|---|---|
| `rating` | A prompt that contains `N/10` | N, on the previous turn's trace, with the prompt as the comment |
| `verified` | The verify gate, on each turn it judges | 1 pass, 0 deny, 0.5 forced pass |

## Factory traces

After each factory run, the factory sends the worker's stream-json, and the reviewer's, as one trace named `factory <job>` with the job id as its session id. It makes one span per tool call (`jobs/lib/trace.ts`). A failed post writes one line to `trace.log` in the run folder and changes nothing else.
