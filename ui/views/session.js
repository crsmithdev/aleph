// Session and Turn: the conversations Langfuse recorded. One module holds the two
// views; sessions-session.js and sessions-turn.js re-export them, because the page
// reads one `view` per file. The list of sessions is in sessions.js.
import { clamp, count, fold, goQuery, say, facts, chip, chips, costHtml, crumb, dataTable, durMs as dur, empty, error, esc, heads, idLink, md, pageRows, pager, pageHead, linkButton, shortModel, statusRow, tabs, tag, tone, when } from "../lib.js";
import { systemParts } from "../system-parts.js";
import { detailPanel, renderKpis } from "../timeline.js";

const down = (d) => `<div class="page">${error(`Langfuse is unreachable: ${d.error}`, "Check that Langfuse is running and LANGFUSE_* is set in ~/.aleph/.env, then reload.")}</div>`;
const langfuse = (base, traceId) => (base && traceId ? linkButton("Open in Langfuse", `${base}/trace/${traceId}`) : "");
/** One line of `s`, cut at 60 characters with an ellipsis. */
const line = (s) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > 60 ? `${t.slice(0, 59)}…` : t; };
const href = (path) => `#${path}`;

/** The session's id link: the job name when it is a factory session, else the id's first 8 characters; the title is the full id. */
const sessionLink = (s) =>
  idLink(s.label ?? s.id.slice(0, 8), href(`/sessions/${encodeURIComponent(s.id)}`), { title: s.id });

/** The turn table: the session page's `?view=table`. */
const TURN_PAGE = 50;
function turnTable(d, page = 1) {
  if (!d.turns.length) return empty();
  // Columns: turn (id), prompt (title), output, model, numbers, time.
  const rows = pageRows(d.turns, page, TURN_PAGE).map((t) =>
    `<tr><td>${idLink(String(t.n), href(`/sessions/${encodeURIComponent(d.id)}/turns/${t.n}`))}</td>` +
    `<td class="wide" title="${esc(t.prompt)}">${esc(t.prompt)}</td><td title="${esc(t.output)}">${esc(line(t.output))}</td><td>${esc(shortModel(t.model))}</td><td class="num">${count(t.tools)}</td>` +
    `<td class="num">${esc(sdur(t.seconds))}</td><td class="num">${costHtml(t.cost, t.wk)}</td><td class="time">${esc(when(t.start))}</td></tr>`).join("");
  return dataTable(heads(["Turn", "Prompt", "Output", "Model", "Tools", "Took", "Cost", "Started"], ["Tools", "Took", "Cost", "Started"]), rows) + pager(page, d.turns.length, TURN_PAGE);
}

const CHAT_PAGE = 20;
const CLIP_LINES = 20, CLIP_CHARS = 1600, TOOLS_SHOWN = 5, TOOLS_FOLD = 12;

/** Long text shows its first lines under a fade, with the clamp button. */
const clip = (text, html) => (text.length > CLIP_CHARS || text.split("\n").length > CLIP_LINES ? clamp(html) : html);

/** A system part as a one-line chip: the tag, and its summary or first line; it opens to the whole text. */
function sysChip({ tag, body }) {
  const peek = (body.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 100);
  return fold(`${chip(tag)}<span class="peek">${esc(peek)}</span>`, `<pre>${esc(body)}</pre>`, { cls: "sysc" });
}

/** Ms from the seconds of an answer, and that as a duration. */
const msOf = (s) => (s == null ? null : s * 1000), sdur = (s) => dur(msOf(s));

/** A tool call on one line: name, key argument, error mark, duration; it opens to input and output. */
function toolLine(c) {
  const io = (label, text) => (text ? `<h4>${label}</h4><pre>${esc(text)}</pre>` : "");
  return fold(`<span class="tn">${esc(c.name)}</span>` +
    `${c.args ? `<code class="ta">${esc(c.args)}</code>` : ""}${c.error ? `<span class="terr">Error</span>` : ""}` +
    `<span class="td">${esc(sdur(c.seconds))}</span>`,
    `<div class="tio">${io("Input", c.input)}${c.error ? io("Error", c.error) : ""}${io("Output", c.output)}</div>` +
    `${c.children?.length ? `<div class="tools sub">${c.children.map(toolLine).join("")}</div>` : ""}`, { cls: `tool${c.error ? " err" : ""}` });
}

function toolList(tools) {
  if (!tools?.length) return "";
  const early = tools.length > TOOLS_FOLD ? tools.slice(0, tools.length - TOOLS_SHOWN) : [];
  const late = tools.slice(early.length);
  const errs = early.filter((c) => c.error).length;
  const earlyTools = early.length
    ? fold(`${early.length} earlier tool calls${errs ? ` <span class="terr">${errs} failed</span>` : ""}`, early.map(toolLine).join(""), { cls: "tools-early" })
    : "";
  return `<div class="tools">${earlyTools}${late.map(toolLine).join("")}</div>`;
}

/** The tool calls with the assistant's text blocks between them: each text follows the calls that started before it. */
function work(t) {
  const texts = t.texts ?? [];
  if (!texts.length) return toolList(t.tools);
  const tools = t.tools ?? [];
  const at = (x) => Date.parse(x) || 0;
  let i = 0, out = "";
  for (const x of texts) {
    const j = tools.findIndex((c, k) => k >= i && at(c.start) > at(x.at));
    const upto = j < 0 ? tools.length : j;
    out += toolList(tools.slice(i, upto));
    i = upto;
    out += `<div class="msg say md">${clip(x.text, md(x.text))}</div>`;
  }
  return out + toolList(tools.slice(i));
}

/** One turn: its muted line (linked to the turn page), the system chips, the prompt, the tool calls, the reply. */
export function chatTurn(id, t) {
  const { system, text } = systemParts(t.prompt);
  const meta = facts([["Turn", idLink(String(t.n), href(`/sessions/${encodeURIComponent(id)}/turns/${t.n}`))],
    ["Model", esc(shortModel(t.model))], ["Took", esc(sdur(t.seconds))], ["Cost", costHtml(t.cost, t.wk)], ["Started", esc(when(t.start))]]);
  const out = String(t.output ?? "").trim();
  return `<section class="turn" id="turn-${t.n}">${meta}` +
    (system.length ? `<div class="sys">${system.map(sysChip).join("")}</div>` : "") +
    (text ? `<div class="msg user md">${clip(text, md(text))}</div>` : "") +
    work(t) +
    (out ? `<div class="msg reply md">${clip(out, md(out))}</div>` : empty()) + `</section>`;
}

/** Under the chat: "Previous 20", "Next 20" and "21–40 of 73"; a button fetches its page of turns. `from` is the first turn shown. */
const chatPager = (from, total) => pager((from - 1) / CHAT_PAGE + 1, total, CHAT_PAGE, { cls: "chat-pager" });

const chatBody = (d) => `<div id="chat-pane"><div class="chat">${d.turns.map((t) => chatTurn(d.id, t)).join("")}</div>${chatPager(d.from, d.total)}</div>`;

const isTable = (query) => query?.get?.("view") === "table";
const isWaterfall = (query) => query?.get?.("view") === "waterfall";

/** The waterfall's rows in draw order: each turn, then its calls nested by parent. */
export function wfRows(turns) {
  const rows = [];
  const add = (c, depth, turn) => {
    const gen = c.kind === "generation";
    rows.push({ id: c.id, depth, kind: c.kind, name: gen ? c.model || c.name : c.name, args: c.args, start: c.start, startMs: c.from * 1000, endMs: c.to * 1000, error: c.error, input: c.input, output: c.output, durationMs: msOf(c.seconds), turn,
      ...(gen ? { model: c.model, cost: c.cost, inputTokens: c.inputTokens, outputTokens: c.outputTokens } : {}) });
    for (const k of kids(c.id, c.children)) add(k, depth + 1, turn);
  };
  let gens = [];
  // A parent's tool rows and generations in time order.
  const kids = (parent, tools = []) => [...tools, ...gens.filter((g) => g.parent === parent)].sort((a, b) => a.from - b.from);
  for (const t of turns) {
        const lastEnd = (cs) => cs.reduce((m, c) => Math.max(m, c.to * 1000, lastEnd(c.children ?? [])), 0);
    rows.push({ id: `turn-${t.n}`, depth: 0, kind: "turn", name: `Turn ${t.n}`, args: line(systemParts(t.prompt).text), start: t.start, startMs: t.from * 1000, endMs: Math.max(t.to * 1000, lastEnd([...(t.tools ?? []), ...(t.generations ?? [])])),
      error: null, input: t.prompt, output: t.output, durationMs: msOf(t.seconds), model: t.model, cost: t.cost, wk: t.wk, turn: t.n });
    gens = t.generations ?? [];
    for (const c of kids(null, t.tools ?? [])) add(c, 1, t.n);
  }
  return rows;
}

const axisTick = (ms) => (ms <= 0 ? "0s" : dur(Math.round(ms)));

/** Wall time, summed tool time, the 3 longest calls (links that select their row) and the error count. */
function wfSummary(rows) {
  const calls = rows.filter((r) => r.kind !== "turn");
  const wall = rows.reduce((m, r) => Math.max(m, r.endMs), 0);
  const toolMs = calls.filter((r) => r.kind === "tool").reduce((n, r) => n + (r.durationMs ?? 0), 0);
  const modelMs = calls.filter((r) => r.kind === "generation").reduce((n, r) => n + (r.durationMs ?? 0), 0);
  const longest = calls.filter((r) => r.kind !== "generation").sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0)).slice(0, 3).filter((r) => r.durationMs);
  const errors = calls.filter((r) => r.error).length;
  const took = (ms) => (ms ? esc(dur(Math.round(ms))) : "");
  return facts([["Wall time", took(wall)], ["Tool time", took(toolMs)], ["Model time", took(modelMs)],
    ["Longest", longest.map((r) => `<button class="link" type="button" data-select="${esc(r.id)}">${esc(r.name)}${r.args ? `(${esc(r.args.slice(0, 30))})` : ""} ${esc(dur(r.durationMs))}</button>`).join(", ")],
    ["Errors", errors ? `<strong class="terr">${errors}</strong>` : ""]]);
}

function wfRow(r, max, sel) {
  const left = (r.startMs / max) * 100;
  const width = Math.max(0.2, ((r.endMs - r.startMs) / max) * 100);
  const label = r.kind === "turn" ? `<span class="tn">${esc(r.name)}</span>${r.args ? `<span class="ta">${esc(r.args)}</span>` : ""}` : `<span class="tn">${esc(r.name)}</span>${r.args ? `<code class="ta">${esc(r.args)}</code>` : ""}`;
  return `<div class="wf-row k-${r.kind}${r.error ? " err" : ""}${r.id === sel ? " sel" : ""}" role="row" tabindex="0" data-id="${esc(r.id)}" aria-selected="${r.id === sel}">` +
    `<div class="wf-l" style="padding-left:calc(${r.depth} * var(--sp-14))" title="${esc(r.name + " " + (r.args ?? ""))}">${label}</div>` +
    `<div class="wf-r"><span class="wf-bar" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"></span><span class="wf-d">${esc(dur(r.durationMs))}</span></div></div>`;
}

/** Summary, axis and rows; the id of the selected row marks its row. */
export function waterfall(rows, sel = null) {
  const max = Math.max(1, rows.reduce((m, r) => Math.max(m, r.endMs), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${esc(axisTick(max * f))}</span>`).join("");
  return wfSummary(rows) +
    `<div class="wf-grid" role="table"><div class="wf-axis"><div class="wf-l">Elapsed from session start</div><div class="wf-r">${ticks}</div></div>` +
    rows.map((r) => wfRow(r, max, sel)).join("") + `</div>`;
}

/** The detail pane of one row. */
export function wfDetail(r) {
  if (!r) return empty("Select a row");
  const io = (label, text) => (text ? `<h4>${label}</h4>${clip(text, `<pre>${esc(text)}</pre>`)}` : "");
  return `<h3>${esc(r.name)}${r.args && r.kind !== "turn" ? ` <code>${esc(r.args)}</code>` : ""}</h3>` +
    facts([["Kind", esc(r.kind)], ["Started", `${esc(when(r.start))} (+${esc(axisTick(r.startMs))})`], ["Took", esc(dur(r.durationMs))],
      ["Model", r.model ? esc(shortModel(r.model)) : ""], ["Cost", r.cost ? costHtml(r.cost, r.wk) : ""],
      ["Tokens", r.inputTokens != null || r.outputTokens != null ? `${count(r.inputTokens)} in, ${count(r.outputTokens)} out` : ""]]) +
    io("Input", r.input) + (r.error ? io("Error", r.error) : "") + io("Output", r.output);
}

const wfBody = (rows, sel) => `<div class="wf"><div class="wf-main">${waterfall(rows, sel)}</div><aside class="wf-detail" aria-label="Detail">${wfDetail(rows.find((r) => r.id === sel))}</aside></div>`;

export function renderSession(d, _params, query = new URLSearchParams()) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const table = isTable(query), wf = isWaterfall(query);
  const aside = [sessionLink(d), langfuse(d.base, d.turns[0]?.traceId)].filter(Boolean).join(" ");
  const view = table ? "table" : wf ? "waterfall" : "chat";
  // Only the open pane is drawn: the table reads the whole session, the chat and the waterfall page it, so a tab click reloads.
  const pane = table ? `<div id="turn-table">${turnTable(d)}</div>` : wf ? `<div id="chat-pane"><div class="wf-wrap">${wfBody(wfRows(d.turns), null)}</div>${chatPager(d.from, d.total)}</div>` : chatBody(d);
  return `<div class="page dp-page">${crumb("#/sessions", [["sessions", "#/sessions"], [d.project], [d.id.slice(0, 8)]])}${pageHead(`Session ${d.id.slice(0, 8)}`, { count: table ? d.turns.length : d.total, aside })}` +
    statusRow("", "", chips([d.project, ...(d.taskTypes ?? [])])) +
    renderKpis([{ k: "Turns", v: esc(count(d.total ?? d.turns.length)) }, { k: "Started", v: esc(when(d.turns[0]?.start) || "–") }]) +
    tabs("View", [["chat", "Chat"], ["table", "Table"], ["waterfall", "Waterfall"]], { [view]: pane }, view) + `</div>`;
}

// The toggle writes the hash; "Show all" uncuts a long message; "Next 20" puts the next turns in place of these.
function mountSession(root, d, query = new URLSearchParams()) {
  if (!d || d.error) return;
  const wf = isWaterfall(query);
  let loaded = [...d.turns], sel = null;
  const redrawWf = () => {
    const w = root.querySelector(".wf-wrap");
    if (w) w.innerHTML = wfBody(wfRows(loaded), sel);
  };
  const select = (id) => {
    sel = id;
    redrawWf();
    root.querySelector(".wf-row.sel")?.scrollIntoView?.({ block: "nearest" });
  };
  if (wf) root.onkeydown = (e) => {
    const row = e.target.closest?.(".wf-row");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(row.dataset.id); root.querySelector(".wf-row.sel")?.focus(); }
  };
  root.onclick = async (e) => {
    if (wf) {
      const a = e.target.closest?.("button[data-select]");
      if (a) return select(a.dataset.select);
      const row = e.target.closest?.(".wf-row");
      if (row) return select(row.dataset.id);
    }
    const seg = e.target.closest?.(".tabs > .seg button");
    if (seg) {
      goQuery({ view: seg.dataset.tab === "chat" ? "" : seg.dataset.tab });
      return;
    }
    const turn = e.target.closest?.("#turn-table button[data-page]");
    if (turn) {
      root.querySelector("#turn-table").innerHTML = turnTable(d, Number(turn.dataset.page));
      return;
    }
    const b = e.target.closest?.(".chat-pager button[data-page]");
    if (!b || isTable(query)) return;
    const pager = b.closest(".chat-pager");
    b.disabled = true;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(d.id)}/chat?from=${(Number(b.dataset.page) - 1) * CHAT_PAGE + 1}&limit=${CHAT_PAGE}`, { cache: "no-store" });
      const next = await res.json();
      if (!res.ok || next.error) throw new Error(next.error ?? res.statusText);
      if (wf) { loaded = next.turns; redrawWf(); } else root.querySelector(".chat").innerHTML = next.turns.map((t) => chatTurn(d.id, t)).join("");
      pager.outerHTML = chatPager(next.from, next.total);
    } catch (err) {
      b.disabled = false;
      say(pager.lastElementChild, err.message);
    }
  };
}

// One row per observation, children after their parent and indented by depth; input and output fold under the name.
function obsRows(o, depth) {
  const detail = [
    o.recall ? `candidates ${esc(count(o.recall.candidates))}, asked ${esc(count(o.recall.asked))}, kept ${esc(count(o.recall.kept))}` : "",
    o.verify ? `${esc(o.verify.kind ?? "")} ${esc(o.verify.verdict ?? "")}` : "",
    o.model ? esc(shortModel(o.model)) : "",
    o.error ? `Error: ${esc(o.error)}` : "",
  ].filter(Boolean).join("; ");
  const ioFold = (label, text) => (text ? fold(label, `<pre>${esc(text)}</pre>`) : "");
  return `<tr><td>${tag(o.kind, tone(o.error ? "failed" : o.kind))}</td>` +
    `<td class="wide" style="padding-left:calc(${depth} * var(--sp-14))"><strong>${esc(o.name)}</strong>${ioFold("Input", o.input)}${ioFold("Output", o.output)}</td>` +
    `<td>${detail}</td><td class="num">${esc(sdur(o.seconds))}</td></tr>` + o.children.map((c) => obsRows(c, depth + 1)).join("");
}

export function renderTurn(d) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const sid = encodeURIComponent(d.id);
  const nav = (n, label) => (n >= 1 && n <= d.total ? linkButton(label, href(`/sessions/${sid}/turns/${n}`)) : "");
  return `<div class="page dp-page">${crumb(`#/sessions/${sid}`, [["sessions", "#/sessions"], [d.id.slice(0, 8), `#/sessions/${sid}`], [`turn ${d.n}`]])}` +
    pageHead(`Turn ${d.n} of ${d.total}`, { aside: [nav(d.n - 1, "Previous"), nav(d.n + 1, "Next"), langfuse(d.base, d.traceId)].filter(Boolean).join(" ") }) +
    statusRow("", "", chips([d.project])) +
    renderKpis([{ k: "Started", v: esc(when(d.start)) }, { k: "Cost", v: costHtml(d.cost, d.wk) }, { k: "Took", v: esc(sdur(d.seconds)) }]) +
    (d.prompt ? detailPanel("Prompt", "", `<pre>${esc(d.prompt)}</pre>`) : "") + (d.output ? detailPanel("Output", "", `<pre>${esc(d.output)}</pre>`) : "") +
    detailPanel("Observations", count(d.observations.length), `<div id="obs-table">${obsTable(d)}</div>`) + `</div>`;
}

/** The observations of a turn: page `page` of the top-level ones with their children, and a pager. */
function obsTable(d, page = 1) {
  if (!d.observations.length) return empty();
  return dataTable(heads(["Kind", "Name", "Detail", "Took"], ["Took"]), pageRows(d.observations, page, TURN_PAGE).map((o) => obsRows(o, 0)).join("")) + pager(page, d.observations.length, TURN_PAGE);
}

// "Next 50" draws the next observations in place of these.
function mountTurn(root, d) {
  if (!d || d.error) return;
  root.onclick = (e) => {
    const turn = e.target.closest?.("#obs-table button[data-page]");
    if (turn) root.querySelector("#obs-table").innerHTML = obsTable(d, Number(turn.dataset.page));
  };
}

export const sessionView = { path: "/sessions/:id", title: "Session", group: "claude",
  api: (params, q = new URLSearchParams()) => `/api/sessions/${encodeURIComponent(params.id)}${isTable(q) ? "" : `/chat?limit=${CHAT_PAGE}`}`,
  render: renderSession, mount: mountSession };
export const turnView = { path: "/sessions/:id/turns/:n", title: "Turn", group: "claude", api: "/api/sessions/:id/turns/:n", render: renderTurn, mount: mountTurn };
export const views = [sessionView, turnView];
