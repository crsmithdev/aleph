// The Ideas views: the list at #/ideas (/api/ideas) and one idea at #/ideas/:slug (/api/ideas/:slug) with a tab for
// the write-up, one per lens and the log. A lens result is shown from the lens file route in a sandboxed iframe.
import { actButton, dataTable, empty, esc, filterBar, goQuery, heads, kept, keep, md, money, postJson, say, seg, tag } from "../lib.js";
import { issueHref } from "../../lib/naming.ts";
import { redraw } from "../router.js";

const STATUSES = ["exploring", "built", "dropped"];
const LENS_TABS = [["prior-art", "Prior art"], ["red-team", "Red team"], ["explainer", "Explainer"]];
const href = (slug) => `#/ideas/${encodeURIComponent(slug)}`;
const target = (t) => t ?? "new project";

export function renderIdeas(rows, status) {
  const table = rows.length
    ? dataTable(heads(["Idea", "Target", "Status", "Lenses", "Open questions", "Spent", "Last"], ["Open questions", "Spent"]),
      rows.map((r) => `<tr><td><a href="${href(r.slug)}">${esc(r.title)}</a></td><td>${esc(target(r.target))}</td><td>${tag(r.status)}</td><td>${esc(r.lenses.join(", "))}</td><td class="num">${r.questions}</td><td class="num">${money(r.spent)}</td><td>${esc(r.last)}</td></tr>`).join(""))
    : empty(`No ${status} ideas.`);
  return `<div class="ph"><h1>Ideas</h1></div>${filterBar([{ label: "Status", name: "status", options: STATUSES, value: status }])}${table}`;
}

export const view = {
  path: "/ideas",
  title: "Ideas",
  icon: "lightbulb",
  group: "factory",
  order: -0.5,
  api: (_params, q = new URLSearchParams()) => `/api/ideas?status=${encodeURIComponent(q.get("status") || "exploring")}`,
  live: true,
  render: (d, _params, q) => renderIdeas(d, q?.get("status") || "exploring"),
  mount: (root) => {
    root.onclick = (e) => {
      const b = e.target.closest("[data-name=status] button");
      if (b) goQuery({ status: b.dataset.value === "exploring" ? "" : b.dataset.value });
    };
  },
};

/** Lens runs this page started, by run name: false until the server lists the run as running, then dropped when it is not. */
const pending = new Map();

export function renderIdea(d) {
  const running = new Set(d.running);
  for (const [n, seen] of pending) { if (running.has(n)) pending.set(n, true); else if (seen) pending.delete(n); }
  const now = new Set([...running, ...pending.keys()]);
  const tab = kept(`idea-tab:${d.slug}`, "writeup");
  const tabs = [["writeup", "Write-up"], ...LENS_TABS, ["log", "Log"]];
  const lens = ([id, label]) => {
    const all = d.lenses.filter((l) => l.lens === id);
    const url = (l) => `/api/ideas/${encodeURIComponent(d.slug)}/${l.file}`;
    const newest = all[0];
    const body = !newest ? empty(`No ${label} result yet.`)
      : newest.file.endsWith(".md") ? `<div class="md" data-src="${esc(url(newest))}">Loading…</div>`
      : `<iframe sandbox title="${esc(label)}" src="${esc(url(newest))}" style="width:100%;height:70vh;border:0"></iframe>`;
    const older = all.slice(1).map((l) => `<li><a href="${esc(url(l))}" target="_blank">${esc(l.at)}</a></li>`).join("");
    return `${body}${older ? `<h3>Older results</h3><ul>${older}</ul>` : ""}<p>${now.has(`${d.slug}-${id}`) ? tag("running", "need") : actButton("Queue job", { lens: id })}<span class="note"></span></p>`;
  };
  const panes = {
    writeup: `<div class="md">${md(d.writeup)}</div>`,
    log: `<ul>${d.log.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`,
    ...Object.fromEntries(LENS_TABS.map((t) => [t[0], lens(t)])),
  };
  const built = (d.built ?? []).map((r) => `<a href="${esc(issueHref(r))}">${esc(r)}</a>`).join(" ");
  return `<div class="ph"><h1>${esc(d.title)}</h1><span class="aside">${esc(target(d.target))} ${tag(d.status)}${built ? ` · ${built}` : ""} ${actButton("Build", { build: "1" }, { primary: true })}</span></div>` +
    seg("Idea tabs", tabs.map(([id, label]) => ({ label, on: id === tab, attrs: ` data-tab="${id}"` }))) +
    tabs.map(([id]) => `<section data-pane="${id}"${id === tab ? "" : " hidden"}>${panes[id]}</section>`).join("");
}

export const ideaView = {
  path: "/ideas/:slug",
  title: "Idea",
  group: "factory",
  api: (params) => `/api/ideas/${encodeURIComponent(params.slug)}`,
  live: true,
  render: renderIdea,
  mount: (root, d) => {
    for (const el of root.querySelectorAll(".md[data-src]")) {
      fetch(el.dataset.src).then((r) => r.text()).then((t) => { el.innerHTML = md(t); });
    }
    root.onclick = async (e) => {
      const t = e.target.closest("button[data-tab]");
      if (t) { keep(`idea-tab:${d.slug}`, t.dataset.tab); redraw(); return; }
      const q = e.target.closest("button[data-lens]");
      if (q) {
        try {
          const { started } = await postJson(`/api/ideas/${encodeURIComponent(d.slug)}/lenses/${q.dataset.lens}`, {});
          pending.set(started, false);
          redraw(true);
        } catch (err) { say(q.nextElementSibling, `Could not queue it: ${err.message}`); }
        return;
      }
      if (e.target.closest("button[data-build]")) {
        const ui = document.getElementById("kit-chat")?.shadowRoot;
        if (!ui) return;
        ui.querySelector("textarea").value = "Build this idea.";
        ui.querySelector("form").requestSubmit();
      }
    };
  },
};
export const views = [view, ideaView];
