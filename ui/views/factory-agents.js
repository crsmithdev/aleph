// The Agents page: the usage, the slots and who used them. `s` is /api/state; the agents come from /api/speed for the window.
import { postJson, card, cardTrend, count, dataTable, dur, empty, error, esc, hashQuery, heads, keepProject, keepWindow, loadingLine, money, pageHead, pct, projectNow, scopeBar, shortModel, statCard, tiles, windowOf, wireScope, withProject } from "../lib.js";
import { panelOf } from "../chart.js";
import { lastPeriod, loadSpeed, usable, usageCard } from "./speed.js";

const share = (v) => (v == null ? "–" : pct(v * 100));
/** The OpenRouter spend period of a window: its UTC day, week or month; an hour reads the day. */
const SPEND = { hour: ["day", "today"], day: ["day", "today"], week: ["week", "this week"], month: ["month", "this month"] };

/** The Spend tile: what OpenRouter charged, read from OpenRouter, for the window's UTC period. */
function spendCard(m, win) {
  const [k, said] = SPEND[win] ?? SPEND.week, v = m?.spend?.[k];
  return statCard({ k: "Spend", v: v == null ? "–" : money(v), note: v == null ? "OpenRouter spend unknown" : `OpenRouter, ${said} (UTC)` });
}

/** The Backends tile: a light for the local server and one for OpenRouter. */
function backendsCard(m) {
  const light = (name, up) => `<span class="light"><span class="event-dot ${up == null ? "" : up ? "fine" : "alert"}"></span>${esc(name)}: ${up == null ? "–" : up ? "up" : "down"}</span>`;
  const local = m ? m.local === "up" : null, router = m ? !m.down.includes("deepseek-v4.1-flash") : null;
  return `<div class="tile sc"><span class="r1"><span class="k">Backends</span></span><span class="lights">${light("Local server", local)}${light("OpenRouter", router)}</span></div>`;
}

function scorecard(s, m, win) {
  const f = s.factory;
  return usageCard(s) + spendCard(m, win) +
    statCard({ k: "Worker slots", v: count(f.liveRuns ?? 0), v2: f.liveCap == null ? "–" : count(f.liveCap), q: ["in use", "cap"] }) +
    backendsCard(m);
}

/** A success rate under this line (0 to 1) shows in the warn tone. */
const WARN_RATE = 0.7;

/** Each tier's name; the models it offers come from /api/models. */
const TIERS = {
  merge: "Merge",
  reviewer: "Reviewer",
  intake: "Intake",
  director: "Director",
  monitor: "Monitor",
  title: "Title",
  judge: "Judge",
};

function roles(a, m) {
  const num = ["Jobs", "Success", "p50", "Cost"];
  const names = Object.fromEntries(a.roles.map((r) => [r.key, r.name]));
  const cell = (v) => `<td class="num">${v == null ? "–" : count(v)}</td>`;
  const outs = a.outcomes ?? [];
  // The outcome row for a config row: the one of its role and current model, when no other config row claims it. A reviewer records no model, so its row is the one of its role.
  const claims = [];
  const find = (role, model) => {
    const o = outs.find((x) => x.role === role && (role === "reviewer" || shortModel(x.model) === shortModel(model)));
    if (o) claims.push(o);
    return o;
  };
  const stats = (o) => {
    if (!o) return `${cell(null).repeat(num.length)}<td>–</td>`;
    const trend = cardTrend(o.rate, o.baseline, null, { kind: "points", lowerIsGood: false, format: share, basis: "the baseline", tip: `Baseline ${share(o.baseline)}` });
    const warn = o.rate != null && o.rate < WARN_RATE ? " warn" : "";
    return `${cell(o.runs)}<td class="num${warn}">${esc(share(o.rate))} ${trend}</td><td class="num">${esc(dur(o.p50))}</td><td class="num">${esc(money(o.cost))}</td><td><a href="#/factory/jobs?role=${esc(o.role)}&condition=failed">Failed jobs</a></td>`;
  };
  /** The worker outcome rows as one, for the one Worker row: the counts add, and the rate is its succeeded over its ended runs. */
  const allWorkers = () => {
    const rs = outs.filter((o) => o.role === "worker");
    const n = (k) => rs.reduce((x, o) => x + (o[k] ?? 0), 0), ended = n("succeeded") + n("failed") + n("stuck");
    return rs.length ? { role: "worker", runs: n("runs"), succeeded: n("succeeded"), failed: n("failed"), stuck: n("stuck"), rate: ended ? n("succeeded") / ended : null, cost: n("cost") } : null;
  };
  const workerRow = () => {
    const low = m.tiers["worker-low"], med = m.tiers["worker-medium"];
    const offersLow = m.offers["worker-low"] ?? [], offersMed = m.offers["worker-medium"] ?? [];
    const sel = (tier, t, offers, label) => `<span class="worker-tier"><input type="checkbox" data-tier="${esc(tier)}" aria-label="${label} enabled"${t?.enabled ? " checked" : ""}> <span class="quiet">${label}:</span> <select data-tier="${esc(tier)}" aria-label="${label} model">` +
      offers.map((v) => `<option value="${esc(v)}"${t?.model === v ? " selected" : ""}${m.down.includes(v) ? " disabled" : ""}>${esc(shortModel(v))}</option>`).join("") + `</select></span>`;
    return `<tr><td>Worker</td><td>${sel("worker-low", low, offersLow, "Worker low")} ${sel("worker-medium", med, offersMed, "Worker medium")}</td>${stats(allWorkers())}</tr>`;
  };
  const pick = ([tier, name]) => {
    const t = m.tiers[tier];
    const offers = m.offers[tier] ?? [];
    return `<tr><td>${esc(name)}</td><td><select data-tier="${esc(tier)}" aria-label="${esc(name)} model">` +
      offers.map((v) => `<option value="${esc(v)}"${t?.model === v ? " selected" : ""}${m.down.includes(v) ? " disabled" : ""}>${esc(shortModel(v))}</option>`).join("") + `</select></td>${stats(find(tier, t?.model))}</tr>`;
  };
  const tierRoles = new Set(["worker", "merge", "reviewer", "intake", "director", "monitor", "title", "judge"]);
  const config = m ? workerRow() + Object.entries(TIERS).map(pick).join("") : "";
  const rows = config + (m ? outs.filter((o) => !tierRoles.has(o.role)) : outs).map((o) => `<tr><td>${esc(names[o.role] ?? o.role)}</td><td>${o.model === "unset" ? "not recorded" : esc(shortModel(o.model))}</td>${stats(o)}</tr>`).join("");
  return rows ? dataTable(heads(["Role", "Model", ...num, ""], num), rows) : empty("No agent ran in this window.");
}

const timed = (a) => a.roles.filter((r) => r.hours != null);
/** The colour of the role at index `i` of the fixed role list, so a role keeps its colour in every window. */
const ROLE_COLORS = ["series-1", "series-2", "series-3", "series-4", "series-5", "chart-6", "chart-7"];

/** The live frame: agents live per point, by role. */
export const liveFrame = (d) => ({
  measure: { name: "Agents Live", unit: "count", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { name: "Role", keys: d.agents.roles.map((r, i) => ({ key: r.key, name: r.name, color: ROLE_COLORS[i % ROLE_COLORS.length] })).filter((k) => timed(d.agents).some((r) => r.key === k.key)) },
  rows: d.agents.points.map((p) => ({ ...p })),
});

/** The outcomes frame: succeeded, failed and stuck runs per role, summed over the models. */
export function outcomesFrame(d) {
  const rows = d.agents.outcomes ?? [], sum = (r, k) => rows.filter((o) => o.role === r.key).reduce((n, o) => n + (o[k] ?? 0), 0);
  return {
    measure: { name: "Outcomes", unit: "count", agg: "sum" },
    over: { kind: "category", name: "Role" },
    by: { name: "Outcome", keys: [{ key: "succeeded", name: "Succeeded", color: "done" }, { key: "failed", name: "Failed", color: "need" }, { key: "stuck", name: "Stuck", color: "stuck" }] },
    rows: d.agents.roles.filter((r) => rows.some((o) => o.role === r.key)).map((r) => ({ name: r.name, succeeded: sum(r, "succeeded"), failed: sum(r, "failed"), stuck: sum(r, "stuck") })),
  };
}

/** The cost frame: cost per bucket, by model. */
export function costFrame(d) {
  const models = [...new Set((d.buckets ?? []).flatMap((b) => Object.keys(b.cost ?? {})))].sort();
  return {
    measure: { name: "Cost", unit: "usd", agg: "sum" },
    over: { kind: "time", window: d.window },
    by: { name: "Model", keys: models.map((m) => ({ key: m, name: m })) },
    rows: (d.buckets ?? []).map((b) => ({ at: b.at, ...b.cost })),
  };
}

const FRAMES = { live: liveFrame, outcomes: outcomesFrame, cost: costFrame };
const key = (k) => `factory/agents/${k}`;

/** The page body. `d` is /api/speed for the window, or null while it loads. */
export function renderFactoryAgents(s, d, _key = "live", window = "week", m = null) {
  const win = d?.window ?? window, w = { window: win }, a = d?.agents ?? null;
  const wait = d?.error ? error(d.error) : loadingLine("the agents");
  const scope = scopeBar(projectNow(), win);
  return `<div class="page sp" id="capacity">${pageHead("Agents", { count: lastPeriod(w), aside: scope })}${tiles("Scorecard", scorecard(s, m, win))}` +
    (a ? `<div class="trio">${Object.entries(FRAMES).map(([k, fr]) => panelOf(key(k), fr(d))).join("")}</div>` : card("Agents", wait)) +
    card("Roles", a ? roles(a, m) : wait, { id: "roles" }) + `</div>`;
}

/** The old address. */
export const redirect = (hash) => (String(hash ?? "").split("?")[0] === "#/status/capacity" ? "#/factory/agents" : null);

const windowNow = () => windowOf(hashQuery());
let modelsNow = null;

export const view = {
  path: "/factory/agents",
  title: "Agents",
  group: "factory",
  order: 2,
  icon: "robot",
  api: (_params, q = new URLSearchParams()) => withProject("/api/state", q),
  refresh: 60,
  render: (s, _params, q) => renderFactoryAgents(s, usable(windowOf(q)), "live", windowOf(q)),
  mount: async (root, s) => {
    const draw = (d) => {
      root.innerHTML = renderFactoryAgents(s, d, "live", windowNow(), modelsNow);
      wireScope(root);
      if (!d?.agents) return;
      for (const [k, fr] of Object.entries(FRAMES)) root.querySelector(`aleph-chart[key="${key(k)}"]`).frame = fr(d);
    };
    root.onchange = async (e) => {
      const b = e.target.closest?.("#roles [data-tier]");
      if (!b || e.type !== "change") return;
      const m = await postJson("/api/models", { tier: b.dataset.tier, ...(b.type === "checkbox" ? { enabled: b.checked } : { model: b.value }) }).catch(() => null);
      if (m) { modelsNow = m; draw(usable(windowNow())); }
    };
    keepWindow(windowNow());
    keepProject(projectNow());
    draw(usable(windowNow()));
    modelsNow = await fetch("/api/models").then((r) => r.json()).catch(() => null);
    draw(usable(windowNow()));
    const d = await loadSpeed(windowNow());
    if (root.querySelector("#capacity")) draw(d);
  },
};
