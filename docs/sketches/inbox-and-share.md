# Inbox + Share — captured idea

Two ideas that turn out to be the same capture pipe with different exits.

## The frame

- **Inbox**: short, one-liner ideas you queue up while you're waiting on agents.
  Today: a stale text scratchpad. Want: an append-only log you can browse,
  triage into ready prompts, dispatch to a worker, or abandon — with a record
  of original capture vs. final decision vs. outcome.
- **Share**: "pastebin for AI context." Something said in Claude Code is not
  natively accessible to Claude Desktop or Web. Want: one-click publish, one-
  click retrieval, basic privacy.

Same primitive underneath: a stable id, content, a status, a retrieval path.

## Inbox shape

`~/.construct/inbox.jsonl`, append-only:

```
{ id, captured_at, source: "voice"|"text"|"vibe-annotate",
  raw: "...",
  status: "new"|"triaged"|"dispatched"|"done"|"abandoned",
  triaged: { intent, scope, proposed_agent } | null,
  dispatched_session_id, completed_at, outcome_summary,
  share_code: "ABC123" | null }
```

Capture surfaces:
- Textarea in existing localhost:3001
- CLI `construct capture "<line>"`
- Voice → Wispr snippet → that CLI
- vibe-annotate annotations

Verbs: `/triage` (Claude extracts intent + scope + proposed worker),
`/dispatch` (to Agent Teams or subagent), browse/filter/log in UI.

## Share shape

```
$ construct share <file-or-stdin> [--expiry 7d] [--passphrase] [--once]
→ Short code: ABC123  URL: https://share.construct.dev/ABC123
```

Retrieval surfaces:
- Claude Code: `/share get ABC123`
- Claude Desktop: MCP server exposes `share_get(code)`
- Claude Web: plain URL paste
- ChatGPT/Gemini: same plain URL

Privacy: short random code + optional Argon2 passphrase + expiry + optional
one-time read + owner-deletable token + optional client-side AES-GCM e2e.

## How they fuse

Each inbox row may carry a `share_code`. "Share this row to Claude Desktop"
is a one-button action; "pull share into inbox" is the reverse. One capture
pipe, two retrieval modes (local UI vs. remote short code).

## Phased build

- **A**: HTTP `POST /share` + `GET /share/:code`, CLI, file storage, TTL.
- **B**: MCP server exposing `share_get`/`share_put`; one line in
  Claude Desktop config.
- **C**: Inbox JSONL + UI tab + `/triage` + `/dispatch` wiring.
- **D**: Optional public hosting at `construct.dev/share`.

## Prior art (must not reinvent)

- OpenMemory MCP (Mem0), Supermemory MCP, Memento, Hindsight — continuous
  shared memory across MCP clients. Different shape (always-on) but overlaps.
- LWE `/pastebin` plugin — generic pastebin.com publishing with visibility +
  expiry. Less polished, no MCP.
- LinkMyPrompt — one-click prompt URL preloader. No privacy.
- PromptHub — git-style prompt versioning, team-oriented.
- Anthropic issue #13843, #53286 — native Code↔Desktop sync still open.
- `ShareOnboardingGuide` — Anthropic's own short-code-publish primitive,
  specialized for `ONBOARDING.md`. Possibly already the publish backend.
- Session Share skill — exports Claude Code session as portable JSON.

## Open questions (need answering before build)

1. Does this duplicate OpenMemory MCP for users who already run it?
2. If Anthropic ships #13843 / #53286 next quarter, does Share become dead code?
3. Is the Inbox just an Apple-Notes-shaped problem someone else has solved?
4. Does Claude Web accept MCP at all (or is the public URL path mandatory)?
5. Is the self-hosting ops cost worth dodging by sitting on top of an existing
   memory MCP?
