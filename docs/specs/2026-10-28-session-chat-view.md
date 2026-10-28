# A chat view of a session

Written 2026-10-28 for job `aleph-371`. Built in the same job.

## Problem Statement

Chris: "design and build a conversational / chat view of sessions, search for good designs for this".

The session page (`#/sessions/:id`) is a table of turns: the prompt and the output cut to one line, model, tool count, duration, cost. It answers "what did this session cost" but not "what was said": to read a conversation, Chris opens each turn page, where prompt and output sit in `<pre>` blocks above a table of observations. A factory worker's session is one turn whose prompt is a 4 KB spec and whose work is a hundred tool calls; a long chat session is seventy turns, the first of which is often a `<task-notification>`, not something Chris typed.

## The survey

Eight chat-transcript and agent-trace UIs, each read for the same five things. The sandbox this spec was written in reaches no web site, so the notes are from the products as they stood in mid-2026, not from fresh screenshots; the points taken are the stable, long-standing ones.

### claude.ai shared chats

- **Messages.** The user's message is a rounded bubble on a tinted ground, right of a narrow reading column; Claude's reply is plain text on the page ground, no bubble, full column width. The column is about 48 rem wide whatever the window.
- **Tool calls.** Web search, artifacts and analysis tool calls are one line with an icon and a verb ("Searched the web", "Analyzed data"); a click opens the query and the results.
- **Thinking.** One folded line, "Thought for 12 s", that opens to the thinking text.
- **Long outputs.** Long pasted user text becomes an attachment card; the reply is never cut.
- **Per-turn metadata.** None on screen; the model is named once at the top.

### Claude Code on the web (session view)

- **Messages.** The user's prompt is a tinted block; the assistant's text is plain Markdown between tool calls, in the order it happened.
- **Tool calls.** One line per call: the tool name in bold and its key argument (`Bash(bun test ui)`, `Read(ui/lib.js)`, `Edit(ui/index.html)`) with a status dot; a click opens the input and the output. Runs of calls between two pieces of text read as a list of such lines.
- **Thinking.** Folded, one line.
- **Long outputs.** A tool result shows a few lines and a "+ N lines" fold.
- **System text.** Hook output, `<system-reminder>` and task notifications are not shown as user text; they surface as small grey status lines, if at all.
- **Per-turn metadata.** None in the message flow; cost and tokens sit in the session header.

### ChatGPT shared links

- **Messages.** Like claude.ai: user in a right-aligned bubble, assistant as plain prose in a centred reading column (about 48 rem).
- **Tool calls.** Browsing and code interpreter are a one-line chip ("Searched 5 sites", "Analyzed") that opens to show the code or the sources.
- **Thinking.** "Thought for 23 s", folded.
- **Long outputs.** Never cut; code blocks scroll sideways.
- **Per-turn metadata.** None.

### Langfuse sessions

- **Messages.** The session page lists the session's traces top to bottom; each trace is a card with its input and its output side by side or stacked, rendered as a chat (role labels, Markdown) when the payload is an OpenAI-style message list, else as pretty JSON.
- **Tool calls.** Not in the session view: a click on the trace opens its tree of observations (spans, generations, tool calls), each with input, output and metadata.
- **Thinking.** Only if the payload carries it, as part of the message JSON.
- **Long outputs.** The card is scrollable; JSON folds by level.
- **Per-turn metadata.** A row of badges on each card: latency, cost, tokens, scores, the trace id as a link.

### LangSmith threads

- **Messages.** A thread is a chat of the traces' inputs and outputs: human turns and AI turns as messages, one turn per trace.
- **Tool calls.** Shown inside the AI turn as folded tool-call blocks with their arguments; the full run tree is one click away in the trace view.
- **Long outputs.** Truncated with "Show more".
- **Per-turn metadata.** Latency, tokens and cost on a small line on each turn, and the trace link.

### Braintrust (logs and traces)

- **Messages.** A trace opens in a side panel: the span tree at the left, the selected span's input and output at the right; LLM spans render their message list as a chat with role labels; a "thread" layout shows the whole conversation as messages.
- **Tool calls.** Tool spans sit in the tree; in thread view, tool calls are compact blocks with name and arguments, folded.
- **Long outputs.** Collapsible fields; JSON pretty-printed.
- **Per-turn metadata.** Duration, tokens, cost and scores as small columns and badges on each span, never in the message text.

### Arize Phoenix

- **Messages.** The trace detail page shows an LLM span's input messages and output message as a chat, with role labels and Markdown; the session view lists the traces of a conversation as first input and last output, in order.
- **Tool calls.** Tool spans in the tree; an LLM span's tool calls show as folded JSON under the assistant message.
- **Long outputs.** Scroll within the block; a toggle between Markdown and raw text.
- **Per-turn metadata.** Latency, tokens and cost on each trace row and span header.

### OpenAI Agents SDK traces (platform dashboard)

- **Messages.** A trace is a timeline of spans (agent, generation, function, handoff, guardrail); a generation span shows its input and output messages as a chat.
- **Tool calls.** "Function" spans, one per call, name and arguments on one line, input and output on open.
- **Long outputs.** In the side panel, scrollable.
- **Per-turn metadata.** Duration bars on the timeline, tokens in the span panel.

## What the survey says

The chat apps (claude.ai, ChatGPT, Claude Code) agree on reading: one column of measured width, the user's text in a bubble, the assistant's as bare Markdown, tool calls and thinking as one folded line each. They hide metadata.

The trace tools (Langfuse, LangSmith, Braintrust, Phoenix, Agents SDK) agree on auditing: a turn is a unit with a header of numbers (latency, cost, tokens) and a link to its full tree, and the numbers never enter the message text.

The aleph session page is read for both: what was said, and what it cost and how long it took. So the design takes the chat apps' message flow and the trace tools' per-turn line.

## The design

### Take

| From | What |
|---|---|
| claude.ai, ChatGPT | One reading column (`76ch`, the width `.body` and `.md` already use). The user's prompt in a `--sunk` bubble at the right; the reply as bare Markdown at the left, through the shared `md()` renderer. |
| Claude Code | Each tool call one line: tool name, the key argument (`command`, `file_path`, `pattern`, `url`, `query`, `description`, `skill`), and an error mark; it opens to show input and output in `<pre>`. Hook and system text (`<task-notification>`, `<system-reminder>`, `<local-command-*>`, `<command-*>`) is not a user message: it folds to a one-line chip. |
| Langfuse, LangSmith, Braintrust | One muted line per turn, above it: "Turn n" linked to the turn page, model, duration, cost, start time. Nothing of it inside a message. |
| LangSmith, Claude Code | Long text is cut with a "Show all" button: a prompt or reply over about 20 lines shows 20 lines and a fade. |
| Langfuse | The full trace stays one click away: the turn link opens the existing turn page, whose header links to Langfuse. |

### Skip

| What | Why |
|---|---|
| Thinking blocks | The hooks never send thinking to Langfuse (`hooks/obs.ts` records the prompt, the final message, the tool calls and one generation per request without text), so there is nothing to fold. |
| Assistant text between tool calls | Same reason: only the last assistant message of a turn reaches Langfuse. The chat shows the turn's tool calls, then the final reply. |
| A span tree or a timeline | The turn page has the tree; the chat is for reading. |
| Token counts and scores in the turn line | Cost already sums the tokens; scores are rare. Five fields keep the line on one row at 390 px. |
| Avatars and role names on each message | Two roles, told apart by bubble and alignment; a label on each message is noise. |
| Hook spans (`vault-recall`, `verify-gate`) and subagents' inner tool calls | They are the turn page's job. The `Agent` tool call itself is in the chat, with its prompt and result. |
| Live streaming | Sessions are read after the fact. |

### Behaviour

- `#/sessions/:id` shows the chat; a Chat | Table segmented control above it switches to `#/sessions/:id?view=table`, the old table, unchanged.
- The chat loads the first 20 turns; "Show 20 more" under the last fetches the next 20 and appends them, so a 73-turn session costs four requests and the page never jumps.
- A turn whose prompt is only system text shows its chips and no bubble, so a session that opens with a `<task-notification>` reads from the first prompt Chris typed. The sessions list's First prompt column skips system text the same way.
- A turn with more than 12 tool calls shows its last 5 and folds the earlier ones into one line, "N earlier tool calls": a factory worker's 100-call turn is a screen, not ten.
- The page uses the existing tokens (`--sunk`, `--rule-2`, `--muted`, `--stuck` for errors), the type scale (`--fs-md` messages, `--fs-sm` tool lines, `--fs-xs` turn lines and chips, `--mono` for tool arguments) and so the dark theme with no new colour.

### Data

`GET /api/sessions/:id/chat?from=1&limit=20` (limit at most 50): `{ base, id, label?, project, taskTypes, total, from, turns }`, each turn `{ n, traceId, start, prompt, output, model, durationMs, cost, tools }` with the prompt and output whole (the hooks already cap them at 4 KB) and `tools` the turn's tool calls in start order, each `{ name, args, input, output, error, durationMs }`. It reads observations only for the turns it returns.

## Files

| File | Change |
|---|---|
| `ui/api/sessions.ts` | the chat route; the list's first prompt skips system text |
| `ui/views/sessions.js` | `renderChat`, the toggle, "Show 20 more" in `mountSession` |
| `ui/index.html` | the `.chat` styles |
| `ui/sessions.test.ts` | the route, the folds, the toggle, the paging |

## Screenshots

In [`2026-10-28-session-chat-view/`](2026-10-28-session-chat-view/), taken with headless Chromium against `ui/server.ts` and a stub Langfuse: `chat-73-*` is a 73-turn chat session that opens with a `<task-notification>` (the `-more` shot is after "Show 20 more": turns 21 to 25 of 40); `factory-*` is this job's own worker session, its tool calls read from the run's transcript. Each at 1440 and 390 px, light and dark, with one tool call opened. The web fonts did not load in the sandbox, so the text is in the fallback faces.
