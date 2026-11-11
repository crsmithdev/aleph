// The Ideas views: the list at #/ideas (/api/ideas) and one idea at #/ideas/:slug (/api/ideas/:slug) with a tab for
// the write-up, one per lens and the log. A lens result is shown from the lens file route in a sandboxed iframe.
import { actButton, badge, card, chips, count, crumb, dataTable, empty, error, esc, filterBar, goQuery, hashQuery, heads, kept, keep, list, loadingLine, md, money, pageHead, postJson, repoIdLink, say, searchBox, statusRow, subHead, tabs, when, wireTable, wireTabs } from "../lib.js";
import { issueHref } from "../../lib/naming.ts";
import { redraw } from "../router.js";
import { renderKpis } from "../timeline.js";

const STATUSES = ["exploring", "built", "dropped"];
const LENS_TABS = [["prior-art", "Prior art"], ["red-team", "Red team"], ["explainer", "Explainer"]];
const href = (slug) => `#/ideas/${encodeURIComponent(slug)}`;
const target = (t) => t ?? "new project";
/** A local `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` from the store, as a local time. */
const local = (s) => `${s.replace(" ", "T")}${s.length === 10 ? "T00:00" : ""}`;

/** The table of the ideas whose title or target has the search text `q`, or the empty line. */
function ideasTable(rows, status, q = "") {
  const text = q.trim().toLowerCase();
  const shown = rows.filter((r) => !text || `${r.title} ${target(r.target)}`.toLowerCase().includes(text));
  return shown.length
    ? dataTable(heads(["Idea", "Status", "Target", "Lenses", "Open Questions", "Spent", "Updated"], ["Open Questions", "Spent", "Updated"]),
      shown.map((r) => `<tr class="rowlink"><td class="wide" title="${esc(r.title)}"><a href="${href(r.slug)}">${esc(r.title)}</a></td><td>${badge(r.status)}</td><td>${esc(target(r.target))}</td><td>${esc(r.lenses.join(", ") || "–")}</td><td class="num">${esc(count(r.questions))}</td><td class="num">${money(r.spent)}</td><td class="time">${esc(when(local(r.last)))}</td></tr>`).join(""))
    : empty(`No ${status} ideas.`, "Add one with <code>aleph idea add</code>.");
}

export function renderIdeas(rows, status, q = "") {
  const body = searchBox("ideas-search", q, "Search titles and targets") + filterBar([{ label: "Status", name: "status", options: STATUSES, value: status }]) + `<div id="ideas-table">${ideasTable(rows, status, q)}</div>`;
  return `<div class="page">${pageHead("Ideas", { count: rows.length })}${card("Ideas", body, { count: rows.length })}</div>`;
}

export const view = {
  path: "/ideas",
  title: "Ideas",
  icon: "lightbulb",
  group: "factory",
  order: -0.5,
  api: (_params, q = new URLSearchParams()) => `/api/ideas?status=${encodeURIComponent(q.get("status") || "exploring")}`,
  live: true,
  render: (d, _params, q) => renderIdeas(d, q?.get("status") || "exploring", q?.get("q") || ""),
  mount: (root, d, q) => {
    wireTable(root, { redraw: () => { root.querySelector("#ideas-table").innerHTML = ideasTable(d, q?.get("status") || "exploring", hashQuery().get("q") || ""); }, search: "ideas-search" });
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
  const items = [["writeup", "Write-up"], ...LENS_TABS, ["log", "Log"]];
  const lens = ([id, label]) => {
    const all = d.lenses.filter((l) => l.lens === id);
    const url = (l) => `/api/ideas/${encodeURIComponent(d.slug)}/${l.file}`;
    const newest = all[0];
    const body = !newest ? empty(`No ${label} result yet.`, "Queue a job to get one.")
      : newest.file.endsWith(".md") ? `<div class="md" data-src="${esc(url(newest))}">${loadingLine("the result")}</div>`
      : `<iframe class="lens-frame" sandbox title="${esc(label)}" src="${esc(url(newest))}"></iframe>`;
    const older = all.slice(1).map((l) => `<a href="${esc(url(l))}" target="_blank">${esc(when(local(l.at)))}</a>`);
    return `${body}${older.length ? subHead("Older Results") + list(older.join("")) : ""}${now.has(`${d.slug}-${id}`) ? badge("running") : actButton("Queue job", { lens: id })}`;
  };
  const panes = {
    writeup: `<div class="md">${md(d.writeup)}</div>`,
    log: d.log.length ? `<ul>${d.log.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : empty("No log yet.", "Add a line with <code>aleph idea note</code>."),
    ...Object.fromEntries(LENS_TABS.map((t) => [t[0], lens(t)])),
  };
  const built = (d.built ?? []).map((r) => repoIdLink(r, issueHref(r))).join(" ");
  return `<div class="page">${crumb("#/ideas", [["ideas", "#/ideas"], [d.slug]])}` +
    pageHead(d.title, { aside: actButton("Build", { build: "1" }, { primary: true }) }) +
    statusRow(badge(d.status), "", chips([target(d.target)])) +
    renderKpis([{ k: "Results", v: esc(count(d.lenses.length)) }, { k: "Running", v: esc(count(now.size)) }, { k: "Built", v: built || "–", text: true }]) +
    tabs("Idea tabs", items, panes, tab) + "</div>";
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
      fetch(el.dataset.src).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${el.dataset.src} answered ${r.status}`))))
        .then((t) => { el.innerHTML = md(t); }, (err) => { el.innerHTML = error(err.message); });
    }
    wireTabs(root.querySelector(".page"), (id) => keep(`idea-tab:${d.slug}`, id));
    root.onclick = async (e) => {
      const q = e.target.closest("button[data-lens]");
      if (q) {
        try {
          const { started } = await postJson(`/api/ideas/${encodeURIComponent(d.slug)}/lenses/${q.dataset.lens}`, {});
          pending.set(started, false);
          redraw(true);
        } catch (err) { say(q, `Queue job failed: ${err.message}`); }
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
