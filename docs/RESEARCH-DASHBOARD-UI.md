# Research Dashboard UI Patterns

Research into how leading tools present findings, thread trees, and worker/job status.
Focused on open-source React components and proven patterns.

---

## 1. Research Findings Presentation

### What leading tools do

**GPT Researcher** (NextJS + Tailwind)
- Streaming report into a rich-text area as generation happens — not a card grid, just a long structured document
- Inline AI-generated images (Gemini) embedded in the report body
- Source citations threaded throughout, with a separate sources panel
- Export to PDF, Word, Markdown
- Real-time progress tracking while the agent runs (separate from the output area)
- Repo: [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher), docs: [docs.gptr.dev](https://docs.gptr.dev/docs/gpt-researcher/frontend/introduction)

**Stanford STORM / Co-STORM**
- Produces Wikipedia-style articles: hierarchical outline → sections with citations
- Co-STORM adds a dynamic mind map sidebar that updates as research progresses, showing a hierarchical concept structure to reduce cognitive load during long sessions
- Live UI: [storm.genie.stanford.edu](https://storm.genie.stanford.edu)
- Repo: [stanford-oval/storm](https://github.com/stanford-oval/storm)

**Perplexity Deep Research**
- Progress sidebar during research: query interpretation → live search stats → drafting preview
- Final output: a scrollable report with inline citations; each citation is a numbered superscript that opens a source card
- Thread-based follow-up: prior context persists without re-running
- Sources panel alongside the report, not below it

**LangChain Deep Agents UI**
- Chat interface + file-in-state panel showing what the agent has written so far
- Each agent step streams to the frontend as it happens
- Repo: [langchain-ai/deep-agents-ui](https://github.com/langchain-ai/deep-agents-ui)

### Patterns that recur

| Pattern | Description |
|---|---|
| Streaming document | Report builds live rather than appearing all at once |
| Inline citations | Numbered superscripts in text; clicking opens source card/panel |
| Source sidebar | Sources listed beside the report, not in a modal |
| Progress log | Running log of searches and steps during generation, collapses when done |
| Structured outline | Hierarchical section headings, not a flat wall of text |
| Export options | PDF, Markdown, Word — always offered |

### Component recommendations

- **Streaming markdown**: `react-markdown` + custom renderers for citations; or `@mdxeditor/editor` if editing is needed
- **Source cards**: Custom component — thumbnail, domain, snippet, link; can be a `<Popover>` triggered by citation number
- **Split-panel layout**: Left = report/document, Right = sources/mind-map; `react-resizable-panels` (shadcn-compatible, MIT)
- **Progress log**: Collapsible `<details>` or animated accordion with step-by-step entries; Vercel AI Elements `ChainOfThought` component ([elements.ai-sdk.dev](https://elements.ai-sdk.dev/components/chain-of-thought)) does this well — shadcn-based, open source ([vercel/ai-elements](https://github.com/vercel/ai-elements))

---

## 2. Thread Tree Visualization

### What leading tools do

**STORM Co-STORM**
- Mind map sidebar: hierarchical concept tree that updates dynamically during research
- Nodes are concepts/topics; edges are relationships; collapsible subtrees

**Perplexity**
- Flat thread list (conversation history), not a tree — branches are not visually represented

**LangGraph / Deep Agents**
- No dedicated tree visualization in the default UI; thread state is shown as a list of messages/tool calls

**Tree of Thoughts implementations**
- Most lack polished UIs; the common pattern is a collapsible JSON tree or a D3 radial layout
- Repo: [mazewoods/tree-of-thought-ui](https://github.com/mazewoods/tree-of-thought-ui) — Python/terminal, not a React component

**Vercel AI Elements**
- `<Reasoning>` component: collapsible panel showing AI reasoning steps, auto-opens during streaming, closes on completion
- `<ChainOfThought>` component: step list with status (pending/active/complete), icons, search results, images
- These are step lists, not branching trees, but cover the "show agent thinking" use case well

### Visualization approaches compared

| Approach | Best for | Drawbacks |
|---|---|---|
| Collapsible indented list | Simple depth-first exploration, easy to implement | Hard to see branching/parallelism |
| Horizontal tree (D3/react-d3-tree) | Clear parent-child hierarchy, familiar | Gets wide quickly with many branches |
| Radial/mind map | Large topic graphs, concept exploration | Harder to read linear sequences |
| DAG (React Flow) | Arbitrary graphs, non-tree structures | More complex to implement |
| Swimlane/timeline | Parallel branches at same depth | Loses hierarchical depth context |

### Component recommendations

**For collapsible exploration trees (the most common research thread case):**
- `react-d3-tree` ([bkrem/react-d3-tree](https://github.com/bkrem/react-d3-tree)) — MIT, 1.4k stars, renders D3 tree layouts in React, supports custom node rendering, collapsible, path styles (diagonal/elbow/step). Best fit for a "research thread as tree" visualization.
- `react-arborist` ([brimdata/react-arborist](https://github.com/brimdata/react-arborist)) — MIT, virtualized tree view, drag-and-drop, keyboard navigation. Better for sidebar/file-tree style; less suited for visual graph layout.

**For mind-map / concept graph style:**
- React Flow ([xyflow/xyflow](https://github.com/xyflow/xyflow)) — MIT, 25k+ stars, node-based canvas, handles DAGs and trees, custom node/edge rendering, shadcn component library. Overkill for simple trees but the right choice if nodes need arbitrary connections.
- `reagraph` ([reaviz/reagraph](https://github.com/reaviz/reagraph)) — MIT, WebGL, 2D/3D, better for large knowledge graphs with hundreds of nodes.

**For step-by-step reasoning display (not a branching tree):**
- Vercel `ai-elements` `<ChainOfThought>` and `<Reasoning>` — shadcn-based, installable via `npx ai-elements@latest`, open source ([vercel/ai-elements](https://github.com/vercel/ai-elements))

**Practical recommendation for a research dashboard:**
Use a two-mode toggle:
1. **Outline view** — indented collapsible list (`react-arborist`) for navigating a deep thread
2. **Graph view** — React Flow canvas for seeing cross-connections between sub-topics

---

## 3. Worker / Job Status Dashboard

### What leading tools do

**Bull Board** ([felixmosh/bull-board](https://github.com/felixmosh/bull-board))
- Left sidebar: queue list with badge counts per state
- Main panel: job table filtered by state (active/waiting/completed/failed/delayed)
- Job detail: JSON data, return value, stack trace, retry button
- Actions: retry, clean, pause/resume queue
- React components in `packages/ui/src`; MIT licensed

**Temporal UI**
- Timeline view: horizontal time axis, vertical axis is activity/workflow type
- Event groups collapse 3 related events (scheduled → started → completed) into one colored span
- Color system: green=success, red=failed, dashed-red=retrying, dashed-purple=pending
- Tooltips show exact ms-precision start/end/duration
- Single events (signals, markers) render as points, not spans
- Retry attempt badges on failed spans
- Built on `vis-timeline` + Svelte; open source ([temporalio/ui](https://github.com/temporalio/ui))
- Blog: [temporal.io/blog/lets-visualize-a-workflow](https://temporal.io/blog/lets-visualize-a-workflow)

**Celery Flower**
- Workers tab: online/offline status, tasks processed, active count, pool type/concurrency
- Tasks tab: filterable table — name, UUID, state, runtime, timestamp
- Broker tab: queue name, message count, consuming workers
- Prometheus endpoint at `/metrics`; metrics: `flower_worker_online`, `flower_task_runtime_seconds` histogram, prefetch time
- Repo: [mher/flower](https://github.com/mher/flower)

**Sidekiq Web**
- Stats bar at top: processed, failed, busy, enqueued, scheduled, retries, dead
- Queue table: name, latency, busy count, enqueued count, pause/clear actions
- Retry queue: shows next retry time, error class, error message
- Dead queue: jobs that exhausted retries; can resurrect individually

### Patterns that recur

| Pattern | Description |
|---|---|
| State-bucketed counts | Badges/tabs for each state: active, waiting, completed, failed, delayed |
| Per-worker status row | Worker name, online/offline, current load, processed count |
| Job detail drawer | Click a job → slide-out panel with full data, logs, stack trace |
| Retry / requeue action | Inline on failed jobs, not buried in menus |
| Timeline view | For workflows with distinct phases; horizontal time, colored spans |
| Throughput metrics | Jobs/sec or jobs/min, success rate, p50/p95 runtime histograms |
| Honest partial failure | "20 succeeded, 3 failed, 5 skipped" — not just "completed" |
| Real-time updates | WebSocket or SSE push for active job state, not polling |

### Metrics to show (priority order)

1. **Current active count** — how many workers are doing work right now
2. **Queue depth** — how backed up is the queue
3. **Error rate** — failures / (successes + failures) over a rolling window
4. **Throughput** — jobs completed per minute
5. **p50 / p95 runtime** — are jobs slower than expected
6. **Worker online/offline** — which workers are reachable
7. **Oldest waiting job age** — are jobs getting stuck

### Layout

Three zones:

```
┌─────────────────────────────────────────────────────────┐
│  Stats bar: [Active: 4] [Queued: 120] [Failed: 2] [p95] │
├──────────────┬──────────────────────────────────────────┤
│ Worker grid  │  Job table (filterable by state)         │
│ - worker-1 ● │  [Name] [State] [Runtime] [Started] [▶]  │
│ - worker-2 ● │  ....                                    │
│ - worker-3 ○ │  ....                                    │
│              │                                          │
└──────────────┴──────────────────────────────────────────┘
```

Add a timeline view as a tab/toggle if jobs have meaningful phases.

### Component recommendations

- **State badges**: shadcn `<Badge>` variants — one color per state, consistent across the UI
- **Job table**: TanStack Table — virtualized, sortable, filterable, MIT
- **Timeline view**: `vis-timeline` (what Temporal uses) or `@visx/timeline` (lighter, D3-based, MIT)
- **Throughput chart**: Recharts `<AreaChart>` — simple, React-native, MIT
- **Worker status grid**: CSS grid of cards — name, status dot, active/processed counts; auto-refreshing via SWR or React Query
- **Detail drawer**: shadcn `<Sheet>` (slide-over panel)

---

## Summary Recommendations

### Research findings
Use a **streaming document** layout with a sticky source sidebar. Render markdown with inline citation superscripts. Collapse the agent progress log once generation completes. Use `react-resizable-panels` for the split view. Adopt Vercel `ai-elements` `<Reasoning>` for the progress panel.

### Thread trees
Default to an **indented collapsible list** (`react-arborist` or a plain recursive component). Add a React Flow canvas view for users who want to see cross-connections. For showing agent reasoning steps (not a branching tree), use Vercel `ai-elements` `<ChainOfThought>`.

### Worker status
Use a **three-zone layout**: top stats bar (counts by state), left worker grid (online/offline, per-worker load), main job table (filterable by state). Add a timeline view only if jobs have meaningful distinct phases. Link every failed job to its detail drawer with retry action. Surface error rate and queue depth as the two most prominent metrics.

---

## Sources

- [GPT Researcher GitHub](https://github.com/assafelovic/gpt-researcher)
- [GPT Researcher Frontend Docs](https://docs.gptr.dev/docs/gpt-researcher/frontend/introduction)
- [Stanford STORM GitHub](https://github.com/stanford-oval/storm)
- [Temporal Timeline View blog](https://temporal.io/blog/lets-visualize-a-workflow)
- [Temporal UI redesign blog](https://temporal.io/blog/the-dark-magic-of-workflow-exploration)
- [Bull Board GitHub](https://github.com/felixmosh/bull-board)
- [Celery Flower GitHub](https://github.com/mher/flower)
- [LangChain Deep Agents UI](https://github.com/langchain-ai/deep-agents-ui)
- [LangChain open_deep_research](https://github.com/langchain-ai/open_deep_research)
- [Vercel ai-elements GitHub](https://github.com/vercel/ai-elements)
- [Vercel ChainOfThought component](https://elements.ai-sdk.dev/components/chain-of-thought)
- [react-d3-tree GitHub](https://github.com/bkrem/react-d3-tree)
- [react-arborist GitHub](https://github.com/brimdata/react-arborist)
- [React Flow / xyflow](https://github.com/xyflow/xyflow)
- [reagraph GitHub](https://github.com/reaviz/reagraph)
- [LogRocket: UI patterns for async workflows](https://blog.logrocket.com/ux-design/ui-patterns-for-async-workflows-background-jobs-and-data-pipelines/)
- [Perplexity Deep Research intro](https://www.perplexity.ai/hub/blog/introducing-perplexity-deep-research)
- [Mission Control agent dashboard](https://github.com/jeturing/mission-control)
