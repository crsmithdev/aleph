// The Agents page: the usage, the slots and who used them. `s` is /api/factory; the agents come from /api/flow for the window.
import { get, redraw } from "../router.js";
import { postJson, badCount, card, cardTrend, cell, count, dataTable, day, dur, empty, error, esc, heads, keep, kept, loadingLine, miss, money, notice, pageHead, pct, say, selectBox, shortModel, statCard, tiles, scope } from "../lib.js";
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

/** The sizes by their label; the models each offers come from /api/models. */
const SIZES = { small: "Small", medium: "Medium", large: "Large" };
/** Each role model's role, whose name and outcomes its rows show; the models it offers come from /api/models. */
const ROLE_MODELS = { review: "reviewer", intake: "intake", director: "director", monitor: "monitor", maintainer: "maintainer", lens: "lens", housekeeper: "housekeeper", title: "title", judge: "judge" };

/** The noun of each role's output; a role not named here counts its OK runs. */
const NOUNS = { worker: "landed", reviewer: "verdict", intake: "triage", director: "step", monitor: "reading", housekeeper: "sweep", title: "title", judge: "call" };

/** Where an off size's work goes, as route() picks it: the next size up that is on, else the next one down. */
function goesTo(key, set) {
  const ks = Object.keys(SIZES), i = ks.indexOf(key);
  return SIZES[[...ks.slice(i + 1), ...ks.slice(0, i).reverse()].find((k) => set[k]?.enabled)];
}

function roles(a, m) {
  const num = ["Runs", "OK", "Stuck", "p50", "p95", "Cost", "Per Output"];
  const gone = miss("no runs in this window");
  const outs = a.outcomes ?? [], set = m?.models ?? {}, open = new Set(kept("agents.open", []));
  // The figures of one outcome. Its output is landed builds for a worker, verdicts for the reviewer and OK runs for another role.
  const stats = (o) => {
    if (!o) return `<td class="num">${gone}</td>`.repeat(num.length) + `<td>${gone}</td>`;
    const few = o.ended < MIN_ENDED, worker = o.role === "worker", reviewer = o.role === "reviewer";
    const out = worker ? o.built : reviewer ? o.pass + o.fail : o.succeeded, noun = NOUNS[o.role] ?? "run";
    const trend = few ? "" : cardTrend(o.rate, o.baseline, null, { kind: "points", lowerIsGood: false, format: share, basis: "the baseline", tip: `Baseline ${share(o.baseline)}` });
    const warn = !few && o.rate != null && o.rate < WARN_RATE ? " warn" : "";
    const rate = few ? `${reviewer ? out : o.succeeded} / ${o.ended}` : `${esc(share(o.rate))} <span class="quiet" title="ended">${count(o.ended)}</span> ${trend}`;
    const q = worker ? ` <span class="quiet">· ${share(o.built ? o.firstPass / o.built : null)} first · ${share(o.reviewPass)} review</span>` : "";
    return `${cell(count(o.runs), { num: true })}<td class="num${warn}">${rate}</td>${badCount(o.stuck)}${[dur(o.p50), dur(o.p95), money(o.cost), out ? money(o.cost / out) : "–"].map((v) => cell(v, { num: true })).join("")}<td>${count(out)} ${worker || out === 1 ? noun : `${noun}s`}${q}</td>`;
  };
  const sel = (key, label) => selectBox(`${label} model`, key, (m.offers[key] ?? []).map((v) => ({ value: v, label: shortModel(v), disabled: m.down.includes(v) })), set[key].model, { id: `model-${key}`, attrs: ` data-name="${esc(key)}"` });
  const on = Object.keys(SIZES).filter((k) => set[k]?.enabled).length;
  const box = (key, label) => `<input type="checkbox" data-name="${esc(key)}" aria-label="${label} enabled"${set[key].enabled ? ` checked${on === 1 ? ' disabled title="Last on"' : ""}` : ""}> `;
  // A row per size and role: the figures of the model it is set to (with no setting, of the model it ran on last), then under ▸ a sub-row per earlier model.
  const line = (key, label, rs) => {
    const last = [...rs].sort((x, y) => (y.to ?? "").localeCompare(x.to ?? ""));
    const now = set[key]?.model ?? last[0]?.model, cur = rs.find((o) => shortModel(o.model) === shortModel(now));
    const past = last.filter((o) => o !== cur), off = key in SIZES && set[key] && !set[key].enabled, shut = !open.has(key);
    const fold = past.length ? `<button class="fold" data-fold="${esc(key)}" aria-expanded="${!shut}" aria-label="Earlier models of ${label}">${shut ? "▸" : "▾"}</button> ` : `<span class="fold" aria-hidden="true"></span> `;
    const ctrl = !set[key] ? esc(shortModel(now)) : `${key in SIZES ? box(key, label) : ""}${off ? `<span class="quiet">Off · goes to ${goesTo(key, set)}</span>` : sel(key, label)}`;
    return `<tr><td class="wide" title="${label}">${label}</td><td>${fold}${ctrl}</td>${off ? `<td colspan="${num.length + 1}"></td>` : stats(cur)}</tr>` +
      (shut ? "" : past.map((o) => `<tr class="sub-row"><td></td><td>${esc(shortModel(o.model))} <span class="quiet">${day(o.from)} – ${day(o.to)}</span></td>${stats(o)}</tr>`).join(""));
  };
  const of = (role, size) => outs.filter((o) => o.role === role && (size === undefined || o.size === size));
  const grp = (t) => `<tr class="grp"><th colspan="${num.length + 3}">${t}</th></tr>`;
  const rows = grp("Workers") + Object.entries(SIZES).map(([k, l]) => line(k, l, of("worker", k))).join("") + line("unsized", "Unsized", of("worker", null)) +
    grp("Roles") + Object.entries(ROLE_MODELS).map(([k, r]) => line(k, NAMES[r], of(r))).join("");
  return m || outs.length ? dataTable(heads(["Agent", "Model", ...num, "Output"], num), rows) : empty();
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
    card("Roles", a ? roles(a, m) : wait, { id: "roles" }) + `</div>`;
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
    root.onclick = (e) => {
      const b = e.target.closest?.("#roles button[data-fold]");
      if (!b) return;
      const open = new Set(kept("agents.open", []));
      if (!open.delete(b.dataset.fold)) open.add(b.dataset.fold);
      keep("agents.open", [...open]);
      redraw();
    };
    root.onchange = async (e) => {
      const b = e.target.closest?.("#roles [data-name]");
      if (!b || e.type !== "change") return;
      const m = await postJson("/api/models", { name: b.dataset.name, ...(b.type === "checkbox" ? { enabled: b.checked } : { model: b.value }) }).catch((err) => say(b, err.message));
      if (m) await redraw(true);
    };
  },
};
