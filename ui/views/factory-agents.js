// The Agents page: the usage, the slots and who used them. `s` is /api/factory; the agents come from /api/flow for the window.
import { get, redraw } from "../router.js";
import { postJson, card, cardTrend, cell, count, dataTable, dur, empty, error, esc, heads, loadingLine, miss, money, notice, pageHead, pct, row, say, selectBox, shortModel, statCard, tiles, scope } from "../lib.js";
import { NAMES } from "../../lib/naming.ts";
import { panelOf } from "../chart.js";
import { flowOf, lastPeriod, usageCard, windowTrend } from "./speed.js";

const share = (v) => pct(v == null ? v : v * 100);
/** The OpenRouter spend period of a window: its UTC day, week or month; an hour reads the day. */
const SPEND = { hour: "day", day: "day", week: "week", month: "month" };

/** The OpenRouter tile: whether OpenRouter is up, over what it charged for the window's UTC period. */
function openRouterCard(m, win) {
  const up = m ? !m.down.includes("deepseek-v4.1-flash") : null;
  const v = m?.spend?.[SPEND[win] ?? SPEND.week];
  return statCard({ k: "OpenRouter", v: up == null ? "–" : up ? "up" : "down", v2: v == null ? "–" : money(v), q: ["status", "spend"], loading: m === undefined });
}

/** The Follow-ups card: the issues the factory's own actors filed in the window and all the issues filed, with its trend against the baseline (neutral). `d` is /api/flow for the window with `baseline`, or null while it loads. */
function followupsCard(d) {
  const v = d?.figures?.followups;
  return statCard({ k: "Follow-ups", v: v == null ? "–" : count(v), ...(v == null ? {} : { v2: count(d.figures.filed) }), q: ["follow-ups", "filed"], trend: windowTrend(d, "followups", v, { kind: "relative", lowerIsGood: null, format: count }), loading: !d });
}

/** The Success card: the share of runs that succeeded and the share of builds that passed first time, with the success trend against its baseline. */
function successCard(a) {
  const r = a?.rates;
  return statCard({ k: "Success", v: share(r?.success), v2: share(r?.firstPass), q: ["runs", "first pass"], trend: cardTrend(r?.success, r?.baseline, null, { kind: "points", lowerIsGood: false, format: share, basis: "the baseline" }), loading: !a });
}

function scorecard(s, d, m, win) {
  const f = s.factory, a = d?.agents ?? null;
  return usageCard(s) + openRouterCard(m, win) +
    statCard({ k: "Live agents", v: count(f.liveRuns ?? 0), v2: a ? count(a.live - a.workers) : "–", q: ["workers", "other"] }) +
    followupsCard(d) + successCard(a);
}

/** A success rate under this line (0 to 1) shows in the warn tone. */
const WARN_RATE = 0.7;
/** A row with fewer ended runs shows its counts, not a rate. */
const MIN_ENDED = 20;
/** A share (0 to 1) to one decimal. */
const share1 = (v) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);

/** The sizes by their label; the models each offers come from /api/models. */
const SIZES = { small: "Small", medium: "Medium", large: "Large" };
/** Each role model's role, whose name and outcomes its rows show; the models it offers come from /api/models. */
const ROLE_MODELS = { review: "reviewer", intake: "intake", director: "director", monitor: "monitor", title: "title", judge: "judge" };

function roles(a, m) {
  const num = ["Jobs", "Success", "p50", "p95", "Cost", "Built", "First pass", "Review pass"];
  const names = Object.fromEntries(a.roles.map((r) => [r.key, r.name]));
  const gone = `<td class="num">${miss("no runs in this window")}</td>`;
  const outs = a.outcomes ?? [];
  const stats = (o) => {
    if (!o) return `${gone.repeat(num.length)}<td>${miss("no runs in this window")}</td>`;
    const few = o.ended < MIN_ENDED, reviewer = o.role === "reviewer", worker = o.role === "worker";
    // A reviewer's rate is a share of verdicts, not better or worse.
    const trend = few ? "" : cardTrend(o.rate, o.baseline, null, { kind: "points", lowerIsGood: reviewer ? null : false, format: share, basis: "the baseline", tip: `Baseline ${share(o.baseline)}` });
    const warn = !few && !reviewer && o.rate != null && o.rate < WARN_RATE ? " warn" : "";
    const rate = few ? `${o.succeeded} / ${o.ended}` : `${esc(share(o.rate))} <span class="m" title="ended">${count(o.ended)}</span> ${trend}`;
    const per = worker && o.perBuilt != null ? ` <span class="m">${money(o.perBuilt)} / built</span>` : "";
    const built = worker ? [cell(count(o.built), { num: true }), cell(share1(o.built ? o.firstPass / o.built : null), { num: true }), cell(share1(o.reviewPass), { num: true })] : Array(3).fill(`<td class="num">${miss("worker only")}</td>`);
    return `${cell(count(o.runs), { num: true })}<td class="num${warn}">${reviewer ? '<span class="m">Pass share</span> ' : ""}${rate}</td>${cell(dur(o.p50), { num: true })}${cell(dur(o.p95), { num: true })}<td class="num">${money(o.cost)}${per}</td>${built.join("")}<td><a class="failed-jobs" href="#/factory/jobs?role=${esc(o.role)}&state=failed">Failed jobs</a></td>`;
  };
  // One row per size and role model, with a select for its model and the outcome of that model; then a row per outcome no select covers.
  const sel = (key, label) => selectBox(`${label} model`, key, (m.offers[key] ?? []).map((v) => ({ value: v, label: shortModel(v), disabled: m.down.includes(v) })), m.models[key]?.model, { id: `model-${key}`, attrs: ` data-name="${esc(key)}"` });
  const used = new Set();
  const pick = ([key, label, role]) => {
    const o = outs.find((x) => x.role === role && shortModel(x.model) === shortModel(m.models[key]?.model));
    if (o) used.add(o);
    const box = key in SIZES && key !== "large" ? `<input type="checkbox" data-name="${esc(key)}" aria-label="${label} enabled"${m.models[key]?.enabled ? " checked" : ""}> ` : "";
    return row([cell(label, { wide: true }), `<td>${box}${sel(key, label)}</td>`, stats(o)]);
  };
  const config = m ? [...Object.entries(SIZES).map(([key, label]) => [key, label, "worker"]), ...Object.entries(ROLE_MODELS).map(([key, role]) => [key, NAMES[role], role])].map(pick).join("") : "";
  const rows = config + outs.filter((o) => !used.has(o) && !(m && o.role === "merge")).map((o) => row([cell(NAMES[o.role] ?? names[o.role] ?? o.role, { wide: true }), cell(shortModel(o.model)), stats(o)])).join("");
  return rows ? dataTable(heads(["Role", "Model", ...num, "Failed Jobs"], num), rows) : empty();
}

const timed = (a) => a.roles.filter((r) => r.hours != null);
/** The colour of the role at index `i` of the fixed role list, so a role keeps its colour in every window; the cost chart's keys take them in order. */
const ROLE_COLORS = ["series-1", "series-2", "series-3", "series-4", "series-5", "chart-6", "chart-7"];

/** The live frame: agents live per point, by role. */
export const liveFrame = (d) => ({
  measure: { name: "Agents Live", unit: "count", agg: "max" },
  over: { kind: "time", window: d.window },
  by: { name: "Role", keys: d.agents.roles.map((r, i) => ({ key: r.key, name: r.name, color: ROLE_COLORS[i % ROLE_COLORS.length] })).filter((k) => timed(d.agents).some((r) => r.key === k.key)) },
  rows: d.agents.points.map((p) => ({ ...p })),
});

/** A per-bucket frame by model: `field` is the bucket's value per model, `measure` what the chart plots. */
function modelFrame(d, field, measure) {
  const all = [...new Set((d.buckets ?? []).flatMap((b) => Object.keys(b[field] ?? {})))].sort();
  // At most seven keys: past that, the models after the sixth fold into Other.
  const rest = all.length > ROLE_COLORS.length ? all.slice(ROLE_COLORS.length - 1) : [];
  const keys = all.slice(0, all.length - rest.length).map((m) => ({ key: m, name: shortModel(m) }));
  if (rest.length) keys.push({ key: "Other", name: "Other" });
  return {
    measure,
    over: { kind: "time", window: d.window },
    by: { name: "Model", keys: keys.map((k, i) => ({ ...k, color: ROLE_COLORS[i] })) },
    rows: (d.buckets ?? []).map((b) => {
      const row = { at: b.at, ...b[field] };
      if (rest.length) { row.Other = rest.reduce((n, m) => n + (row[m] ?? 0), 0); for (const m of rest) delete row[m]; }
      return row;
    }),
  };
}

/** The cost frame: cost per bucket, by model. */
export const costFrame = (d) => modelFrame(d, "cost", { name: "Cost", unit: "usd", agg: "sum" });

/** The tokens frame: tokens per bucket, by model. */
export const tokensFrame = (d) => modelFrame(d, "tokens", { name: "Tokens", unit: "count", agg: "sum" });

const FRAMES = { live: liveFrame, tokens: tokensFrame, cost: costFrame };
const key = (k) => `factory/agents/${k}`;

/** The page body. `d` is /api/flow for the window, or null while it loads. `m` is /api/models: undefined while it loads, null when it failed. */
export function renderFactoryAgents(s, d, _key = "live", window = "week", m) {
  const win = d?.window ?? window, w = { window: win }, a = d?.agents ?? null;
  const wait = d?.error ? error(d.error) : loadingLine("the agents");
  const head = scope().bar({ value: win });
  return `<div class="page sp" id="capacity">${pageHead("Agents", { aside: head })}${m?.local === "down" ? notice("Local server down", true) : ""}${tiles("Scorecard", scorecard(s, d, m, win))}` +
    (a ? `<div class="trio">${Object.entries(FRAMES).map(([k, fr]) => panelOf(key(k), fr(d))).join("")}</div>` : card("Agents", wait)) +
    card("Roles", a ? roles(a, m) : wait, { id: "roles", aside: a?.rates?.firstPass == null ? "" : `First pass ${share1(a.rates.firstPass)}` }) + `</div>`;
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
  render: (s, _params, q) => renderFactoryAgents(s, s.flow ?? null, "live", scope(q).window, s.models),
  more: async (s, q) => {
    const [flow, models] = await Promise.all([flowOf(scope(q).window, q, true), get("/api/models").then((r) => r.json()).catch(() => null)]);
    return { ...s, flow, models };
  },
  mount: (root, s) => {
    scope().wire(root);
    if (s.flow?.agents) for (const [k, fr] of Object.entries(FRAMES)) root.querySelector(`aleph-chart[key="${key(k)}"]`).frame = fr(s.flow);
    root.onchange = async (e) => {
      const b = e.target.closest?.("#roles [data-name]");
      if (!b || e.type !== "change") return;
      const m = await postJson("/api/models", { name: b.dataset.name, ...(b.type === "checkbox" ? { enabled: b.checked } : { model: b.value }) }).catch((err) => say(b, err.message));
      if (m) await redraw(true);
    };
  },
};
