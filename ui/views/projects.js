// The project card and detail renderers, shared by views/project.js. The list of
// projects is part of views/contents.js.
import { badge, chips, empty, esc, idLink, pageHead, when } from "../lib.js";

const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function renderBaseline(p) {
  if (!p.factory) return "";
  if (!p.baseline) return fact("Baseline", "not checked yet");
  const b = p.baseline;
  return fact("Baseline", `<span class="badge ${b.ok ? "done" : "stuck"}">${b.ok ? "Green" : "Red"}</span> <code>${esc(b.commit.slice(0, 7))}</code>${b.ok ? "" : ` ${esc(b.failed ?? "")}`}`);
}

export function renderFacts(p) {
  return `<dl class="facts">` +
    fact("Open issues", String(p.openItems)) +
    fact("Last landed", p.lastLanded ? `<code>${esc(p.lastLanded.name)}</code> ${esc(when(p.lastLanded.at))}` : "none yet") +
    fact("Behind origin", p.behind === null ? "unknown" : p.behind === 0 ? "up to date" : plural(p.behind, "commit")) +
    renderBaseline(p) + fact("Vault notes", String(p.notes)) + `</dl>`;
}

export function renderCard(p) {
  return `<article class="del project"><div class="ih"><span class="id">${esc(p.key)}</span>` +
    `<h3><a href="#/projects/${encodeURIComponent(p.key)}">${esc(p.key)}</a></h3>` +
    `<span class="badge ${p.factory ? "run" : "done"}">${p.factory ? "Factory" : "Plain repo"}</span></div>` +
    `<p class="quiet q"><code>${esc(p.path)}</code></p>${renderFacts(p)}</article>`;
}

export function renderDetail(p) {
  const sec = (title, n, body) => `<div class="sh"><h2>${esc(title)}</h2><span class="count">${n}</span></div>${body}`;
  const table = (heads, rows) => `<div class="tscroll"><table class="tbl"><thead><tr>${heads.map(([h, c]) => `<th${c ? ` class="${c}"` : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  const commits = p.commits.map((c) => {
    const sha = c.hash.slice(0, 7);
    return `<tr><td>${c.commitUrl ? idLink(sha, c.commitUrl) : `<code>${esc(sha)}</code>`}</td><td class="wide" title="${esc(c.subject)}">${esc(c.subject)}</td>` +
      `<td>${c.item ? esc(c.item) : ""}</td><td class="time">${esc(when(c.date))}</td></tr>`;
  });
  const items = p.items.map((i) => `<tr><td>${idLink(`${p.key}-${i.id}`, `#/issues/${encodeURIComponent(p.key)}/${i.id}`)}</td><td class="wide" title="${esc(i.title)}">${esc(i.title)}</td><td>${chips(i.labels)}</td></tr>`);
  const jobs = p.jobs.map((j) => `<tr><td>${idLink(j.name, `#/jobs/${encodeURIComponent(j.name)}`)}</td><td>${badge(j.state)}</td><td class="time">${esc(when(j.started))}</td></tr>`);
  const notes = p.vault.map((n) => `<tr><td class="wide">${esc(n.title)}</td><td>${chips([n.kind])}</td><td class="time">${esc(when(n.updated))}</td></tr>`);
  return `<div class="page"><p class="quiet"><a href="#/inventory">← Projects</a></p>` +
    pageHead(p.key, { count: p.factory ? "Factory" : "Plain repo", aside: `<code>${esc(p.path)}</code>` }) + renderFacts(p) +
    sec("Recent commits", p.commits.length, commits.length ? table([["Commit"], ["Subject"], ["Issue"], ["Date"]], commits) : empty("No commits on origin.", "The checkout has not fetched origin yet.")) +
    sec("Open issues", p.items.length, items.length ? table([["Issue"], ["Title"], ["Labels"]], items) : empty("No open issue.")) +
    sec("Jobs", p.jobs.length, jobs.length ? table([["Job"], ["State"], ["Started"]], jobs) : empty("No job has run here.")) +
    sec("Vault notes", p.vault.length, notes.length ? table([["Title"], ["Kind"], ["Updated"]], notes) : empty("No vault note has this scope.")) + `</div>`;
}
