# construct-memory

Session hooks, memory directories, ratings capture, semantic memory.

**Depends on:** construct-core
**Optional:** mcp-memory-service (for semantic memory)

## Contents

- `sessions/` — session summaries
- `signals/ratings.jsonl` — explicit + implicit satisfaction ratings
- `hooks/session-start.ts` — surfaces last session at SessionStart; prompts semantic memory search
- `hooks/rating-capture.ts` — captures explicit N/10 ratings at UserPromptSubmit
- `hooks/memory-gate.ts` — enforces quality `memory_store` call before exit on substantive sessions
- `hooks/session-summary.ts` — context-injected session summary at Stop

## Usage

Everything runs automatically. What you'll see:

- **Session start** — Claude searches semantic memory for relevant project context and surfaces the last session summary.
- **Automatic memory storage** — Claude stores decisions, patterns, anti-patterns, preferences, and error resolutions to semantic memory as it works. No "remember X" needed.
- **Ratings** — type `8`, `8/10`, or `I rate this 8` at any prompt to record an explicit satisfaction rating. Low ratings (≤3) trigger a reminder to store what went wrong via `memory_store`.
- **Session summaries** — at session end (4+ messages), a summary of tools used, files touched, and topics is saved to `sessions/`

### Semantic memory setup

Install mcp-memory-service and register it as an MCP server:

```bash
uv tool install mcp-memory-service
claude mcp add memory -s user \
  -e MCP_SEMANTIC_DEDUP_ENABLED=true \
  -e MCP_SEMANTIC_DEDUP_THRESHOLD=0.85 \
  -e MCP_HYBRID_SEARCH_ENABLED=true \
  -e MCP_DECAY_ENABLED=true \
  -e MCP_MEMORY_USE_ONNX=true \
  -- memory server
```

Once configured, Claude uses `memory_store` and `memory_search` MCP tools automatically. Memories are tagged by type (decision, pattern, anti_pattern, preference, architecture, error_resolution) and searchable via hybrid semantic + keyword matching.

Storage: `~/.local/share/mcp-memory/sqlite_vec.db` (Linux). No external services.

### Two layers of memory

| Layer | What | How | When |
|---|---|---|---|
| **Semantic** (mcp-memory-service) | Decisions, patterns, preferences, errors | Automatic — Claude stores/retrieves via MCP tools | Every session |
| **Signals** (ratings.jsonl, sessions/) | Satisfaction, session history | Automatic — hooks capture | Session end |

### CLAUDE.md vs memory

| | CLAUDE.md | Memory |
|---|---|---|
| **Purpose** | Rules — how Claude should behave | Knowledge — what Claude should know |
| **Tone** | Prescriptive: "always do X", "never do Y" | Descriptive: "we learned X", "we're working on Y" |
| **In context** | Always fully loaded, every message | Searched at session start, queried on demand |
| **Managed by** | You (or the installer) | Claude (semantic) |
| **Examples** | "Commit messages: imperative mood, <72 chars" | "API migration is blocked on auth refactor" |
| | "Never create docs unless asked" | "ruff 0.4 broke our lint config, pin to 0.3" |

Rule of thumb: if you'd say it as an instruction ("do this"), it goes in CLAUDE.md. If you'd say it as a fact ("this is true"), it goes in memory.

## Verification

Post-install checks: see [INSTALL.md](INSTALL.md).
