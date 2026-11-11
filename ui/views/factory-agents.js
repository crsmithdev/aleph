// The Agents page: the usage, the slots and who used them. `s` is /api/factory; the agents come from /api/flow for the window.
import { get, redraw } from "../router.js";
import { postJson, card, cardTrend, count, dataTable, dur, empty, error, esc, heads, loadingLine, money, pageHead, pct, say, selectBox, setting, settings, shortModel, statCard, statusLight, tiles, scope } from "../lib.js";
import { NAMES } from "../../lib/naming.ts";
import { panelOf } from "../chart.js";
import { flowOf, lastPeriod, usageCard } from "./speed.js";

const share = (v) => (v == null ? "–" : pct(v * 100));
/** The OpenRouter spend period of a window: its UTC day, week or month; an hour reads the day. */
const SPEND = { hour: ["day", "today"], day: ["day", "today"], week: ["week", "this week"], month: ["month", "this month"] };

/** The Spend tile: what OpenRouter charged, read from OpenRouter, for the window's UTC period. */
function spendCard(m, win) {
  const [k, said] = SPEND[win] ?? SPEND.week, v = m?.spend?.[k];
  return statCard({ k: "Spend", v: v == null ? "–" : money(v), note: v == null ? "OpenRouter spend unknown" : `OpenRouter, ${said} (UTC)` });
}

/** The Backends tile: how many backends are up, with a light for the local server and one for OpenRouter. */
function backendsCard(m) {
  const light = (name, up) => statusLight(up == null ? "" : up ? "fine" : "alert", `${name}: ${up == null ? "–" : up ? "up" : "down"}`);
  const local = m ? m.local === "up" : null, router = m ? !m.down.includes("deepseek-v4.1-flash") : null;
  const extra = `<span class="lights">${light("Local server", local)}${light("OpenRouter", router)}</span>`;
  if (!m) return statCard({ k: "Backends", v: "–", note: "backend state unknown", extra });
  return statCard({ k: "Backends", v: count(Number(local) + Number(router)), v2: count(2), q: ["up", "backends"], extra });
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
const TIERS = Object.fromEntries(["merge", "reviewer", "intake", "director", "monitor", "title", "judge"].map((k) => [k, NAMES[k]]));

function roles(a, m) {
  const num = ["Jobs", "Success", "p50", "Cost"];
  const names = Object.fromEntries(a.roles.map((r) => [r.key, r.name]));
  const cell = (v) => `<td class="num">${v == null ? "–" : count(v)}</td>`;
  const outs = a.outcomes ?? [];
  // The outcome row for a config row: the one of its role and current model. A reviewer records no model, so its row is the one of its role.
  const find = (role, model) => outs.find((x) => x.role === role && (role === "reviewer" || shortModel(x.model) === shortModel(model)));
  const stats = (o) => {
    if (!o) return `${cell(null).repeat(num.length)}<td>${count(null)}</td>`;
    const trend = cardTrend(o.rate, o.baseline, null, { kind: "points", lowerIsGood: false, format: share, basis: "the baseline", tip: `Baseline ${share(o.baseline)}` });
    const warn = o.rate != null && o.rate < WARN_RATE ? " warn" : "";
    return `${cell(o.runs)}<td class="num${warn}">${esc(share(o.rate))} ${trend}</td><td class="num">${esc(dur(o.p50))}</td><td class="num">${esc(money(o.cost))}</td><td><a class="failed-jobs" href="#/factory/jobs?role=${esc(o.role)}&condition=failed">Failed jobs</a></td>`;
  };
  /** The worker outcome rows as one, for the one Worker row: the counts add, and the rate is its succeeded over its ended runs. */
  const allWorkers = () => {
    const rs = outs.filter((o) => o.role === "worker");
    const n = (k) => rs.reduce((x, o) => x + (o[k] ?? 0), 0), ended = n("succeeded") + n("failed") + n("stuck");
    return rs.length ? { role: "worker", runs: n("runs"), succeeded: n("succeeded"), failed: n("failed"), stuck: n("stuck"), rate: ended ? n("succeeded") / ended : null, cost: n("cost") } : null;
  };
  const model = (t) => shortModel(t?.model);
  const workerRow = () => `<tr><td>Worker</td><td>${model(m.tiers["worker-low"])}, ${model(m.tiers["worker-medium"])}</td>${stats(allWorkers())}</tr>`;
  const pick = ([tier, name]) => `<tr><td>${esc(name)}</td><td>${model(m.tiers[tier])}</td>${stats(find(tier, m.tiers[tier]?.model))}</tr>`;
  const tierRoles = new Set(["worker", "merge", "reviewer", "intake", "director", "monitor", "title", "judge"]);
  const config = m ? workerRow() + Object.entries(TIERS).map(pick).join("") : "";
  const rows = config + (m ? outs.filter((o) => !tierRoles.has(o.role)) : outs).map((o) => `<tr><td>${esc(names[o.role] ?? o.role)}</td><td>${o.model === "unset" ? "not recorded" : esc(shortModel(o.model))}</td>${stats(o)}</tr>`).join("");
  return rows ? dataTable(heads(["Role", "Model", ...num, "Failed Jobs"], num), rows) : empty("No agent ran in this window.", "Pick a longer window.");
}

const timed = (a) => a.roles.filter((r) => r.hours != null);
/** The colour of the role at index `i` of the fixed role list, so a role keeps its colour in every window. */
const ROLE_COLORS = ["series-1", "series-2", "series-3", "series-4", "series-5", "chart-6", "chart-7"];

/** The model of each tier, and whether each worker tier is on. A row applies on change. */
function models(m) {
  const sel = (tier, label, id) => selectBox(`${label} model`, tier, (m.offers[tier] ?? []).map((v) => ({ value: v, label: shortModel(v), disabled: m.down.includes(v) })), m.tiers[tier]?.model, { id, attrs: ` data-tier="${esc(tier)}"` });
  const worker = (tier, label) => setting(label, `<input type="checkbox" data-tier="${esc(tier)}" aria-label="${label} enabled"${m.tiers[tier]?.enabled ? " checked" : ""}> ` + sel(tier, label, `model-${tier}`), { id: `model-${tier}` });
  return settings("Models", [worker("worker-low", "Worker low"), worker("worker-medium", "Worker medium"), ...Object.entries(TIERS).map(([tier, name]) => setting(name, sel(tier, name, `model-${tier}`), { id: `model-${tier}` }))]);
}

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

/** The page body. `d` is /api/flow for the window, or null while it loads. */
export function renderFactoryAgents(s, d, _key = "live", window = "week", m = null) {
  const win = d?.window ?? window, w = { window: win }, a = d?.agents ?? null;
  const wait = d?.error ? error(d.error) : loadingLine("the agents");
  const head = scope().bar({ value: win });
  return `<div class="page sp" id="capacity">${pageHead("Agents", { aside: head })}${tiles("Scorecard", scorecard(s, m, win))}` +
    (a ? `<div class="trio">${Object.entries(FRAMES).map(([k, fr]) => panelOf(key(k), fr(d))).join("")}</div>` : card("Agents", wait)) +
    card("Roles", a ? roles(a, m) : wait, { id: "roles" }) + (m ? card("Models", models(m), { id: "models" }) : "") + `</div>`;
}

/** The old address. */
export const redirect = (hash) => (String(hash ?? "").split("?")[0] === "#/status/capacity" ? "#/factory/agents" : null);

export const view = {
  path: "/factory/agents",
  title: "Agents",
  group: "factory",
  order: 2,
  icon: "robot",
  api: (_params, q = new URLSearchParams()) => scope(q).url("/api/factory"),
  live: true,
  refresh: 60,
  // `s.flow` is /api/flow for the window and `s.models` is /api/models, which `more` adds; the page draws without them first.
  render: (s, _params, q) => renderFactoryAgents(s, s.flow ?? null, "live", scope(q).window, s.models ?? null),
  more: async (s, q) => {
    const [flow, models] = await Promise.all([flowOf(scope(q).window, q), get("/api/models").then((r) => r.json()).catch(() => null)]);
    return { ...s, flow, models };
  },
  mount: (root, s) => {
    scope().wire(root);
    if (s.flow?.agents) for (const [k, fr] of Object.entries(FRAMES)) root.querySelector(`aleph-chart[key="${key(k)}"]`).frame = fr(s.flow);
    root.onchange = async (e) => {
      const b = e.target.closest?.("#models [data-tier]");
      if (!b || e.type !== "change") return;
      const m = await postJson("/api/models", { tier: b.dataset.tier, ...(b.type === "checkbox" ? { enabled: b.checked } : { model: b.value }) }).catch((err) => say(b, err.message));
      if (m) await redraw(true);
    };
  },
};
