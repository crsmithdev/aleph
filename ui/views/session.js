// Session and Turn: the conversations Langfuse recorded. One module holds the two
// views; sessions-session.js and sessions-turn.js re-export them, because the page
// reads one `view` per file. The list of sessions is in sessions.js.
import { clamp, say, facts, chip, chips, costHtml, crumb, dataTable, durMs as dur, empty, error, esc, filterBar, heads, idLink, md, pager, pageHead, sectionHead, shortModel, tag, when } from "../lib.js";
import { systemParts } from "../system-parts.js";

const down = (d) => `<div class="page">${error(`Langfuse is unreachable: ${d.error}`, "Check that Langfuse is running and LANGFUSE_* is set in ~/.aleph/.env, then reload.")}</div>`;
const langfuse = (base, traceId) => (base && traceId ? `<a href="${esc(base)}/trace/${esc(traceId)}">Open in Langfuse</a>` : "");
const line = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
const href = (path) => `#${path}`;

/** The session's id link: the job name when it is a factory session, else the id's first 8 characters; the title is the full id. */
const sessionLink = (s) =>
  idLink(s.label ?? s.id.slice(0, 8), href(`/sessions/${encodeURIComponent(s.id)}`), { title: s.id });

/** The turn table: the session page's `?view=table`. */
const TURN_PAGE = 50;
function turnTable(d, limit = TURN_PAGE) {
  if (!d.turns.length) return empty("No turn in this session.");
  // Columns: time, turn (id), prompt (title), output, model, numbers.
  const rows = d.turns.slice(0, limit).map((t) =>
    `<tr><td class="time">${esc(when(t.start))}</td><td class="num"><a href="${esc(href(`/sessions/${encodeURIComponent(d.id)}/turns/${t.n}`))}">${t.n}</a></td>` +
    `<td class="wide" title="${esc(t.prompt)}">${esc(t.prompt)}</td><td>${esc(line(t.output))}</td><td>${esc(shortModel(t.model))}</td><td class="num">${t.tools}</td>` +
    `<td class="num">${esc(dur(t.durationMs))}</td><td class="num">${costHtml(t.cost, t.wk)}</td></tr>`).join("");
  return dataTable(heads(["Started", "Turn", "Prompt", "Output", "Model", "Tools", "Took", "Cost"], ["Turn", "Tools", "Took", "Cost"]), rows) + pager(limit, d.turns.length, TURN_PAGE);
}

export const CHAT_PAGE = 20;
const CLIP_LINES = 20, CLIP_CHARS = 1600, TOOLS_SHOWN = 5, TOOLS_FOLD = 12;
const INDENT_STEP = 14;

/** Long text shows its first lines under a fade, with the clamp button. */
const clip = (text, html) => (text.length > CLIP_CHARS || text.split("\n").length > CLIP_LINES ? clamp(html) : html);

/** A system part as a one-line chip: the tag, and its summary or first line; it opens to the whole text. */
function sysChip({ tag, body }) {
  const peek = (body.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 100);
  return `<details class="sysc"><summary>${chip(tag)}<span class="peek">${esc(peek)}</span></summary><pre>${esc(body)}</pre></details>`;
}

/** A tool call on one line: name, key argument, error mark, duration; it opens to input and output. */
function toolLine(c) {
  const io = (label, text) => (text ? `<h4>${label}</h4><pre>${esc(text)}</pre>` : "");
  return `<details class="tool${c.error ? " err" : ""}"><summary><span class="tn">${esc(c.name)}</span>` +
    `${c.args ? `<code class="ta">${esc(c.args)}</code>` : ""}${c.error ? `<span class="terr">Error</span>` : ""}` +
    `<span class="td">${esc(dur(c.durationMs))}</span></summary>` +
    `<div class="tio">${io("Input", c.input)}${c.error ? io("Error", c.error) : ""}${io("Output", c.output)}</div>` +
    `${c.children?.length ? `<div class="tools sub">${c.children.map(toolLine).join("")}</div>` : ""}</details>`;
}

function toolList(tools) {
  if (!tools?.length) return "";
  const early = tools.length > TOOLS_FOLD ? tools.slice(0, tools.length - TOOLS_SHOWN) : [];
  const late = tools.slice(early.length);
  const errs = early.filter((c) => c.error).length;
  const earlyTools = early.length
    ? `<details class="tools-early"><summary>${early.length} earlier tool calls${errs ? ` <span class="terr">${errs} failed</span>` : ""}</summary>${early.map(toolLine).join("")}</details>`
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
  const meta = [`<a href="${esc(href(`/sessions/${encodeURIComponent(id)}/turns/${t.n}`))}">Turn ${t.n}</a>`,
    esc(shortModel(t.model)), esc(dur(t.durationMs)), costHtml(t.cost, t.wk), `<span class="time">${esc(when(t.start))}</span>`].filter(Boolean).join('<span class="dot">·</span>');
  const out = String(t.output ?? "").trim();
  return `<section class="turn" id="turn-${t.n}"><p class="tline">${meta}</p>` +
    (system.length ? `<div class="sys">${system.map(sysChip).join("")}</div>` : "") +
    (text ? `<div class="msg user md">${clip(text, md(text))}</div>` : "") +
    work(t) +
    (out ? `<div class="msg reply md">${clip(out, md(out))}</div>` : empty("No reply recorded.")) + `</section>`;
}

/** Under the chat: "20 of 73" and "Show 20 more", which fetches the next turns. */
const chatPager = (shown, total) => {
  return pager(shown, total, CHAT_PAGE, { cls: "chat-pager", attr: "data-chat-from", value: (_, n) => n + 1 });
};

const chatBody = (d) => `<div class="chat">${d.turns.map((t) => chatTurn(d.id, t)).join("")}</div>${chatPager(d.from - 1 + d.turns.length, d.total)}`;

const isTable = (query) => query?.get?.("view") === "table";
const isWaterfall = (query) => query?.get?.("view") === "waterfall";

// ---- Waterfall: one row per turn, tool call and subagent on a shared time axis ----

/** The waterfall's rows in draw order: each turn, then its calls nested by parent. */
export function wfRows(turns) {
  const rows = [];
  const add = (c, depth, turn) => {
    const gen = c.kind === "generation";
    rows.push({ id: c.id, depth, kind: c.kind, name: gen ? c.model || c.name : c.name, args: c.args, start: c.start, startMs: c.startMs, endMs: c.endMs, error: c.error, input: c.input, output: c.output, durationMs: c.durationMs, turn,
      ...(gen ? { model: c.model, cost: c.cost, inputTokens: c.inputTokens, outputTokens: c.outputTokens } : {}) });
    for (const k of kids(c.id, c.children)) add(k, depth + 1, turn);
  };
  let gens = [];
  // A parent's tool rows and generations in time order.
  const kids = (parent, tools = []) => [...tools, ...gens.filter((g) => g.parent === parent)].sort((a, b) => a.startMs - b.startMs);
  for (const t of turns) {
        const lastEnd = (cs) => cs.reduce((m, c) => Math.max(m, c.endMs, lastEnd(c.children ?? [])), 0);
    rows.push({ id: `turn-${t.n}`, depth: 0, kind: "turn", name: `Turn ${t.n}`, args: line(systemParts(t.prompt).text), start: t.start, startMs: t.startMs, endMs: Math.max(t.endMs, lastEnd([...(t.tools ?? []), ...(t.generations ?? [])])),
      error: null, input: t.prompt, output: t.output, durationMs: t.durationMs, model: t.model, cost: t.cost, wk: t.wk, turn: t.n });
    gens = t.generations ?? [];
    for (const c of kids(null, t.tools ?? [])) add(c, 1, t.n);
  }
  return rows;
}

const axisTick = (ms) => (ms <= 0 ? "0s" : dur(Math.round(ms)));

/** Wall time, summed tool time, the 3 longest calls (links that select their row) and the error count. */
export function wfSummary(rows) {
  const calls = rows.filter((r) => r.kind !== "turn");
  const wall = rows.reduce((m, r) => Math.max(m, r.endMs), 0);
  const toolMs = calls.filter((r) => r.kind === "tool").reduce((n, r) => n + (r.durationMs ?? 0), 0);
  const modelMs = calls.filter((r) => r.kind === "generation").reduce((n, r) => n + (r.durationMs ?? 0), 0);
  const longest = calls.filter((r) => r.kind !== "generation").sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0)).slice(0, 3).filter((r) => r.durationMs);
  const errors = calls.filter((r) => r.error).length;
  return `<p class="wf-sum">Wall time <strong>${esc(dur(Math.round(wall)) || "0ms")}</strong><span class="dot">·</span>Tool time <strong>${esc(dur(Math.round(toolMs)) || "0ms")}</strong>` +
    `<span class="dot">·</span>Model time <strong>${esc(dur(Math.round(modelMs)) || "0ms")}</strong><span class="dot">·</span>Longest ${longest.length ? longest.map((r) => `<a href="#" data-select="${esc(r.id)}">${esc(r.name)}${r.args ? `(${esc(r.args.slice(0, 30))})` : ""} ${esc(dur(r.durationMs))}</a>`).join(", ") : "none"}` +
    `<span class="dot">·</span>${errors ? `<strong class="terr">${errors} error${errors === 1 ? "" : "s"}</strong>` : "No errors"}</p>`;
}

function wfRow(r, max, sel) {
  const left = (r.startMs / max) * 100;
  const width = Math.max(0.2, ((r.endMs - r.startMs) / max) * 100);
  const label = r.kind === "turn" ? `<span class="tn">${esc(r.name)}</span>${r.args ? `<span class="ta">${esc(r.args)}</span>` : ""}` : `<span class="tn">${esc(r.name)}</span>${r.args ? `<code class="ta">${esc(r.args)}</code>` : ""}`;
  return `<div class="wf-row k-${r.kind}${r.error ? " err" : ""}${r.id === sel ? " sel" : ""}" role="row" tabindex="0" data-id="${esc(r.id)}" aria-selected="${r.id === sel}">` +
    `<div class="wf-l" style="padding-left:${r.depth * INDENT_STEP}px" title="${esc(r.name + " " + (r.args ?? ""))}">${label}</div>` +
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
  if (!r) return `<p class="quiet">Select a row to see its input and output.</p>`;
  const io = (label, text) => (text ? `<h4>${label}</h4>${clip(text, `<pre>${esc(text)}</pre>`)}` : "");
  return `<h3>${esc(r.name)}${r.args && r.kind !== "turn" ? ` <code>${esc(r.args)}</code>` : ""}</h3>` +
    facts([["Kind", esc(r.kind)], ["Start", `${esc(when(r.start))} (+${esc(axisTick(r.startMs))})`], ["Duration", esc(dur(r.durationMs))],
      ["Model", r.model ? esc(shortModel(r.model)) : ""], ["Cost", r.cost ? costHtml(r.cost, r.wk) : ""],
      ["Tokens", r.inputTokens != null || r.outputTokens != null ? `${esc(r.inputTokens ?? "–")} in, ${esc(r.outputTokens ?? "–")} out` : ""]]) +
    io("Input", r.input) + (r.error ? io("Error", r.error) : "") + io("Output", r.output);
}

const wfBody = (rows, sel) => `<div class="wf"><div class="wf-main">${waterfall(rows, sel)}</div><aside class="wf-detail" aria-label="Detail">${wfDetail(rows.find((r) => r.id === sel))}</aside></div>`;

export function renderSession(d, _params, query = new URLSearchParams()) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const table = isTable(query), wf = isWaterfall(query);
  const aside = [sessionLink(d), langfuse(d.base, d.turns[0]?.traceId)].filter(Boolean).join(" ");
  return `<div class="page">${crumb("#/sessions", [["sessions", "#/sessions"], [d.project], [d.id.slice(0, 8)]])}${pageHead(`Session ${d.id.slice(0, 8)}`, { count: table ? d.turns.length : d.total, aside })}` +
    `${d.taskTypes?.length ? `<p>${chips(d.taskTypes)}</p>` : ""}` +
    filterBar([{ label: "View", bare: true, name: "view", options: [{ value: "chat", label: "Chat" }, { value: "table", label: "Table" }, { value: "waterfall", label: "Waterfall" }], value: table ? "table" : wf ? "waterfall" : "chat" }]) +
    (table ? `<div id="turn-table">${turnTable(d)}</div>` : wf ? `<div class="wf-wrap">${wfBody(wfRows(d.turns), null)}</div>${chatPager(d.from - 1 + d.turns.length, d.total)}` : chatBody(d)) + `</div>`;
}

// The toggle writes the hash; "Show all" uncuts a long message; "Show 20 more" appends the next turns in place.
export function mountSession(root, d, query = new URLSearchParams()) {
  if (!d || d.error) return;
  const wf = isWaterfall(query);
  let loaded = [...d.turns], sel = null, turns = TURN_PAGE;
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
      const a = e.target.closest?.("a[data-select]");
      if (a) { e.preventDefault(); return select(a.dataset.select); }
      const row = e.target.closest?.(".wf-row");
      if (row) return select(row.dataset.id);
    }
    const seg = e.target.closest?.(".fbar .seg button");
    if (seg) {
      location.hash = `#/sessions/${encodeURIComponent(d.id)}${seg.dataset.value === "chat" ? "" : `?view=${seg.dataset.value}`}`;
      return;
    }
    const more = e.target.closest?.("#turn-table button[data-more]");
    if (more) {
      turns += Number(more.dataset.more);
      root.querySelector("#turn-table").innerHTML = turnTable(d, turns);
      return;
    }
    const b = e.target.closest?.("button[data-chat-from]");
    if (!b || isTable(query)) return;
    const pager = b.closest(".chat-pager");
    b.disabled = true;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(d.id)}/chat?from=${b.dataset.chatFrom}&limit=${CHAT_PAGE}`, { cache: "no-store" });
      const next = await res.json();
      if (!res.ok || next.error) throw new Error(next.error ?? res.statusText);
      if (wf) { loaded = [...loaded, ...next.turns]; redrawWf(); } else root.querySelector(".chat").insertAdjacentHTML("beforeend", next.turns.map((t) => chatTurn(d.id, t)).join(""));
      pager.outerHTML = chatPager(next.from - 1 + next.turns.length, next.total);
    } catch (err) {
      b.disabled = false;
      say(pager.lastElementChild, err.message);
    }
  };
}

// One row per observation, children after their parent and indented by depth; input and output fold under the name.
function obsRows(o, depth) {
  const detail = [
    o.recall ? `candidates ${esc(o.recall.candidates ?? "–")}, asked ${esc(o.recall.asked ?? "–")}, kept ${esc(o.recall.kept ?? "–")}` : "",
    o.verify ? `${esc(o.verify.kind ?? "")} ${esc(o.verify.verdict ?? "")}` : "",
    o.model ? esc(shortModel(o.model)) : "",
    o.error ? `Error: ${esc(o.error)}` : "",
  ].filter(Boolean).join("; ");
  const ioFold = (label, text) => (text ? `<details><summary>${label}</summary><pre>${esc(text)}</pre></details>` : "");
  return `<tr><td>${tag(o.kind, o.error ? "stuck" : "quiet")}</td>` +
    `<td style="padding-left:${depth * INDENT_STEP}px"><strong>${esc(o.name)}</strong>${ioFold("Input", o.input)}${ioFold("Output", o.output)}</td>` +
    `<td class="wide">${detail}</td><td class="num">${esc(dur(o.durationMs))}</td></tr>` + o.children.map((c) => obsRows(c, depth + 1)).join("");
}

export function renderTurn(d) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const sid = encodeURIComponent(d.id);
  const nav = (n, label) => (n >= 1 && n <= d.total ? `<a href="${esc(href(`/sessions/${sid}/turns/${n}`))}">${label}</a>` : "");
  return `<div class="page">${crumb(`#/sessions/${sid}`, [["sessions", "#/sessions"], [d.id.slice(0, 8), `#/sessions/${sid}`], [`turn ${d.n}`]])}` +
    pageHead(`Turn ${d.n} of ${d.total}`, { aside: [nav(d.n - 1, "Previous"), nav(d.n + 1, "Next"), langfuse(d.base, d.traceId)].filter(Boolean).join(" ") }) +
    facts([["Started", esc(when(d.start))], ["Cost", costHtml(d.cost, d.wk)], ["Duration", esc(dur(d.durationMs))]]) +
    `${sectionHead("Prompt")}<pre>${esc(d.prompt)}</pre>${sectionHead("Output")}<pre>${esc(d.output)}</pre>${sectionHead("Observations")}` +
    `<div id="obs-table">${obsTable(d)}</div></div>`;
}

/** The observations of a turn: `limit` top-level ones with their children, and a pager. */
function obsTable(d, limit = TURN_PAGE) {
  if (!d.observations.length) return empty("No observation in this turn.");
  return dataTable(heads(["Kind", "Name", "Detail", "Took"], ["Took"]), d.observations.slice(0, limit).map((o) => obsRows(o, 0)).join("")) + pager(limit, d.observations.length, TURN_PAGE);
}

// "Show 50 more" draws the next observations in place.
function mountTurn(root, d) {
  if (!d || d.error) return;
  let shown = TURN_PAGE;
  root.onclick = (e) => {
    const more = e.target.closest?.("#obs-table button[data-more]");
    if (!more) return;
    shown += Number(more.dataset.more);
    root.querySelector("#obs-table").innerHTML = obsTable(d, shown);
  };
}

export const sessionView = { path: "/sessions/:id", title: "Session", group: "claude", order: 0,
  api: (params, q = new URLSearchParams()) => `/api/sessions/${encodeURIComponent(params.id)}${isTable(q) ? "" : `/chat?limit=${CHAT_PAGE}`}`,
  render: renderSession, mount: mountSession };
export const turnView = { path: "/sessions/:id/turns/:n", title: "Turn", group: "claude", order: 0, api: "/api/sessions/:id/turns/:n", render: renderTurn, mount: mountTurn };
