// The Agents page: the Roles list (each role's model, switch and success) and the Usage charts. `s` is /api/factory; the agents come from /api/flow for the window.
import { get, moved, redraw } from "./lib/router.js";
import { postJson, scope } from "./lib/address.js";
import { cardPct, count, day, dur, money, pct, shortModel } from "./lib/format.js";
import { cell, dataTable, empty, error, esc, heads, loadingLine, notice, row, say, selectBox, subHead } from "./lib/html.js";
import { NAMES } from "../../lib/naming.ts";
import { panelOf } from "./lib/chart.js";
import { flowOf, weekGone } from "./lib/flow-parts.js";
import { browse, inspector } from "./lib/browse.js";
import { rateBar } from "./lib/bars.js";
import { factsLine, figureBand, pageViews } from "./lib/page.js";

/** The OpenRouter spend period of a window: its UTC day, week or month; an hour reads the day. */
const SPEND = { hour: "day", day: "day", week: "week", month: "month" };

/** A row with fewer ended runs shows its counts, not a rate. */
const MIN_ENDED = 20;

/** The sizes by their label; the models each offers come from /api/models. */
const SIZES = { small: "Small", medium: "Medium", large: "Large" };
/** A worker row's label by key: a size, or the builds with none. */
const LABELS = { ...SIZES, unsized: "Unsized" };
/** The groups of the Roles list: each model setting's key and the role whose outcomes its row shows. */
const GROUPS = [
  ["Workers", [["small", "worker"], ["medium", "worker"], ["large", "worker"], ["unsized", "worker"]]],
  ["Review and Intake", [["review", "reviewer"], ["intake", "intake"], ["judge", "judge"]]],
  ["Oversight", [["director", "director"], ["monitor", "monitor"], ["housekeeper", "housekeeper"], ["maintainer", "maintainer"], ["investigator", "investigator"]]],
];

/** What waits while a role is off, for its Off title: no run starts, and no work fails. The review stays on: a build with no verdict holds for the user. */
const WAITS = {
  intake: "Issues wait unsorted", director: "Asks wait for you", monitor: "No daily reading", housekeeper: "Parked issues wait",
  maintainer: "Memory passes wait", judge: "Stop gate passes unjudged", investigator: "No investigations",
};
const LOCKED = { review: "A build needs its review to land" };

/** The noun of each role's output; a role not named here counts its OK runs. */
const NOUNS = { worker: "landed", reviewer: "verdicts", intake: "triages", director: "steps", monitor: "readings", housekeeper: "sweeps", judge: "calls" };

/** Where an off size's work goes, as route() picks it: the next size up that is on, else the next one down. */
function goesTo(key, set) {
  const ks = Object.keys(SIZES), i = ks.indexOf(key);
  return SIZES[[...ks.slice(i + 1), ...ks.slice(0, i).reverse()].find((k) => set[k]?.enabled)];
}

/** What a run made: landed builds for a worker, verdicts for the reviewer, OK runs for another role. */
const output = (o) => (o.role === "worker" ? o.built : o.role === "reviewer" ? o.pass + o.fail : o.succeeded);

/** The inspector of one role: the figures of its model, then each earlier model. */
function roleInspect(key, role, label, model, cur, past) {
  const out = cur ? output(cur) : 0;
  const kv = !cur ? [] : [
    ["Runs", esc(count(cur.runs))], ["Failed", cur.failed ? esc(count(cur.failed)) : ""], ["Error", cur.error ? esc(count(cur.error)) : ""],
    ["Success", esc(cardPct(cur.rate))], ["Baseline", cur.baseline == null ? "" : esc(cardPct(cur.baseline))],
    ["First Pass", cur.built ? esc(cardPct(cur.firstPass / cur.built)) : ""], ["Review Pass", cur.reviewPass == null ? "" : esc(cardPct(cur.reviewPass))],
    ["p50", esc(dur(cur.p50))], ["p95", esc(dur(cur.p95))], ["Cost", cur.cost ? esc(money(cur.cost)) : ""],
    ["Output", out ? esc(`${count(out)} ${NOUNS[role] ?? "runs"}`) : ""], ["Since", esc(day(cur.from))],
  ];
  const table = past.length ? subHead("Earlier Models") + dataTable(heads(["Model", "Until", "Runs", "Success", "Cost"], ["Runs", "Success", "Cost"]),
    past.map((o) => row([cell(shortModel(o.model)), cell(day(o.to)), cell(count(o.runs), { num: true }), cell(cardPct(o.rate), { num: true }), cell(o.cost ? money(o.cost) : "", { num: true })])).join("")) : "";
  return inspector({ id: key, title: model ? `${label} · ${shortModel(model)}` : label, rows: kv, body: table });
}

/** One role as a row: the switch and the model select, then runs, success, p50, cost and cost per output; a blank for no value. `m` is /api/models, or null while it loads or after it failed. */
function roleRow(key, role, outs, m) {
  const set = m?.models ?? {}, label = LABELS[key] ?? NAMES[role];
  const all = outs.filter((o) => o.role === role && o.runs && (role !== "worker" || (o.size ?? "unsized") === key));
  const last = [...all].sort((x, y) => (y.to ?? "").localeCompare(x.to ?? ""));
  const now = set[key]?.model ?? last[0]?.model, cur = all.find((o) => shortModel(o.model) === shortModel(now)), past = last.filter((o) => o !== cur);
  const off = set[key] && !set[key].enabled;
  const ctl = () => {
    const sw = `<input type="checkbox" data-name="${esc(key)}" aria-label="${esc(label)} on"${set[key].enabled ? " checked" : ""}${LOCKED[key] ? ` disabled title="${esc(LOCKED[key])}"` : ""}>`;
    const pick = selectBox(`${label} model`, key, m.offers[key].map((v) => ({ value: v, label: shortModel(v), disabled: m.down.includes(v) })), set[key].model, { id: `model-${key}`, attrs: ` data-name="${esc(key)}"` });
    return `<span class="rolectl">${sw}${off ? `<span class="quiet" title="${esc(key in SIZES ? `Goes to ${goesTo(key, set)}` : WAITS[key])}">Off</span>` : pick}</span>`;
  };
  const main = set[key] ? ctl() : esc(shortModel(now));
  const out = cur ? output(cur) : 0;
  const rate = !cur ? "" : cur.ended < MIN_ENDED ? esc(`${count(cur.succeeded)}/${count(cur.ended)}`) : rateBar(cur.rate, cur.baseline);
  return {
    key, lead: esc(label), main, text: `${label} ${role} ${now ?? ""}`, inspect: roleInspect(key, role, label, now, cur, past),
    cells: !cur || off ? ["", "", "", "", ""] : [esc(count(cur.runs)), rate, esc(dur(cur.p50)), cur.cost ? esc(money(cur.cost)) : "", out && cur.cost ? esc(money(cur.cost / out)) : ""],
  };
}

function rolesView(s, d, m, win) {
  const a = d?.agents;
  if (!a) return d?.error ? error("Could not load the agents.", { detail: d.error }) : loadingLine("the agents");
  const outs = a.outcomes ?? [], v = m?.spend?.[SPEND[win] ?? SPEND.week];
  if (!m && !outs.length) return empty();
  // The Unsized row has no setting, so it shows only when a build had no size.
  const groups = GROUPS.map(([title, all]) => {
    const keys = all.filter(([k]) => k !== "unsized" || outs.some((o) => o.role === "worker" && o.size == null));
    return { title, count: count(keys.length), heads: ["Runs", "Success", "p50", "Cost", "Per Output"], rows: keys.map(([k, r]) => roleRow(k, r, outs, m)) };
  });
  return factsLine([[count(a.live), `of ${count(a.cap)} live`], [count(a.roles.reduce((n, r) => n + r.runs, 0)), "runs"], [cardPct(a.rates.success), "success"], [v == null ? "–" : money(v), "OpenRouter"]]) +
    (m === null ? notice("Could not load the models.", true) : "") + browse({ id: "roles", label: "Roles", search: "Search roles", groups });
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

/** The usage view: the figure band, then the three chart panels. `d` is /api/flow for the window, or null while it loads. */
function usageView(s, d, m) {
  const a = d?.agents;
  if (!a) return d?.error ? error("Could not load the agents.", { detail: d.error }) : loadingLine("the agents");
  const u = s.usage?.now, gone = weekGone(u?.seven_day_resets_at, s.now), r = a.rates;
  const cost = (d.buckets ?? []).reduce((n, b) => n + Object.values(b.cost ?? {}).reduce((x, c) => x + c, 0), 0);
  return figureBand([
    { k: "Usage", v: u ? pct(u.seven_day) : "–", cmp: gone == null ? "" : `${pct(gone)} of week gone`, ...(gone == null ? {} : { trend: u.seven_day <= gone ? "good" : "warn" }) },
    { k: "Success", v: cardPct(r.success), cmp: `${cardPct(r.baseline)} baseline`, ...(r.baseline == null ? {} : { trend: r.success >= r.baseline ? "good" : "warn" }) },
    { k: "Peak Live", v: count(a.peak), cmp: `mean ${a.mean}`, title: `cap ${count(a.cap)} workers` },
    { k: "Cost", v: money(cost), cmp: m?.spend?.[SPEND[d.window] ?? SPEND.week] == null ? "" : `${money(m.spend[SPEND[d.window] ?? SPEND.week])} OpenRouter` },
  ]) + `<div class="trio">${Object.entries(FRAMES).map(([k, fr]) => panelOf(key(k), fr(d))).join("")}</div>`;
}

/** The page body. `d` is /api/flow for the window, or null while it loads. `m` is /api/models: undefined while it loads, null when it failed. */
export function renderFactoryAgents(s, d, q = new URLSearchParams(), m) {
  const win = d?.window ?? scope(q).window;
  return pageViews({ title: "Agents", path: "/factory/agents", query: q, views: [
    { id: "roles", label: "Roles", scope: true, draw: () => rolesView(s, d, m, win) },
    { id: "usage", label: "Usage", scope: true, draw: () => usageView(s, d, m) },
  ] });
}

/** The old address. */
export const redirect = (hash) => moved(hash, ["#/status/capacity"], "#/factory/agents");

export const view = {
  path: "/factory/agents",
  title: "Agents",
  group: "factory",
  order: -1,
  icon: "robot",
  api: (_params, q = new URLSearchParams()) => scope(q).url("/api/factory"),
  live: true,
  refresh: 60,
  // `s.flow` is /api/flow for the window and `s.models` is /api/models, which `more` adds; the page draws without them first.
  render: (s, _params, q) => renderFactoryAgents(s, s.flow ?? null, q, s.models),
  more: async (s, q) => {
    const [flow, models] = await Promise.all([flowOf(scope(q).window, q, true), get("/api/models").then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
    return { ...s, flow, models };
  },
  mount: (root, s) => {
    scope().wire(root);
    if (s.flow?.agents) for (const [k, fr] of Object.entries(FRAMES)) { const el = root.querySelector(`aleph-chart[key="${key(k)}"]`); if (el) el.frame = fr(s.flow); }
    root.onchange = async (e) => {
      const b = e.target.closest?.(".browse [data-name]");
      if (!b || e.type !== "change") return;
      const m = await postJson("/api/models", { name: b.dataset.name, ...(b.type === "checkbox" ? { enabled: b.checked } : { model: b.value }) }).catch((err) => { say(b, err.message); if (b.type === "checkbox") b.checked = !b.checked; });
      if (m) await redraw(true);
    };
  },
};
