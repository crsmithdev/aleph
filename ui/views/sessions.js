// Sessions, Session and Turn: the conversations Langfuse recorded. One module
// holds the three views; sessions-session.js and sessions-turn.js re-export
// the last two, because the page reads one `view` per file.
import { costHtml, chips, empty, error, esc, filterBar, idLink, md, pageHead, pager, shortModel, systemParts, when } from "../lib.js";

const dur = (ms) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const down = (d) => `<div class="page">${error(`Langfuse is unreachable: ${d.error}`, "Check that Langfuse is running and LANGFUSE_* is set in ~/.aleph/.env, then reload.")}</div>`;
const langfuse = (base, traceId) => (base && traceId ? `<a href="${esc(base)}/trace/${esc(traceId)}">Open in Langfuse</a>` : "");
const line = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
const href = (path) => `#${path}`;

// The search text and page size live here, so the 60 s refresh keeps them; Project and Window live in the hash.
const state = { q: "", shown: 50 };

const visible = (d) => {
  const q = state.q.trim().toLowerCase();
  return d.sessions.filter((s) => !q || (s.firstPrompt ?? "").toLowerCase().includes(q));
};

const DAYS = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];
const windowOf = (query) => (DAYS.some((o) => o.value === query?.get("days")) ? query.get("days") : "7");

/** The session's id link: the job name when it is a factory session, else the id's first 8 characters; the title is the full id. */
const sessionLink = (s) =>
  idLink(s.label ?? s.id.slice(0, 8), href(`/sessions/${encodeURIComponent(s.id)}`)).replace('<a class="idl"', `<a class="idl" title="${esc(s.id)}"`);

function sessionsBody(d, days) {
  const all = visible(d);
  if (!all.length) return empty(d.sessions.length ? "No session matches." : `No session in the last ${days} days.`, d.sessions.length ? "Clear the search." : "Sessions appear when the hooks send traces to Langfuse.");
  // Columns: id, title (the first prompt), project, labels (kinds), numbers, times last.
  const rows = all.slice(0, state.shown).map((s) =>
    `<tr><td>${sessionLink(s)}</td>` +
    `<td class="wide" title="${esc(s.firstPrompt)}">${esc(s.firstPrompt)}</td><td>${esc(s.project)}</td>` +
    `<td>${chips(s.taskTypes)}</td><td class="num">${s.turns}</td><td class="num">${costHtml(s.cost, s.wk)}</td>` +
    `<td class="time">${esc(when(s.start))}</td><td class="time">${esc(when(s.last))}</td></tr>`).join("");
  return `<div class="tscroll"><table class="tbl"><thead><tr><th>Session</th><th>First prompt</th><th>Project</th><th>Kinds</th><th class="num">Turns</th><th class="num">Cost</th><th>Started</th><th>Last</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    pager(state.shown, all.length);
}

export function renderSessions(d, _params, query = new URLSearchParams()) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const projects = [...new Set([...(d.projects ?? []), ...d.sessions.map((s) => s.project).filter(Boolean)])].sort();
  const days = windowOf(query);
  return `<div class="page">${pageHead("Sessions", { count: visible(d).length })}` +
    filterBar([
      { label: "Project", name: "project", options: [{ value: "", label: "All" }, ...projects], value: projects.includes(query?.get("project")) ? query.get("project") : "" },
      { label: "Window", name: "days", options: DAYS, value: days },
      { label: "Search", name: "q", search: true, value: state.q, placeholder: "First prompt" },
    ]) + `<div class="sess-body">${sessionsBody(d, days)}</div></div>`;
}

// Project and Window write the hash; the search and "Show more" redraw the table and count in place, so the search box keeps its focus.
export function mountSessions(root, d, query = new URLSearchParams()) {
  if (!d || d.error) return;
  const body = root.querySelector(".sess-body");
  if (!body) return;
  const days = windowOf(query);
  const redraw = () => {
    body.innerHTML = sessionsBody(d, days);
    const c = root.querySelector(".ph .count");
    if (c) c.textContent = String(visible(d).length);
  };
  const go = (name, value) => {
    const q = new URLSearchParams();
    for (const k of ["days", "project"]) if (query.get(k)) q.set(k, query.get(k));
    if (value) q.set(name, value); else q.delete(name);
    location.hash = `#/sessions${q.toString() ? `?${q}` : ""}`;
  };
  root.querySelector('.fbar input[name="q"]')?.addEventListener("input", (e) => { state.q = e.target.value; state.shown = 50; redraw(); });
  root.onchange = (e) => { if (e.target.matches?.(".fbar select")) go(e.target.name, e.target.value); };
  root.onclick = (e) => {
    const seg = e.target.closest?.(".fbar .seg button");
    if (seg) return go(seg.parentElement.dataset.name, seg.dataset.value);
    const b = e.target.closest?.("button[data-more]");
    if (!b) return;
    state.shown += Number(b.dataset.more);
    redraw();
  };
}

/** The turn table: the session page's `?view=table`. */
function turnTable(d) {
  // Columns: turn (id), prompt (title), output, model, numbers, time last.
  const rows = d.turns.map((t) =>
    `<tr><td class="num"><a href="${esc(href(`/sessions/${encodeURIComponent(d.id)}/turns/${t.n}`))}">${t.n}</a></td>` +
    `<td class="wide" title="${esc(t.prompt)}">${esc(t.prompt)}</td><td>${esc(line(t.output))}</td><td>${esc(shortModel(t.model))}</td><td class="num">${t.tools}</td>` +
    `<td class="num">${esc(dur(t.durationMs))}</td><td class="num">${costHtml(t.cost, t.wk)}</td><td class="time">${esc(when(t.start))}</td></tr>`).join("");
  return `<div class="tscroll"><table class="tbl"><thead><tr><th class="num">Turn</th><th>Prompt</th><th>Output</th><th>Model</th><th class="num">Tools</th><th class="num">Duration</th><th class="num">Cost</th><th>Started</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export const CHAT_PAGE = 20;
const CLIP_LINES = 20, CLIP_CHARS = 1600, TOOLS_SHOWN = 5, TOOLS_FOLD = 12;

/** Long text shows its first lines under a fade, and a "Show all" button the mount wires. */
const clip = (text, html) => {
  const long = text.length > CLIP_CHARS || text.split("\n").length > CLIP_LINES;
  return long ? `<div class="clip cut">${html}</div><button type="button" class="unclip">Show all</button>` : html;
};

/** A system part as a one-line chip: the tag, and its summary or first line; it opens to the whole text. */
function sysChip({ tag, body }) {
  const peek = (body.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 100);
  return `<details class="sysc"><summary><span class="chip">${esc(tag)}</span><span class="peek">${esc(peek)}</span></summary><pre>${esc(body)}</pre></details>`;
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
  const fold = early.length
    ? `<details class="tools-early"><summary>${early.length} earlier tool calls${errs ? ` <span class="terr">${errs} failed</span>` : ""}</summary>${early.map(toolLine).join("")}</details>`
    : "";
  return `<div class="tools">${fold}${late.map(toolLine).join("")}</div>`;
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
    toolList(t.tools) +
    (out ? `<div class="msg reply md">${clip(out, md(out))}</div>` : `<p class="msg reply quiet">No reply recorded.</p>`) + `</section>`;
}

/** Under the chat: "20 of 73" and "Show 20 more", which fetches the next turns. */
const chatPager = (shown, total) => {
  const more = Math.min(CHAT_PAGE, total - shown);
  return `<div class="pager chat-pager">${more > 0 ? `<button type="button" data-chat-from="${shown + 1}">Show ${more} more</button>` : ""}<span class="of">${shown} of ${total}</span></div>`;
};

const chatBody = (d) => `<div class="chat">${d.turns.map((t) => chatTurn(d.id, t)).join("")}</div>${chatPager(d.from - 1 + d.turns.length, d.total)}`;

const isTable = (query) => query?.get?.("view") === "table";

export function renderSession(d, _params, query = new URLSearchParams()) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const table = isTable(query);
  const aside = [sessionLink(d), langfuse(d.base, d.turns[0]?.traceId)].filter(Boolean).join(" ");
  return `<div class="page"><p class="quiet"><a href="#/sessions">← Sessions</a></p>${pageHead(d.project, { count: table ? d.turns.length : d.total, aside })}` +
    `${d.taskTypes?.length ? `<p>${chips(d.taskTypes)}</p>` : ""}` +
    filterBar([{ label: "", name: "view", options: [{ value: "chat", label: "Chat" }, { value: "table", label: "Table" }], value: table ? "table" : "chat" }]) +
    (table ? turnTable(d) : chatBody(d)) + `</div>`;
}

// The toggle writes the hash; "Show all" uncuts a long message; "Show 20 more" appends the next turns in place.
export function mountSession(root, d, query = new URLSearchParams()) {
  if (!d || d.error) return;
  root.onclick = async (e) => {
    const seg = e.target.closest?.(".fbar .seg button");
    if (seg) {
      location.hash = `#/sessions/${encodeURIComponent(d.id)}${seg.dataset.value === "table" ? "?view=table" : ""}`;
      return;
    }
    const un = e.target.closest?.("button.unclip");
    if (un) {
      const cut = un.previousElementSibling?.classList.toggle("cut");
      un.textContent = cut ? "Show all" : "Show less";
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
      root.querySelector(".chat").insertAdjacentHTML("beforeend", next.turns.map((t) => chatTurn(d.id, t)).join(""));
      pager.outerHTML = chatPager(next.from - 1 + next.turns.length, next.total);
    } catch (err) {
      b.disabled = false;
      pager.insertAdjacentHTML("beforeend", `<span class="act-msg" role="alert">${esc(err.message)}</span>`);
    }
  };
}

// One row per observation, children after their parent and indented by depth; input and output fold under the name.
function obsRows(o, depth) {
  const detail = [
    o.recall ? `candidates ${esc(o.recall.candidates ?? "?")}, asked ${esc(o.recall.asked ?? "?")}, kept ${esc(o.recall.kept ?? "?")}` : "",
    o.verify ? `${esc(o.verify.kind ?? "")} ${esc(o.verify.verdict ?? "")}` : "",
    o.model ? esc(shortModel(o.model)) : "",
    o.error ? `Error: ${esc(o.error)}` : "",
  ].filter(Boolean).join("; ");
  const fold = (label, text) => (text ? `<details><summary>${label}</summary><pre>${esc(text)}</pre></details>` : "");
  return `<tr><td><span class="badge ${o.error ? "stuck" : "quiet"}">${esc(o.kind)}</span></td>` +
    `<td style="padding-left:${depth * 16}px"><strong>${esc(o.name)}</strong>${fold("Input", o.input)}${fold("Output", o.output)}</td>` +
    `<td>${detail}</td><td class="num">${esc(dur(o.durationMs))}</td></tr>` + o.children.map((c) => obsRows(c, depth + 1)).join("");
}

export function renderTurn(d) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const sid = encodeURIComponent(d.id);
  const nav = (n, label) => (n >= 1 && n <= d.total ? `<a href="${esc(href(`/sessions/${sid}/turns/${n}`))}">${label}</a>` : "");
  return `<div class="page"><p class="quiet"><a href="#/sessions">← Sessions</a> / ${sessionLink(d)}</p>` +
    pageHead(`Turn ${d.n} of ${d.total}`, { aside: [nav(d.n - 1, "Previous"), nav(d.n + 1, "Next"), langfuse(d.base, d.traceId)].filter(Boolean).join(" ") }) +
    `<dl class="facts"><div><dt>Started</dt><dd>${esc(when(d.start))}</dd></div><div><dt>Cost</dt><dd>${costHtml(d.cost, d.wk)}</dd></div><div><dt>Duration</dt><dd>${esc(dur(d.durationMs))}</dd></div></dl>` +
    `<h2>Prompt</h2><pre>${esc(d.prompt)}</pre><h2>Output</h2><pre>${esc(d.output)}</pre><h2>Observations</h2>` +
    (d.observations.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Kind</th><th>Name</th><th>Detail</th><th class="num">Duration</th></tr></thead><tbody>${d.observations.map((o) => obsRows(o, 0)).join("")}</tbody></table></div>` : empty("No observation in this turn.")) + `</div>`;
}

export const view = { path: "/sessions", title: "Sessions", group: "claude", order: 0, api: (_params, q = new URLSearchParams()) => {
    const out = new URLSearchParams();
    for (const k of ["days", "project"]) if (q.get(k)) out.set(k, q.get(k));
    return out.toString() ? `/api/sessions?${out}` : "/api/sessions";
  }, refresh: 60, render: renderSessions, mount: mountSessions };
export const sessionView = { path: "/sessions/:id", title: "Session", group: "claude", order: 0,
  api: (params, q = new URLSearchParams()) => `/api/sessions/${encodeURIComponent(params.id)}${isTable(q) ? "" : `/chat?limit=${CHAT_PAGE}`}`,
  render: renderSession, mount: mountSession };
export const turnView = { path: "/sessions/:id/turns/:n", title: "Turn", group: "claude", order: 0, api: "/api/sessions/:id/turns/:n", render: renderTurn };
