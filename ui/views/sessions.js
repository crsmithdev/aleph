// Sessions, Session and Turn: the conversations Langfuse recorded. One module
// holds the three views; sessions-session.js and sessions-turn.js re-export
// the last two, because the page reads one `view` per file.
import { clock, empty, error, esc, money } from "../lib.js";

const day = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${clock(iso)}`;
};
const dur = (ms) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const down = (d) => `<div class="page">${error(`Langfuse is unreachable: ${d.error}`, "Check that Langfuse is running and LANGFUSE_* is set in ~/.aleph/.env, then reload.")}</div>`;
const langfuse = (base, traceId) => (base && traceId ? `<a href="${esc(base)}/trace/${esc(traceId)}">Open in Langfuse</a>` : "");
const href = (path) => `#${path}`;

export function renderSessions(d) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const rows = d.sessions.map((s) =>
    `<tr><td><a href="${esc(href(`/sessions/${encodeURIComponent(s.id)}`))}"><code>${esc(s.id.slice(0, 8))}</code></a></td>` +
    `<td>${esc(s.project)}</td><td>${esc(s.firstPrompt)}</td><td class="num">${s.turns}</td>` +
    `<td class="num">${esc(day(s.start))}</td><td class="num">${esc(day(s.last))}</td><td class="num">${esc(money(s.cost))}</td>` +
    `<td>${s.taskTypes.map((t) => `<span class="badge">${esc(t)}</span>`).join(" ")}</td></tr>`).join("");
  return `<div class="page"><h1>Sessions</h1>` + (rows
    ? `<div class="list"><div class="tscroll" style="overflow-x:auto;max-width:100%"><table class="tbl"><thead><tr><th>Session</th><th>Project</th><th>First prompt</th><th>Turns</th><th>Started</th><th>Last</th><th>Cost</th><th>Kinds</th></tr></thead><tbody>${rows}</tbody></table></div></div>`
    : empty("No session in the last 7 days.", "Sessions appear when the hooks send traces to Langfuse.")) + `</div>`;
}

export function renderSession(d) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const rows = d.turns.map((t) =>
    `<tr><td class="num"><a href="${esc(href(`/sessions/${encodeURIComponent(d.id)}/turns/${t.n}`))}">${t.n}</a></td>` +
    `<td>${esc(t.prompt)}</td><td>${esc(t.output)}</td><td class="num">${t.tools}</td>` +
    `<td class="num">${esc(dur(t.durationMs))}</td><td class="num">${esc(money(t.cost))}</td><td>${esc(t.model ?? "")}</td></tr>`).join("");
  return `<div class="page"><p><a href="#/sessions">Sessions</a></p><h1>${esc(d.project)} <code>${esc(d.id.slice(0, 8))}</code></h1>` +
    `<p>${d.taskTypes.map((t) => `<span class="badge">${esc(t)}</span>`).join(" ")}</p>` +
    `<div class="tscroll" style="overflow-x:auto;max-width:100%"><table class="tbl"><thead><tr><th>Turn</th><th>Prompt</th><th>Output</th><th>Tools</th><th>Duration</th><th>Cost</th><th>Model</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    `<p>${langfuse(d.base, d.turns[0]?.traceId)}</p></div>`;
}

function node(o) {
  const detail = [
    o.recall ? `candidates ${esc(o.recall.candidates ?? "?")}, asked ${esc(o.recall.asked ?? "?")}, kept ${esc(o.recall.kept ?? "?")}` : "",
    o.verify ? `${esc(o.verify.kind ?? "")} ${esc(o.verify.verdict ?? "")}` : "",
    o.model ? esc(o.model) : "",
  ].filter(Boolean).join("; ");
  return `<li><span class="badge${o.error ? " stuck" : ""}">${esc(o.kind)}</span> <strong>${esc(o.name)}</strong> <span class="num">${esc(dur(o.durationMs))}</span>` +
    (detail ? ` <small>${detail}</small>` : "") +
    (o.error ? ` <span class="quiet">Error: ${esc(o.error)}</span>` : "") +
    (o.input ? `<details><summary>Input</summary><pre>${esc(o.input)}</pre></details>` : "") +
    (o.output ? `<details><summary>Output</summary><pre>${esc(o.output)}</pre></details>` : "") +
    (o.children.length ? `<ul>${o.children.map(node).join("")}</ul>` : "") + `</li>`;
}

export function renderTurn(d) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const sid = encodeURIComponent(d.id);
  const nav = (n, label) => (n >= 1 && n <= d.total ? `<a href="${esc(href(`/sessions/${sid}/turns/${n}`))}">${label}</a>` : "");
  return `<div class="page"><p><a href="#/sessions">Sessions</a> / <a href="${esc(href(`/sessions/${sid}`))}">${esc(d.id.slice(0, 8))}</a></p>` +
    `<h1>Turn ${d.n} of ${d.total}</h1><p>${nav(d.n - 1, "Previous")} ${nav(d.n + 1, "Next")} ${langfuse(d.base, d.traceId)}</p>` +
    `<dl class="facts"><div><dt>Cost</dt><dd>${esc(money(d.cost))}</dd></div><div><dt>Duration</dt><dd>${esc(dur(d.durationMs))}</dd></div></dl>` +
    `<h2>Prompt</h2><pre>${esc(d.prompt)}</pre><h2>Output</h2><pre>${esc(d.output)}</pre><h2>Observations</h2>` +
    (d.observations.length ? `<ul class="tree">${d.observations.map(node).join("")}</ul>` : empty("No observation in this turn.")) + `</div>`;
}

export const view = { path: "/sessions", title: "Sessions", group: "claude", order: 0, api: "/api/sessions", refresh: 60, render: renderSessions };
export const sessionView = { path: "/sessions/:id", title: "Session", group: "claude", order: 0, api: "/api/sessions/:id", render: renderSession };
export const turnView = { path: "/sessions/:id/turns/:n", title: "Turn", group: "claude", order: 0, api: "/api/sessions/:id/turns/:n", render: renderTurn };
