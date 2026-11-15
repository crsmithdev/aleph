// The Agents page: the usage, the slots and who used them. `s` is /api/factory; the agents come from /api/flow for the window.
import { get, redraw } from "../router.js";
import { postJson, card, cardTrend, cell, count, dataTable, dur, empty, error, esc, heads, loadingLine, miss, money, pageHead, pct, row, say, selectBox, setting, settings, shortModel, statCard, statusLight, tiles, tone, scope } from "../lib.js";
import { NAMES } from "../../lib/naming.ts";
import { panelOf } from "../chart.js";
import { flowOf, lastPeriod, usageCard } from "./speed.js";

const share = (v) => pct(v == null ? v : v * 100);
/** The OpenRouter spend period of a window: its UTC day, week or month; an hour reads the day. */
const SPEND = { hour: "day", day: "day", week: "week", month: "month" };

/** The Spend tile: what OpenRouter charged, read from OpenRouter, for the window's UTC period. */
function spendCard(m, win) {
  if (m === undefined) return statCard({ k: "Spend", v: "–", note: "OpenRouter", loading: true });
  const v = m?.spend?.[SPEND[win] ?? SPEND.week];
  return statCard({ k: "Spend", v: v == null ? "–" : money(v), note: "OpenRouter" });
}

/** The Backends tile: how many backends are up, with a light for the local server and one for OpenRouter. */
function backendsCard(m) {
  const light = (name, up) => statusLight(up == null ? "" : up ? "fine" : "alert", `${name}: ${up == null ? "–" : up ? "up" : "down"}`);
  const local = m ? m.local === "up" : null, router = m ? !m.down.includes("deepseek-v4.1-flash") : null;
  const extra = `<span class="lights">${light("Local server", local)}${light("OpenRouter", router)}</span>`;
  if (!m) return statCard({ k: "Backends", v: "–", extra, loading: m === undefined });
  return statCard({ k: "Backends", v: count(Number(local) + Number(router)), v2: count(2), q: ["up", "backends"], extra });
}

function scorecard(s, m, win) {
  const f = s.factory;
  return usageCard(s) + spendCard(m, win) +
    statCard({ k: "Worker slots", v: count(f.liveRuns ?? 0), v2: count(f.liveCap), q: ["in use", "cap"] }) +
    backendsCard(m);
}

/** A success rate under this line (0 to 1) shows in the warn tone. */
const WARN_RATE = 0.7;

/** The sizes by their label; the models each offers come from /api/models. */
const SIZES = { small: "Small", medium: "Medium", large: "Large" };
/** Each role model's role, whose name and outcomes its rows show; the models it offers come from /api/models. */
const ROLE_MODELS = { review: "reviewer", intake: "intake", director: "director", monitor: "monitor", title: "title", judge: "judge" };

function roles(a, m) {
  const num = ["Jobs", "Success", "p50", "Cost"];
  const names = Object.fromEntries(a.roles.map((r) => [r.key, r.name]));
  const gone = `<td class="num">${miss("no runs in this window")}</td>`;
  const outs = a.outcomes ?? [];
  // The outcome row for a config row: the one of its role and current model. A reviewer records no model, so its row is the one of its role.
  const find = (role, model) => outs.find((x) => x.role === role && (role === "reviewer" || shortModel(x.model) === shortModel(model)));
  const stats = (o) => {
    if (!o) return `${gone.repeat(num.length)}<td>${miss("no runs in this window")}</td>`;
    const trend = cardTrend(o.rate, o.baseline, null, { kind: "points", lowerIsGood: false, format: share, basis: "the baseline", tip: `Baseline ${share(o.baseline)}` });
    const warn = o.rate != null && o.rate < WARN_RATE ? " warn" : "";
    return `${cell(count(o.runs), { num: true })}<td class="num${warn}">${esc(share(o.rate))} ${trend}</td>${cell(dur(o.p50), { num: true })}${cell(money(o.cost), { num: true })}<td><a class="failed-jobs" href="#/factory/jobs?role=${esc(o.role)}&state=failed">Failed jobs</a></td>`;
  };
  /** The worker outcome rows as one, for the one Worker row: the counts add, and the rate is its succeeded over its ended runs. */
  const allWorkers = () => {
    const rs = outs.filter((o) => o.role === "worker");
    const n = (k) => rs.reduce((x, o) => x + (o[k] ?? 0), 0), ended = n("succeeded") + n("failed") + n("stuck");
    return rs.length ? { role: "worker", runs: n("runs"), succeeded: n("succeeded"), failed: n("failed"), stuck: n("stuck"), rate: ended ? n("succeeded") / ended : null, cost: n("cost") } : null;
  };
  const model = (t) => shortModel(t?.model);
  const workerRow = () => row([cell("Worker", { wide: true }), cell(Object.keys(SIZES).map((k) => model(m.models[k])).join(", ")), stats(allWorkers())]);
  const pick = ([key, role]) => row([cell(NAMES[role], { wide: true }), cell(model(m.models[key])), stats(find(role, m.models[key]?.model))]);
  const setRoles = new Set(["worker", "merge", ...Object.values(ROLE_MODELS)]);
  const config = m ? workerRow() + Object.entries(ROLE_MODELS).map(pick).join("") : "";
  const rows = config + (m ? outs.filter((o) => !setRoles.has(o.role)) : outs).map((o) => row([cell(names[o.role] ?? o.role, { wide: true }), cell(shortModel(o.model)), stats(o)])).join("");
  return rows ? dataTable(heads(["Role", "Model", ...num, "Failed Jobs"], num), rows) : empty();
}

const timed = (a) => a.roles.filter((r) => r.hours != null);
/** The colour of the role at index `i` of the fixed role list, so a role keeps its colour in every window; the cost chart's keys take them in order. */
const ROLE_COLORS = ["series-1", "series-2", "series-3", "series-4", "series-5", "chart-6", "chart-7"];

/** The model of each size and role model, and whether small and medium are on. A row applies on change. */
function models(m) {
  const sel = (key, label, id) => selectBox(`${label} model`, key, (m.offers[key] ?? []).map((v) => ({ value: v, label: shortModel(v), disabled: m.down.includes(v) })), m.models[key]?.model, { id, attrs: ` data-name="${esc(key)}"` });
  const size = ([key, label]) => setting(label, (key === "large" ? "" : `<input type="checkbox" data-name="${esc(key)}" aria-label="${label} enabled"${m.models[key]?.enabled ? " checked" : ""}> `) + sel(key, label, `model-${key}`), { id: `model-${key}` });
  return settings("Models", [...Object.entries(SIZES).map(size), ...Object.entries(ROLE_MODELS).map(([key, role]) => setting(NAMES[role], sel(key, NAMES[role], `model-${key}`), { id: `model-${key}` }))]);
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
    by: { name: "Outcome", keys: [{ key: "succeeded", name: "Succeeded", color: "done" }, { key: "failed", name: "Failed", color: tone("failed") }, { key: "stuck", name: "Stuck", color: "stuck" }] },
    rows: d.agents.roles.filter((r) => rows.some((o) => o.role === r.key)).map((r) => ({ name: r.name, succeeded: sum(r, "succeeded"), failed: sum(r, "failed"), stuck: sum(r, "stuck") })),
  };
}

/** The cost frame: cost per bucket, by model. */
export function costFrame(d) {
  const all = [...new Set((d.buckets ?? []).flatMap((b) => Object.keys(b.cost ?? {})))].sort();
  // At most seven keys: past that, the models after the sixth fold into Other.
  const rest = all.length > ROLE_COLORS.length ? all.slice(ROLE_COLORS.length - 1) : [];
  const keys = all.slice(0, all.length - rest.length).map((m) => ({ key: m, name: shortModel(m) }));
  if (rest.length) keys.push({ key: "Other", name: "Other" });
  return {
    measure: { name: "Cost", unit: "usd", agg: "sum" },
    over: { kind: "time", window: d.window },
    by: { name: "Model", keys: keys.map((k, i) => ({ ...k, color: ROLE_COLORS[i] })) },
    rows: (d.buckets ?? []).map((b) => {
      const row = { at: b.at, ...b.cost };
      if (rest.length) { row.Other = rest.reduce((n, m) => n + (row[m] ?? 0), 0); for (const m of rest) delete row[m]; }
      return row;
    }),
  };
}

const FRAMES = { live: liveFrame, outcomes: outcomesFrame, cost: costFrame };
const key = (k) => `factory/agents/${k}`;

/** The page body. `d` is /api/flow for the window, or null while it loads. `m` is /api/models: undefined while it loads, null when it failed. */
export function renderFactoryAgents(s, d, _key = "live", window = "week", m) {
  const win = d?.window ?? window, w = { window: win }, a = d?.agents ?? null;
  const wait = d?.error ? error(d.error) : loadingLine("the agents");
  const head = scope().bar({ value: win });
  return `<div class="page sp" id="capacity">${pageHead("Agents", { aside: head })}${tiles("Scorecard", scorecard(s, m, win))}` +
    (a ? `<div class="trio">${Object.entries(FRAMES).map(([k, fr]) => panelOf(key(k), fr(d))).join("")}</div>` : card("Agents", wait)) +
    card("Roles", a ? roles(a, m) : wait, { id: "roles" }) + (m === undefined ? card("Models", loadingLine("the models"), { id: "models" }) : m ? card("Models", models(m), { id: "models" }) : "") + `</div>`;
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
    const [flow, models] = await Promise.all([flowOf(scope(q).window, q), get("/api/models").then((r) => r.json()).catch(() => null)]);
    return { ...s, flow, models };
  },
  mount: (root, s) => {
    scope().wire(root);
    if (s.flow?.agents) for (const [k, fr] of Object.entries(FRAMES)) root.querySelector(`aleph-chart[key="${key(k)}"]`).frame = fr(s.flow);
    root.onchange = async (e) => {
      const b = e.target.closest?.("#models [data-name]");
      if (!b || e.type !== "change") return;
      const m = await postJson("/api/models", { name: b.dataset.name, ...(b.type === "checkbox" ? { enabled: b.checked } : { model: b.value }) }).catch((err) => say(b, err.message));
      if (m) await redraw(true);
    };
  },
};
