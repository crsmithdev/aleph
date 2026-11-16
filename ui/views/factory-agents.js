// The Agents page: the usage, the slots and who used them. `s` is /api/factory; the agents come from /api/flow for the window.
import { get, moved, redraw } from "./lib/router.js";
import { postJson, keep, kept, scope } from "./lib/address.js";
import { count, day, dur, money, pct, shortModel } from "./lib/format.js";
import { badCount, card, cardTrend, cell, dataTable, empty, error, esc, heads, loadingLine, miss, notice, pageHead, say, selectBox, statCard, tiles } from "./lib/html.js";
import { NAMES } from "../../lib/naming.ts";
import { panelOf } from "./lib/chart.js";
import { flowOf, lastPeriod, usageCard, windowTrend } from "./lib/flow-parts.js";

const share = (v) => pct(v == null ? v : v * 100);
/** The OpenRouter spend period of a window: its UTC day, week or month; an hour reads the day. */
const SPEND = { hour: "day", day: "day", week: "week", month: "month" };

/** The OpenRouter tile: whether OpenRouter is up, over what it charged for the window's UTC period. */
function openRouterCard(m, win) {
  const v = m?.spend?.[SPEND[win] ?? SPEND.week];
  return statCard({ k: "OpenRouter", ...(m ? { v: m.down.includes("deepseek-v4.1-flash") ? "down" : "up", v2: v == null ? "–" : money(v) } : {}), q: ["status", "spend"], loading: m === undefined, failed: m === null ? "Could not load the models." : "" });
}

/** The Follow-ups card: the issues the factory's own actors filed in the window and all the issues filed, with its trend against the baseline (neutral). `d` is /api/flow for the window with `baseline`, or null while it loads. */
function followupsCard(d) {
  const v = d?.figures?.followups;
  const vs = !d || d.error ? {} : v == null ? { v: "–" } : { v: count(v), v2: count(d.figures.filed) };
  return statCard({ k: "Follow‑ups", ...vs, q: ["follow-ups", "filed"], trend: windowTrend(d, "followups", v, { kind: "relative", lowerIsGood: null, format: count }), loading: !d, failed: d?.error ?? "" });
}

/** The Success card: the share of runs that succeeded and the share of builds that passed first time, with the success trend against its baseline. */
function successCard(d) {
  const r = d?.agents?.rates;
  return statCard({ k: "Success", ...(r ? { v: share(r.success), v2: share(r.firstPass) } : d && !d.error ? { v: "–" } : {}), q: ["runs", "first pass"], trend: cardTrend(r?.success, r?.baseline, null, { kind: "points", lowerIsGood: false, format: share, basis: "the baseline" }), loading: !d, failed: d?.error ?? "" });
}

function scorecard(s, d, m, win) {
  const a = d?.agents;
  return usageCard(s) + openRouterCard(m, win) +
    statCard({ k: "Live agents", v: count(s.factory.liveRuns), ...(a ? { v2: count(a.live - a.workers) } : {}), q: ["workers", "other"], loading: !d, failed: d?.error ?? "" }) +
    followupsCard(d) + successCard(d);
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
  const box = (key, label) => `<input type="checkbox" data-name="${esc(key)}" aria-label="${label} enabled"${set[key].enabled ? " checked" : ""}> `;
  // A row per size and role: the figures of the model it is set to (with no setting, of the model it ran on last), then under ▸ a sub-row per earlier model.
  const line = (key, label, rs) => {
    const last = [...rs].sort((x, y) => (y.to ?? "").localeCompare(x.to ?? ""));
    const now = set[key]?.model ?? last[0]?.model, cur = rs.find((o) => shortModel(o.model) === shortModel(now));
    const past = last.filter((o) => o !== cur), off = key in SIZES && set[key] && !set[key].enabled, shut = !open.has(key);
    const fold = past.length ? `<button class="fold" data-fold="${esc(key)}" aria-expanded="${!shut}" aria-label="Earlier models of ${label}">${shut ? "▸" : "▾"}</button> ` : `<span class="fold" aria-hidden="true"></span> `;
    const ctrl = !set[key] ? esc(shortModel(now)) : `${key in SIZES ? box(key, label) : ""}${off ? `<span class="quiet" title="Goes to ${goesTo(key, set)}">Off</span>` : sel(key, label)}`;
    return `<tr><td class="wide" title="${label}">${label}</td><td>${fold}${ctrl}</td>${off ? `<td colspan="${num.length + 1}"></td>` : stats(cur)}</tr>` +
      (shut ? "" : past.map((o) => `<tr class="sub-row"><td></td><td>${esc(shortModel(o.model))} <span class="quiet">${day(o.from)} – ${day(o.to)}</span></td>${stats(o)}</tr>`).join(""));
  };
  const of = (role, size) => outs.filter((o) => o.role === role && (size === undefined || o.size === size));
  const grp = (t) => `<tr class="grp"><th colspan="${num.length + 3}">${t}</th></tr>`;
  const rows = grp("Workers") + Object.entries(SIZES).map(([k, l]) => line(k, l, of("worker", k))).join("") + line("unsized", "Unsized", of("worker", null)) +
    grp("Other") + Object.entries(ROLE_MODELS).map(([k, r]) => line(k, NAMES[r], of(r))).join("");
  return m || outs.length ? dataTable(heads(["Agent", "Model", ...num, "Output"], num), rows) : empty();
}

const timed = (a) => a.roles.filter((r) => r.hours != null);
/** The chart colours: the first six go to the first six roles of the fixed role list and the first six models of MODEL_ORDER, the seventh to `Other`. */
const ROLE_COLORS = ["series-1", "series-2", "series-3", "series-4", "series-5", "chart-6", "chart-7"];
const OWN = ROLE_COLORS.length - 1;
/** The models by short name, in the order of the model table (lib/models.ts, which the UI server does not serve); a model's colour is its place here, so it is the same in every window. */
export const MODEL_ORDER = ["haiku", "sonnet", "opus", "gpt-oss-20b", "deepseek-v4.1-flash", "gpt-6-luna", "minimax-m3.1-flash", "step-3.5-flash", "mimo-v2.6-flash"];

/** `keys` and `rows` with the `rest` keys folded into one `Other` key that holds their sum in each row; with no `rest`, unchanged. */
function withOther(keys, rest, rows) {
  if (!rest.length) return { keys, rows };
  return {
    keys: [...keys, { key: "Other", name: "Other", color: ROLE_COLORS[OWN] }],
    rows: rows.map((r) => {
      const row = { ...r, Other: rest.reduce((n, k) => n + (r[k] ?? 0), 0) };
      for (const k of rest) delete row[k];
      return row;
    }),
  };
}

/** The live frame: agents live per point, by role. The first six roles of the fixed role list keep their colours; the later ones fold into Other. */
export const liveFrame = (d) => {
  const on = (r) => timed(d.agents).includes(r), all = d.agents.roles;
  const { keys, rows } = withOther(all.slice(0, OWN).filter(on).map((r) => ({ key: r.key, name: r.name, color: ROLE_COLORS[all.indexOf(r)] })), all.slice(OWN).filter(on).map((r) => r.key), d.agents.points);
  return { measure: { name: "Agents Live", unit: "count", agg: "max" }, over: { kind: "time", window: d.window }, by: { name: "Role", keys }, rows };
};

/** A per-bucket frame by model: `field` is the bucket's value per model, `measure` what the chart plots. Ids with one short name join into one key; the first six models of MODEL_ORDER keep their colours and the others fold into Other. */
function modelFrame(d, field, measure) {
  const rows = (d.buckets ?? []).map((b) => {
    const row = { at: b.at };
    for (const [m, v] of Object.entries(b[field] ?? {})) row[shortModel(m)] = (row[shortModel(m)] ?? 0) + v;
    return row;
  });
  const has = (m) => rows.some((r) => m in r);
  const names = MODEL_ORDER.slice(0, OWN).filter(has).sort();
  const rest = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((m) => m !== "at" && !names.includes(m)).sort();
  const f = withOther(names.map((m) => ({ key: m, name: m, color: ROLE_COLORS[MODEL_ORDER.indexOf(m)] })), rest, rows);
  return { measure, over: { kind: "time", window: d.window }, by: { name: "Model", keys: f.keys }, rows: f.rows };
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
  const wait = d?.error ? error("Could not load the agents.", { detail: d.error }) : loadingLine("the agents");
  const head = scope().bar({ value: win });
  return `<div class="page sp" id="capacity">${pageHead("Agents", { aside: head })}${m?.local === "down" ? notice("Local server down", true) : ""}${tiles("Scorecard", scorecard(s, d, m, win))}` +
    (a ? `<div class="trio">${Object.entries(FRAMES).map(([k, fr]) => panelOf(key(k), fr(d))).join("")}</div>` : card("Agents", wait)) +
    card("Roles", a ? (m === null ? notice("Could not load the models.", true) : "") + roles(a, m) : wait, { id: "roles" }) + `</div>`;
}

/** The old address. */
export const redirect = (hash) => moved(hash, ["#/status/capacity"], "#/factory/agents");

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
    const [flow, models] = await Promise.all([flowOf(scope(q).window, q, true), get("/api/models").then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
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
      const m = await postJson("/api/models", { name: b.dataset.name, ...(b.type === "checkbox" ? { enabled: b.checked } : { model: b.value }) }).catch((err) => { say(b, err.message); if (b.type === "checkbox") b.checked = !b.checked; });
      if (m) await redraw(true);
    };
  },
};
