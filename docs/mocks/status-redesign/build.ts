// Builds the Status redesign mocks: three directions, each drawn for the busy and the quiet state of data.json, from
// the helpers of ui/views/lib. Run: bun docs/mocks/status-redesign/build.ts
import { actButton, barList, barRow, card, cardTrend, cell, dataTable, empty, esc, filterBar, heads, idLink, legendHtml, linkButton, meter, row, searchBox, sectionHead, seg, sideStats, splitCard, statCard, statusLight, subHead, tag, tiles, tone } from "../../../ui/views/lib/html.js";
import { cardPct, clock, count, dur, hours, money, pct, plural, shortModel, when } from "../../../ui/views/lib/format.js";
import { heraldRow } from "../../../ui/views/lib/feed.js";
import { askCard, askShell, metaRow } from "../../../ui/views/lib/ask-cards.js";
import { setCodes } from "../../../lib/naming.ts";

setCodes({ aleph: "a" });

const dir = import.meta.dir, d = await Bun.file(`${dir}/data.json`).json();
const side = (await Bun.file(`${dir}/parts/navside.html`).text()).trim();
/** Item links go to the live UI, so a click in the mock opens the real issue or job. */
const LIVE = "http://aleph.home/", CI = "https://github.com/crsmithdev/aleph/actions";
const F = d.flow, f = F.figures, base = F.baseline.base, prev = F.baseline.prev, basis = F.baseline.basis;

type State = typeof d.busy;
const shown = (key: string) => (key.startsWith("issue.") ? `a${key.slice(6)}` : key.startsWith("job.") ? `j${key.slice(4)}` : key);
const to = (key: string) => (key.startsWith("issue.") ? `${LIVE}#/issues/aleph/${key.slice(6)}` : `${LIVE}#/jobs/${key}`);
const link = (key: string) => idLink(shown(key), to(key));
/** A stage's word in a chip: a build job is the Implement stage. */
const STAGE: Record<string, string> = { intake: "intake", build: "implement", review: "review", recheck: "recheck", land: "land" };
const ORDER = ["intake", "build", "review", "recheck", "land"];
const cap = (word: string) => word[0].toUpperCase() + word.slice(1);
const roleOf = (k: string) => F.agents.roles.find((r: any) => r.key === k);
/** The usual time of a stage's run this week, in seconds: its median and its slow end (p90, or p95 where the API gives that). */
const USUAL: Record<string, [number, number]> = {
  intake: [roleOf("intake").p50, roleOf("intake").p95], build: [F.phases.implement.p50, F.phases.implement.p90],
  review: [roleOf("reviewer").p50, roleOf("reviewer").p95], land: [F.phases.land.p50, F.phases.land.p90],
};
/** A card's duration, as cardDur() of ui/views/lib/flow-parts.js gives it (that module loads the router, which needs a page). */
const cardDur = (s: number) => (!(s >= 600) ? dur(s) : Math.round(s / 60) < 60 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

// ---- What each state holds ----

/** The asks and the alert of the busy state: real items of 2026-11-20, shown together (README, Data). */
const NEEDS = {
  ci: { at: "2026-11-20T17:45:00Z", title: "GitHub CI is broken", line: "aleph CI on main failed 2 runs in a row at 77a1fbe. The fix is a3403." },
  asks: [
    {
      id: "aleph-3397", href: `${LIVE}#/issues/aleph/3397`, repo: "aleph", key: "issue:aleph-3397", card: "unstick", reason: "run-cap", label: "Unstick", tag: "capped", escalated: true,
      title: "Give a select its hover state", headline: "Give a select its hover state", priority: "medium", at: "2026-11-20T18:10:11Z", since: "2026-11-20T18:10:11Z",
      situation: "The issue hit its run cap after 4 runs. The last run failed only the 390 px ellipsis check on #/hooks, which a3405 fixes.",
      actions: [
        { label: "Run again", act: "continue", path: "/api/issues/aleph-3397/rerun", primary: true, recommended: true, hint: "Runs it again after a3405 lands." },
        { label: "Drop", act: "discontinue", path: "/api/issues/aleph-3397/drop", confirm: true, hint: "Drops the issue and its branch." },
      ],
      always: { label: "Always run again", action: "continue", reason: "run-cap", scope: "project", hint: "Restarts an issue at its hourly cap without an Ask.", risk: "Restarts an issue at its hourly cap." },
    },
    {
      id: "aleph-3359", href: `${LIVE}#/issues/aleph/3359`, repo: "aleph", key: "issue:aleph-3359", card: "approve", reason: "held-path", label: "Approve", tag: "protected", escalated: true,
      title: "Name the file and rule on a protected-file land line", headline: "Name the file and rule on a protected-file land line", priority: "medium", at: "2026-11-20T06:00:23Z", since: "2026-11-20T06:00:23Z",
      situation: "The run changes the held path `jobs/lib/gates/gate.ts`, so its land is yours. Its checks and its review passed.",
      actions: [
        { label: "Land", act: "approve", path: "/api/jobs/job.10477/land", primary: true, recommended: true, confirm: true, hint: "Lands the change on main." },
        { label: "Drop", act: "disapprove", path: "/api/jobs/job.10477/drop", confirm: true, hint: "Discards the branch; the issue stays open." },
      ],
      always: { label: "Always land", action: "approve", reason: "held-path", scope: "project", hint: "Lands a held-path change after its checks and review pass.", risk: "Lands held-path changes unseen." },
    },
  ],
};

/** What a state shows, read from its jobs, holds and events. */
function derive(st: State, key: "busy" | "quiet") {
  const T = Date.parse(st.now), busy = key === "busy";
  const live = st.jobs.filter((j: any) => j.live);
  const active = [...Map.groupBy(live.filter((j: any) => j.target), (j: any) => j.target)].map(([issue, js]: [string, any[]]) => {
    const [j] = js.sort((a, b) => Date.parse(b.started) - Date.parse(a.started));
    return { issue, title: j.title, role: j.role, model: j.model, elapsed: (T - Date.parse(j.started)) / 1000 };
  }).sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role) || b.elapsed - a.elapsed);
  const holder = (job: string) => st.jobs.find((j: any) => j.id === job)?.target;
  const waiting = st.held.filter((h: any) => !h.detail.startsWith("job:")).map((h: any) => {
    const [reason, on, by] = h.detail.split(": ");
    return { ...h, reason, on, by: by ? holder(by) : null };
  });
  const ended = st.jobs.filter((j: any) => !j.live && j.ended);
  const bad = ended.filter((j: any) => j.last === "failed" || j.last === "returned");
  const lands = ended.filter((j: any) => j.role === "land"), badLands = lands.filter((j: any) => j.last === "failed");
  const repeat = [...Map.groupBy(bad.filter((j: any) => j.role === "build" && j.target), (j: any) => j.target)].map(([issue, js]: [string, any[]]) => ({ issue, title: js[0].title, runs: js.length, cost: js.reduce((n, j) => n + (j.cost ?? 0), 0) })).filter((r) => r.runs >= 2 && !(busy && NEEDS.asks.some((a) => a.id === `aleph-${r.issue.slice(6)}`))).sort((a, b) => b.runs - a.runs);
  const landed = st.events.filter((e: any) => e.action === "landed" && e.role === "land").reverse();
  const needs = busy ? NEEDS.asks : [];
  const usage = busy ? st.usage : d.usage.seven_day;
  const gone = Math.min(100, Math.max(0, 100 - ((Date.parse(d.usage.resets) - T) / (7 * 86_400_000)) * 100));
  // The oldest of the alert and the Asks: how long Chris has kept the factory waiting.
  const since = busy ? Math.min(...[NEEDS.ci.at, ...needs.map((i) => i.at)].map((at) => Date.parse(at))) : null;
  return { key, T, busy, st, active, waiting, lands, badLands, repeat, landed, needs, since, usage, gone, workers: live.filter((j: any) => j.role === "build").length };
}
type View = ReturnType<typeof derive>;

// ---- Shared parts ----

/** The page head: the time, the status sentence in its tone, the window and Pause. The live markup of 2026-11-21. */
function head(v: View) {
  const say = v.busy ? `<span class="say error">Alert: <a href="#needs">GitHub CI is broken</a>; <a href="#needs">attention is needed</a>.</span>`
    : `<span class="say warning">Warning: <a href="#problems">OpenRouter has no credit</a>.</span>`;
  const win = seg("Window", ["Hour", "Day", "Week", "Month"].map((l) => ({ label: l, on: l === "Week", attrs: "" })));
  return `<header class="ph shead"><span class="asof">${esc(when(v.st.now, new Date(v.T)))}</span>${say}<div class="aside"><div class="fbar"><div class="fg"><select aria-label="Project"><option>All Projects (1)</option></select></div><div class="fg">${win}</div><div class="fg">${actButton("Pause", { act: "pause" }, { cls: "warn" })}</div></div></div></header>`;
}

/** The scorecard: one card per block of the page, in the page's order. Each card is the headline of its block and links to it. */
function scorecard(v: View) {
  const eff = (lost: number) => 1 - lost, waits = v.needs.length + (v.busy ? 1 : 0);
  const mem = d.memory.start.aleph, memPct = (mem.bytes / mem.budget) * 100;
  return tiles("Scorecard", [
    statCard({ k: "Needs You", v: count(waits), ...(v.since ? { v2: cardDur((v.T - v.since) / 1000), q: ["waiting", "oldest"] } : { note: "waiting" }), href: "#needs", title: "Asks and alerts that wait for Chris, and how long the oldest has waited" }),
    statCard({ k: "Working", v: count(v.active.length), v2: [count(v.waiting.length), count(0)], q: ["running", "waiting", "error"], href: "#now" }),
    statCard({ k: "Efficiency", v: cardPct(eff(f.lost)), v2: hours(f.hours), q: ["efficient", "lost"], href: "#efficiency", trend: cardTrend(eff(f.lost), eff(base.lost), eff(prev.lost), { basis, kind: "points", lowerIsGood: false, format: cardPct }) }),
    statCard({ k: "Lead Time", v: cardDur(f.leadP50), v2: cardDur(f.leadP90), q: ["p50", "p90"], href: "#flow", trend: cardTrend(f.leadP50, base.leadP50, prev.leadP50, { basis, kind: "relative", lowerIsGood: true, format: cardDur }) }),
    statCard({ k: "Usage", v: pct(v.usage), v2: pct(v.gone), q: ["used", "pace"], href: `${LIVE}#/factory/agents`, extra: meter(v.usage, `${pct(v.usage)} of the week's quota used, ${pct(v.gone)} of the week gone`, { mark: Math.round(v.gone) }) }),
    statCard({ k: "Memory", v: pct(memPct), note: "start context", href: "#memory", extra: meter([{ pct: memPct, cls: memPct >= 95 ? "m-need" : "" }], `${count(mem.bytes)} of ${count(mem.budget)} bytes of the aleph start context`) }),
  ].join(""), "scorecard");
}

/** The status lights of the things aleph runs on: a word for each state, not a colour alone. */
function lights(v: View) {
  const workers = statusLight(v.workers ? "fine" : "unknown", `Workers: ${v.workers} / ${F.agents.cap}`);
  const tick = d.automation.schedules.find((s: any) => s.name === "tick"), suite = d.automation.schedules.find((s: any) => s.name === "suite");
  const at = (iso: string) => clock(v.busy ? new Date(v.T - 22_000).toISOString() : iso);
  return `<span class="lights">${[
    workers,
    statusLight("fine", `Tick: ${at(tick.last)}`),
    v.busy ? statusLight("alert", "CI: red") : statusLight("fine", "CI: green"),
    statusLight("fine", `Suite: ${suite.result.split(";").every((r: string) => r.includes("green")) ? "green" : "red"}`),
    v.busy ? statusLight("fine", "Backends: up") : statusLight("alert", `${d.automation.backend.via}: no credit`),
    statusLight("fine", "Vault: pushed"),
  ].join("")}</span>`;
}

/** The alert card of a broken CI, in the Ask card structure and the error tone, as an errored job's card is today. */
function ciCard(v: View) {
  const meta = metaRow({ id: `<span class="id">main</span>`, chips: "", at: NEEDS.ci.at, since: NEEDS.ci.at, now: v.st.now });
  return askShell("error", `data-kind="error" data-card="unstick"`, "ci", meta, "Alert", NEEDS.ci.title, "red", `<p class="situation">${esc(NEEDS.ci.line)}</p>`,
    `<div class="actions">${linkButton("CI run", CI)}${linkButton("a3403", `${LIVE}#/issues/aleph/3403`)}</div>`);
}

/** Needs You as cards: the alert, then each Ask as its card. Nothing when nothing waits. */
function needsCards(v: View) {
  if (!v.busy) return "";
  return `<section id="needs" class="needs" aria-label="Needs You">${sectionHead("Needs You", { count: count(v.needs.length + 1) })}<div class="list">${ciCard(v)}${v.needs.map((i) => askCard(i, v.st.now)).join("")}</div></section>`;
}

/** The rows of the problems the factory sees: each a tone, a word, what it is, its value and the usual value. */
function problemRows(v: View) {
  const m = d.monitor, hold = (k: string) => m.holds.find((h: any) => h.kind === k), stage = (k: string) => m.stages.find((s: any) => s.stage === k);
  const on = `on ${Number(m.day.slice(5, 7))}/${Number(m.day.slice(8))}`;
  const landUsual = F.stages.find((s: any) => s.stage === "land"), runsPer = F.stages.find((s: any) => s.stage === "build");
  const mem = d.memory.start.aleph, rows: { tone: string; word: string; what: string; detail: string; value: string; usual: string }[] = [];
  const landShare = v.lands.length ? v.badLands.length / v.lands.length : 0, landBase = landUsual.unusable / landUsual.runs;
  if (v.busy) {
    // A stage is a problem at 3 failed runs or more and one and a half times its usual share.
    if (v.badLands.length >= 3 && landShare >= 1.5 * landBase) rows.push({ tone: "error", word: "land", what: "Lands failed", detail: `${count(v.badLands.length)} of ${plural(v.lands.length, "land")} in 2h`, value: pct(landShare * 100), usual: pct(landBase * 100) });
    for (const r of v.repeat.slice(0, 2)) rows.push({ tone: "need", word: "rerun", what: `${link(r.issue)} ${esc(r.title)}`, detail: `${money(r.cost)} in 2h, none landed`, value: `${count(r.runs)} runs`, usual: (runsPer.runs / runsPer.items).toFixed(1) });
    const piles = [...Map.groupBy(v.waiting.filter((w: any) => w.reason === "file"), (w: any) => w.on)];
    for (const [file, ws] of piles as [string, any[]][]) rows.push({ tone: "need", word: "hold", what: `<code>${esc(file)}</code>`, detail: `${plural(ws.length, "issue")} wait on ${ws[0].by ? link(ws[0].by) : "a job"}`, value: count(ws.length), usual: hold("file").issues.trailing.toFixed(1) });
  } else {
    rows.push({ tone: "error", word: "backend", what: esc(d.automation.backend.via), detail: "402, no credit; a start that needs it waits", value: "down", usual: "up" });
    rows.push({ tone: "need", word: "holds", what: "File holds", detail: `${hours(hold("file").hours.day)} held ${on}`, value: count(hold("file").issues.day), usual: hold("file").issues.trailing.toFixed(1) });
    rows.push({ tone: "need", word: "land", what: "Lands with no result", detail: on, value: cardPct(stage("land").unusable.day), usual: cardPct(stage("land").unusable.trailing) });
    rows.push({ tone: "need", word: "cost", what: "Implement cost per issue", detail: on, value: money(stage("build").costPerItem.day), usual: money(stage("build").costPerItem.trailing) });
  }
  rows.push({ tone: "need", word: "memory", what: "Start context", detail: `${count(mem.budget - mem.bytes)} B left in aleph`, value: pct((mem.bytes / mem.budget) * 100), usual: "<95%" });
  return rows;
}

/** The alert and each Ask as Problems rows: the word in its tone, what it is with its actions, and how long it has waited. */
function alertRows(v: View) {
  if (!v.busy) return [];
  const waited = (iso: string) => dur((v.T - Date.parse(iso)) / 1000);
  const act = (label: string, primary = false) => actButton(label, { act: "mock" }, { kind: "small", primary });
  return [
    { tone: "error", word: "alert", what: `<span class="idp">main</span> ${esc(NEEDS.ci.title)}`, detail: esc(NEEDS.ci.line), acts: `<a class="act small" href="${CI}">CI run</a> <a class="act small" href="${LIVE}#/issues/aleph/3403">a3403</a>`, waited: waited(NEEDS.ci.at) },
    ...v.needs.map((i: any) => ({ tone: "need", word: i.label.toLowerCase(), what: `${idLink(`a${i.id.split("-")[1]}`, i.href)} ${esc(i.title)}`, detail: esc(i.situation.replace(/`/g, "")), acts: `${act(i.actions[0].label, true)} ${actButton(i.always.label, { act: "always" }, { kind: "small always" })} ${act(i.actions[1].label)}`, waited: waited(i.at) })),
  ];
}

/** Problems as a table: the word in its tone, what it is, and the value beside its usual value. `compact` leaves the detail out; `alerts` puts the alert and the Asks first, as tinted rows. */
function problems(v: View, { compact = false, alerts = false } = {}) {
  const rows = problemRows(v), asks = alerts ? alertRows(v) : [];
  // The first alert row takes the #needs anchor, which the head's sentence and the Needs You card link to.
  const top = asks.map((r, i) => `<tr class="palert t-${r.tone}"${i ? "" : ' id="needs"'}><td>${tag(r.word, r.tone)}</td><td class="wide"><span class="pwhat">${r.what}</span> <span class="pdetail">${r.detail}</span><div class="pacts">${r.acts}</div></td>${cell(r.waited, { num: true, title: "Waited" })}${cell("–", { num: true })}</tr>`);
  const body = rows.map((r) => row([`<td>${tag(r.word, r.tone)}</td>`, `<td class="wide"><span class="pwhat">${r.what}</span>${compact ? "" : ` <span class="pdetail">${r.detail}</span>`}</td>`, cell(r.value, { num: true }), cell(r.usual, { num: true })]));
  const head = heads(["", "Problem", "Value", "Usual"], ["Value", "Usual"]), n = top.length + rows.length;
  return card("Problems", n ? dataTable(head, [...top, ...body].join("")) : empty(), { count: count(n), aside: alerts ? lights(v) : "", id: "problems" });
}

/** The fill of a run's elapsed time on the scale of its stage's slow end, with a mark at the median. Only a run past the slow end takes the need tone: half of all runs pass the median. */
function elapsedMeter(role: string, elapsed: number) {
  const [p50, slow] = USUAL[role] ?? [60, 300], share = Math.min(100, (elapsed / slow) * 100);
  const cls = elapsed > slow ? "m-need" : "c-run";
  return meter([{ pct: Math.max(share, 2), cls }], `${dur(elapsed)} of a usual ${dur(p50)}, slow at ${dur(slow)}`, { mark: Math.round((p50 / slow) * 100) });
}

/** The waiting issues by what they wait on: the hold's word, its object, the issues and how long the oldest has waited. */
function waitingRows(v: View) {
  const groups = [...Map.groupBy(v.waiting, (w: any) => `${w.reason}: ${w.on}`)] as [string, any[]][];
  return groups.map(([, ws]) => {
    const w = ws[0], on = w.reason === "file" ? `<code>${esc(w.on)}</code>${w.by ? ` ${link(w.by)}` : ""}` : link(w.on);
    const oldest = Math.min(...ws.map((x: any) => Date.parse(x.at)));
    return row([`<td>${tag(w.reason, "quiet")}</td>`, `<td>${on}</td>`, `<td class="wide">${ws.map((x: any) => `${link(x.issue)} <span class="wtitle">${esc(x.title ?? "")}</span>`).join(" · ")}</td>`, cell(dur((v.T - oldest) / 1000), { num: true })]);
  }).join("");
}

/** The waiting issues under a sub-head with their count, by what they wait on; nothing when nothing waits. */
const waitingPart = (v: View) => (v.waiting.length ? `<div class="sub-count" id="waiting">${subHead("Waiting")}<span class="count">${count(v.waiting.length)}</span></div>` + dataTable(heads(["Hold", "On", "Issues", "Waited"], ["Waited"]), waitingRows(v)) : "");

/** A column chart as SVG in chart colours, `h` px tall: a value over each bar, a label under it. */
function columns(values: number[], labels: string[], h = 64) {
  const n = values.length, w = 100 / n, most = Math.max(1, ...values), bar = h - 26;
  const bars = values.map((x, i) => {
    const bh = Math.max(x ? 2 : 0, (x / most) * bar), y = 12 + bar - bh;
    return `<rect x="${(i * w + w * 0.18).toFixed(2)}%" y="${y.toFixed(1)}" width="${(w * 0.64).toFixed(2)}%" height="${bh.toFixed(1)}" rx="2"></rect>` +
      `<text class="v" x="${(i * w + w / 2).toFixed(2)}%" y="${(y - 3).toFixed(1)}" text-anchor="middle">${esc(count(x))}</text>` +
      `<text x="${(i * w + w / 2).toFixed(2)}%" y="${h - 2}" text-anchor="middle">${esc(labels[i])}</text>`;
  }).join("");
  return `<svg class="cols" role="img" aria-label="${esc(values.map((x, i) => `${labels[i]} ${count(x)}`).join(", "))}" width="100%" height="${h}">${bars}</svg>`;
}
const dayLabel = (iso: string) => new Date(`${iso}T12:00`).toLocaleDateString("en-US", { weekday: "short" });

/** The lost hours of the week by cause, over every lost class, largest first; the causes past the first four fold into Other. */
function lostCauses() {
  const by = new Map<string, number>();
  for (const c of F.classes.filter((c: any) => c.lost)) for (const k of c.causes) by.set(k.name, (by.get(k.name) ?? 0) + k.hours);
  const all = [...by].sort((a, b) => b[1] - a[1]), top = all.slice(0, 4), rest = all.slice(4).reduce((n, [, h]) => n + h, 0);
  return rest > 0 ? [...top, ["Other", rest] as [string, number]] : top;
}

/** Efficiency as a card: the agent hours of the week by outcome on one bar, then the lost hours by cause. */
function efficiencyCard({ compact = false } = {}) {
  const classes = F.classes.filter((c: any) => c.hours > 0), all = f.kept + f.hours;
  const bar = meter(classes.map((c: any) => ({ pct: (c.hours / all) * 100, cls: `seg-${c.key}` })), classes.map((c: any) => `${c.key} ${hours(c.hours)}`).join(", "));
  const legend = legendHtml(classes.map((c: any) => [`${c.key} ${hours(c.hours)}`, `seg-${c.key}`]));
  const causes = lostCauses(), most = causes[0][1];
  const lost = barList(causes.map(([name, h], i) => barRow(esc(name), (h / most) * 100, hours(h), { top: i === 0 })).join(""));
  // The bar is the count of failed runs: Recheck's 9 of 13 is not a rate to read alone.
  const stages = F.stages.filter((s: any) => ORDER.includes(s.stage) && s.unusable > 0).sort((a: any, b: any) => b.unusable - a.unusable);
  const failed = barList(stages.map((s: any, i: number) => barRow(esc(cap(STAGE[s.stage])), (s.unusable / stages[0].unusable) * 100, `${count(s.unusable)} of ${count(s.runs)}`, { top: i === 0 })).join(""));
  return card("Efficiency", `<div class="wide-meter">${bar}</div>${legend}${subHead("Lost Time by Cause")}${lost}${compact ? "" : `${subHead("Failed Runs by Stage")}${failed}`}`, { aside: compact ? "" : `${hours(f.kept)} of ${hours(all)} reached main`, id: "efficiency" });
}

/** Flow as a card: the week's issues in and out, then each phase's median and slow end with the issues in it now. */
function flowCard(v: View) {
  // A review and a recheck run inside the Implement phase of /api/flow.
  const now: Record<string, number> = { intake: 0, queue: v.waiting.length, implement: 0, land: 0 };
  for (const a of v.active) now[a.role === "intake" || a.role === "land" ? a.role : "implement"]++;
  const slow = Math.max(...["intake", "queue", "implement", "land"].map((k) => F.phases[k].p90));
  const phases = barList(["intake", "queue", "implement", "land"].map((k) => { const p = F.phases[k]; return barRow(`${esc(cap(k))} <span class="count">${count(now[k])}</span>`, (p.p90 / slow) * 100, `${dur(p.p50)} / ${dur(p.p90)}`, { top: p.p90 === slow }); }).join(""));
  const stats = sideStats([
    { k: "Filed", v: count(f.filed) }, { k: "Landed", v: count(f.landed), state: "landed" }, { k: "Dropped", v: count(f.dropped) },
    { k: "First Pass", v: cardPct(F.firstPass), title: "Landed issues whose first run landed" }, { k: "Open", v: count(F.open.open), note: `+${count(F.open.parked)}`, title: `${plural(F.open.open, "open issue")}, ${plural(F.open.parked, "parked issue")}` }, { k: "Asks", v: count(F.asks.count), note: `${count(F.asks.manual)} yours`, title: `${count(F.asks.count)} Asks this week, ${count(F.asks.manual)} answered by Chris` },
  ]);
  return card("Flow", `${stats}${subHead("Time by Phase, p50 / p90")}${phases}${subHead("Landed per Day")}${columns(F.days.map((x: any) => x.landed), F.days.map((x: any) => dayLabel(x.day)), 120)}`, { aside: "7 days", id: "flow", cls: "flow" });
}

/** Memory as a split card: the start context against its budget and the offers per day; the six counts on the side. `compact` stacks the counts over the start context; `stacked` adds the offers under them. */
function memoryCard({ compact = false, stacked = false } = {}) {
  const m = d.memory;
  const start = barList(Object.entries<any>(m.start).map(([k, s]) => barRow(`${esc(k)} <span class="count">${count(s.core)} lines</span>`, (s.bytes / s.budget) * 100, `${count(s.bytes)} / ${count(s.budget)} B`, { top: s.bytes / s.budget >= 0.95 })).join(""));
  const days = m.offers, labels = days.map((_: number, i: number) => String(new Date(Date.parse(d.taken) - (9 - i) * 86_400_000).getDate()));
  const stats = sideStats([
    { k: "Notes", v: count(m.total) }, { k: "Offered", v: count(m.offered), note: "7 days", title: "Notes that recall offered to an agent in 7 days" },
    { k: "Never offered", v: count(m.never), title: "Notes that recall never offered" }, { k: "Unoffered reads", v: count(m.unofferedReads), note: "7 days", title: "Wiki reads in 7 days that no offer preceded" },
    { k: "Refused", v: count(m.refused), state: m.refused ? "failed" : "", title: "Notes that lint refuses" }, { k: "Stale", v: count(m.stale), note: `${count(m.late)} late`, title: `${count(m.stale)} notes past their re-check date, ${count(m.late)} by more than 30 days` },
  ]);
  const aside = statusLight("fine", `Maintain: ${clock(m.maintained)}`);
  const offers = `${subHead("Offers per Day")}${columns(days, labels)}`;
  if (compact || stacked) return card("Memory", `${stats}${subHead("Start Context")}${start}${stacked ? offers : ""}`, { aside, id: "memory", cls: stacked ? "memstack" : "" });
  return splitCard("Memory", `${subHead("Start Context")}${start}${offers}`, stats, { aside, id: "memory" });
}

// ---- The event viewer ----

const KIND: Record<string, string> = { failed: "problem", returned: "problem", dropped: "problem", landed: "landed", question: "ask", answered: "ask", escalated: "ask", held: "hold" };
const kindOf = (action: string) => KIND[action] ?? "other";
/** The filter of the event viewer: one segmented control and the search field. */
const eventFilter = (id: string) => `<div class="evbar">${filterBar([{ label: "Show", bare: true, name: "kind", options: [{ value: "", label: "All" }, { value: "problem", label: "Problems" }, { value: "landed", label: "Landed" }, { value: "ask", label: "Asks" }, { value: "hold", label: "Holds" }] }])}${searchBox(id, "", "Search ids and titles")}</div>`;

/** The Herald rows of the busy state: one row per issue from its newest event that says something, the older ones in its fold. */
function busyRows(v: View) {
  const SAY = ["landed", "failed", "returned", "dropped", "started", "filed", "question", "answered", "escalated", "reran"];
  const mark = (a: string) => (a === "landed" || a === "passed" || a === "done" ? "✓" : a === "failed" || a === "returned" ? "✗" : "");
  const by = [...Map.groupBy(v.st.events.filter((e: any) => String(e.target ?? e.object).startsWith("issue.") && e.title), (e: any) => e.target ?? e.object)] as [string, any[]][];
  return by.map(([issue, es]) => {
    const said = es.filter((e) => SAY.includes(e.action)).at(-1) ?? es.at(-1), older = es.filter((e) => e !== said && e.action !== "held" && e.action !== "running").reverse().slice(0, 5);
    const facts = (e: any) => [e.model && shortModel(e.model), e.started && e.ended && dur((Date.parse(e.ended) - Date.parse(e.started)) / 1000), e.cost != null && money(e.cost)].filter(Boolean).join(" · ");
    return {
      key: `issue ${issue}`, fold: `issue ${issue}`, at: said.at, by: said.by, word: said.action === "done" ? "closed" : said.action, id: [{ id: shown(issue), to: to(issue) }], text: [said.title ?? ""], more: older.length,
      lines: older.map((e) => ({ at: e.at, action: e.action, label: STAGE[e.role] ?? e.action, text: [...(String(e.object).startsWith("job.") ? [{ id: shown(e.object), to: to(e.object) }, " "] : []), ...(mark(e.action) ? [{ mark: mark(e.action) }, " "] : []), facts(e) || (e.detail ?? "")] })),
    };
  }).sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** The events as feed rows, newest first: the busy state's from its events, the quiet state's as the live Herald sent them. */
function feed(v: View, n: number) {
  const rows = v.busy ? busyRows(v) : v.st.herald;
  return rows.slice(0, n).map((r: any) => `<div data-kind="${kindOf(r.word)}" data-text="${esc(`${r.id.map((p: any) => p.id ?? p).join(" ")} ${r.text.join(" ")}`.toLowerCase())}">${heraldRow(r)}</div>`).join("");
}

/** The event viewer as a card of a set height, for a column that is not a rail. */
const eventsCard = (v: View) => card("Events", `${eventFilter(`ev-${v.key}`)}<div class="herald-feed">${feed(v, 16)}</div>`, { aside: statusLight("fine", "Live"), id: "events", cls: "events" });

/** The event viewer as a log table: one event a row, the time first, then what happened, to what, who did it and what it cost. */
function eventsLog(v: View) {
  // A run's start is its `running` event, shown as started; the rule's `started` on the issue repeats it, and a hold on the issue's own job says nothing.
  const es = v.st.events.filter((e: any) => !(e.action === "held" && String(e.detail).startsWith("job:")) && !(e.action === "started" && e.by === "rule") && !(String(e.target ?? e.object).startsWith("issue.") && !e.title)).slice(-18).reverse().map((e: any) => (e.action === "running" ? { ...e, action: "started", ended: null } : e));
  const rows = es.map((e: any) => {
    const issue = e.target ?? (String(e.object).startsWith("issue.") ? e.object : null), job = String(e.object).startsWith("job.") ? e.object : null;
    const took = e.started && e.ended ? dur((Date.parse(e.ended) - Date.parse(e.started)) / 1000) : "";
    const text = e.title ?? (e.role ? `${e.role} run` : e.detail ?? "");
    return `<tr data-kind="${kindOf(e.action)}" data-text="${esc(`${issue ? shown(issue) : ""} ${job ? shown(job) : ""} ${text}`.toLowerCase())}"><td class="time lead">${esc(clock(e.at))}</td><td>${tag(e.action, e.action === "started" ? "run" : tone(e.action))}</td><td>${issue ? link(issue) : ""}</td>` +
      `${cell(text, { wide: true })}<td>${job ? link(job) : ""}</td><td>${esc(STAGE[e.role] ?? e.role ?? e.by)}</td><td>${e.model ? esc(shortModel(e.model)) : ""}</td>${cell(e.cost != null && e.action !== "started" ? money(e.cost) : "", { num: true })}${cell(took, { num: true })}</tr>`;
  }).join("");
  const table = dataTable(heads(["Time", "Event", "Issue", "Title", "Job", "By", "Model", "Cost", "Took"], ["Cost", "Took"]), rows);
  return card("Events", `${eventFilter(`log-${v.key}`)}${table}<div class="pager">${actButton(`Next ${Math.min(50, v.st.total - es.length)}`, { act: "more" })}<span class="of">1–${es.length} of ${count(v.st.total)}</span></div>`, { aside: statusLight("fine", "Live"), id: "events", cls: "events" });
}

// ---- A: Briefing ----

/** Chris's notes of 11/23: the alerts and Asks join Problems, C's lanes and log replace Now and the feed, and Problems and the week's figures take the rail. */
const pageA = (v: View) => `${head(v)}${scorecard(v)}<div class="rail"><div class="rail-main">${motion(v, { running: true, waiting: true })}${eventsLog(v)}</div><div class="stack">${problems(v, { alerts: true })}${efficiencyCard()}${flowCard(v)}${memoryCard({ stacked: true })}</div></div>`;

// ---- B: Board ----

/** Everything that is wrong in one table, worst first: the alert and the Asks with their actions, then the problems. */
function triage(v: View) {
  const waited = (iso: string) => dur((v.T - Date.parse(iso)) / 1000);
  const act = (label: string, primary = false) => actButton(label, { act: "mock" }, { kind: "small", primary });
  const needs = !v.busy ? [] : [
    row([`<td>${tag("alert", "error")}</td>`, `<td><span class="idp">main</span></td>`, `<td class="wide"><span class="pwhat">${esc(NEEDS.ci.title)}</span> <span class="pdetail">${esc(NEEDS.ci.line)}</span></td>`, cell("", { num: true }), cell("", { num: true }), cell(waited(NEEDS.ci.at), { num: true }), `<td class="acts"><a class="act small" href="${CI}">CI run</a></td>`]),
    ...v.needs.map((i: any) => row([`<td>${tag(i.label.toLowerCase(), "need")}</td>`, `<td>${idLink(`a${i.id.split("-")[1]}`, i.href)}</td>`, `<td class="wide"><span class="pwhat">${esc(i.title)}</span> <span class="pdetail">${esc(i.situation.replace(/`/g, ""))}</span></td>`, cell("", { num: true }), cell("", { num: true }), cell(waited(i.at), { num: true }), `<td class="acts">${act(i.actions[0].label, true)} ${actButton(i.always.label, { act: "always" }, { kind: "small always" })} ${act(i.actions[1].label)}</td>`])),
  ];
  const probs = problemRows(v).map((r) => row([`<td>${tag(r.word, r.tone)}</td>`, "<td></td>", `<td class="wide"><span class="pwhat">${r.what}</span> <span class="pdetail">${r.detail}</span></td>`, cell(r.value, { num: true }), cell(r.usual, { num: true }), cell("", { num: true }), `<td class="acts"></td>`]));
  const all = [...needs, ...probs];
  return card("Attention", dataTable(heads(["", "Item", "What", "Value", "Usual", "Waited", ""], ["Value", "Usual", "Waited"]), all.join("")), { count: count(all.length), aside: lights(v), id: "needs", cls: "triage" });
}

/** The pipeline as a board: a column per stage with its week's median and failed share in the head, and the issues in it now under it. */
function board(v: View) {
  const stage = (k: string) => F.stages.find((s: any) => s.stage === k), failed = (k: string) => { const s = stage(k); return s ? pct((s.unusable / s.runs) * 100) : "–"; };
  const item = (a: any) => `<div class="bitem">${link(a.issue)}<span class="num">${esc(dur(a.elapsed))}</span><span class="t" title="${esc(a.title ?? "")}">${esc(a.title ?? "")}</span>${elapsedMeter(a.role, a.elapsed)}</div>`;
  const wait = (w: any) => `<div class="bitem">${link(w.issue)}<span class="num">${esc(dur((v.T - Date.parse(w.at)) / 1000))}</span><span class="t" title="${esc(w.title ?? "")}">${esc(w.title ?? "")}</span><span class="why">${tag(w.reason, "quiet")} ${w.reason === "file" ? `<code>${esc(w.on)}</code>` : link(w.on)}</span></div>`;
  const done = (e: any) => `<div class="bitem">${link(e.target)}<span class="num">${esc(clock(e.at))}</span><span class="t" title="${esc(e.title ?? "")}">${esc(e.title ?? "")}</span></div>`;
  const inStage = (roles: string[]) => v.active.filter((a) => roles.includes(a.role));
  const cols: [string, number, string, string][] = [
    ["Intake", inStage(["intake"]).length, `p50 ${dur(F.phases.intake.p50)} · failed ${failed("intake")}`, inStage(["intake"]).map(item).join("")],
    ["Queue", v.waiting.length, `p50 ${dur(F.phases.queue.p50)} · p90 ${dur(F.phases.queue.p90)}`, v.waiting.map(wait).join("")],
    ["Implement", inStage(["build"]).length, `p50 ${dur(F.phases.implement.p50)} · failed ${failed("build")}`, inStage(["build"]).map(item).join("")],
    ["Review", inStage(["review"]).length, `p50 ${dur(USUAL.review[0])} · failed ${failed("review")}`, inStage(["review"]).map(item).join("")],
    ["Land", inStage(["land"]).length, `p50 ${dur(F.phases.land.p50)} · failed ${failed("land")}`, inStage(["land"]).map(item).join("")],
    ["Landed", v.busy ? v.st.landedToday : d.quiet.landedToday, `${count(f.landed)} in 7 days`, v.landed.slice(0, 4).map(done).join("")],
  ];
  const idle = !v.active.length && !v.waiting.length;
  const col = ([name, n, stat, items]: [string, number, string, string]) => `<div class="bcol"><div class="bhead">${subHead(name)}<span class="count">${count(n)}</span></div><p class="bstat">${esc(stat)}</p>${idle && name !== "Landed" ? "" : items}</div>`;
  return card("Pipeline", `<div class="board">${cols.map(col).join("")}</div>`, { count: count(v.active.length), id: "now", cls: "boardcard" });
}

const pageB = (v: View) => `${head(v)}${scorecard(v)}${triage(v)}${board(v)}<div class="split">${eventsCard(v)}<div class="stack">${efficiencyCard({ compact: true })}${memoryCard({ compact: true })}</div></div>`;

// ---- C: Timeline ----

/** Each issue that ran in the window as a lane on one time axis: its runs as bars in the tone of their result, the waits between them striped. `running` keeps only the issues that run now; `waiting` adds the waiting issues under the lanes. */
function motion(v: View, { running = false, waiting = false } = {}) {
  const n = 12; // lanes above the fold
  const span = v.busy ? 3_600_000 : v.st.span, from = v.T - span, x = (t: number) => Math.min(100, Math.max(0, ((t - from) / span) * 100));
  const ticks = Array.from({ length: 5 }, (_, i) => from + (i * span) / 4);
  const by = [...Map.groupBy(v.st.jobs.filter((j: any) => j.target && (j.live || Date.parse(j.ended ?? j.started) >= from)), (j: any) => j.target)] as [string, any[]][];
  const lanes = by.map(([issue, js]) => {
    const runs = js.map((j) => ({ ...j, s: Math.max(from, Date.parse(j.started)), e: j.live ? v.T : Date.parse(j.ended ?? j.started) })).sort((a, b) => a.s - b.s);
    const live = runs.some((r) => r.live), last = runs.at(-1)!;
    return { issue, title: runs[0].title, runs, live, last, end: Math.max(...runs.map((r) => r.e)), cost: runs.reduce((c, r) => c + (r.cost ?? 0), 0) };
  }).filter((l) => !running || l.live).sort((a, b) => Number(b.live) - Number(a.live) || b.end - a.end);
  const toneOf = (r: any) => (r.last === "failed" || r.last === "returned" ? "bad" : r.role === "land" ? "land" : r.role === "build" ? "build" : "aux");
  const state = (l: any) => (l.live ? "running" : l.runs.some((r: any) => r.role === "land" && r.last === "landed") ? "landed" : l.last.last === "failed" || l.last.last === "returned" ? l.last.last : l.last.last === "dropped" ? "dropped" : "waiting");
  const lane = (l: any) => {
    const waits = l.runs.slice(1).map((r: any, i: number) => ({ s: l.runs[i].e, e: r.s })).filter((w: any) => w.e - w.s > span / 200);
    const at = (s: number, e: number) => `left:${x(s).toFixed(2)}%;width:${Math.max(0.3, x(e) - x(s)).toFixed(2)}%`;
    const label = (r: any) => (x(r.e) - x(r.s) > 20 ? STAGE[r.role] ?? r.role : "");
    return `<div class="dp-row"><div class="dp-tl"><div class="dp-head"><span class="t" title="${esc(l.title ?? "")}">${link(l.issue)} ${esc(l.title ?? "")}</span></div><div class="dp-lane">` +
      waits.map((w: any) => `<span class="dp-wait" style="${at(w.s, w.e)}" title="Waiting · ${esc(dur((w.e - w.s) / 1000))}"></span>`).join("") +
      l.runs.map((r: any) => `<a class="dp-bar t-${toneOf(r)}${r.live ? " live" : ""}" href="${to(r.id)}" style="${at(r.s, r.e)}" title="${esc(`${STAGE[r.role] ?? r.role} ${shown(r.id)} · ${r.live ? "running" : r.last} · ${dur((r.e - r.s) / 1000)}`)}">${esc(label(r))}</a>`).join("") +
      `</div><span class="dp-res">${tag(state(l), tone(state(l)))}</span><span class="num">${esc(dur((l.end - l.runs[0].s) / 1000))}</span><span class="num">${esc(money(l.cost))}</span></div></div>`;
  };
  const axis = `<div class="dp-tl dp-axis"><span>${plural(lanes.length, "issue")}</span><div class="dp-ticks">${ticks.map((t, i) => `<span${i === 4 ? ' class="end"' : ""} style="left:${i * 25}%">${esc(i === 4 ? "now" : clock(new Date(t).toISOString()))}</span>`).join("")}</div><span>State</span><span class="num">Took</span><span class="num">Cost</span></div>`;
  const legend = legendHtml([["implement", "t-build"], ["failed or returned", "t-bad"], ["land", "t-land"], ["intake, review", "t-aux"], ["waiting", "t-wait"]]);
  const spans = seg("Span", ["1h", "2h", "12h"].map((l) => ({ label: l, on: l === (v.busy ? "1h" : "12h"), attrs: "" })));
  const rest = lanes.length > n ? `<details class="more-lanes"><summary>${count(lanes.length - n)} more</summary>${lanes.slice(n, n + 30).map(lane).join("")}</details>` : "";
  const body = lanes.length ? `<div class="dp-scroll">${axis}${lanes.slice(0, n).map(lane).join("")}${rest}</div>` : empty();
  return card("Issues in Motion", `${legend}${body}${waiting ? waitingPart(v) : ""}`, { count: count(v.active.length), aside: `${statusLight(v.workers ? "fine" : "unknown", `Workers: ${v.workers} / ${F.agents.cap}`)}${spans}`, id: "now", cls: "motion" });
}

/** The week's efficiency and flow as six figures and the outcome bar, for a narrow column. */
function vitals() {
  const classes = F.classes.filter((c: any) => c.hours > 0), all = f.kept + f.hours;
  const bar = meter(classes.map((c: any) => ({ pct: (c.hours / all) * 100, cls: `seg-${c.key}` })), classes.map((c: any) => `${c.key} ${hours(c.hours)}`).join(", "));
  const [cause, lost] = lostCauses()[0];
  const stats = sideStats([
    { k: "Efficient", v: cardPct(1 - f.lost), title: "Agent hours that reached main" }, { k: "Lost", v: hours(f.hours), note: cause.toLowerCase().split(" or ")[0], title: `The largest cause: ${cause}, ${hours(lost)}` },
    { k: "Landed", v: count(f.landed), state: "landed" }, { k: "First Pass", v: cardPct(F.firstPass) },
    { k: "Lead p50", v: cardDur(f.leadP50) }, { k: "Lead p90", v: cardDur(f.leadP90) },
  ]);
  return card("Factory", `${stats}<div class="wide-meter">${bar}</div>${legendHtml(classes.map((c: any) => [`${c.key} ${hours(c.hours)}`, `seg-${c.key}`]))}`, { aside: "7 days", id: "efficiency" });
}

const pageC = (v: View) => `${head(v)}${scorecard(v)}<div class="split wide-left"><div class="stack">${motion(v)}${eventsLog(v)}</div><div class="stack">${needsCards(v)}${problems(v, { compact: true })}${vitals()}${memoryCard({ compact: true })}</div></div>`;

// ---- Pages ----

const PAGES: [string, string, string, (v: View) => string][] = [
  ["a-briefing.html", "A · Briefing", "The work and the event log down one column; Problems with the alerts over the week's figures in a rail", pageA],
  ["b-board.html", "B · Board", "One triage table, then the pipeline as a live board", pageB],
  ["c-timeline.html", "C · Timeline", "Each issue as a lane in time, over the event log", pageC],
];
const views = { busy: derive(d.busy, "busy"), quiet: derive(d.quiet, "quiet") };

const SCRIPT = `
const KEY = "status-redesign", saved = JSON.parse(localStorage.getItem(KEY) || "{}"), THUMB = new URLSearchParams(location.search).has("thumb");
if (THUMB) document.documentElement.classList.add("thumb");
const STATES = ["busy", "quiet"], named = () => (STATES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "");
let state = named() || saved.state || "busy", theme = saved.theme || "";
// One state is in the page at a time, so an anchor such as #problems names one element.
function show() {
  document.getElementById("view").replaceChildren(document.querySelector(\`template[data-state="\${state}"]\`).content.cloneNode(true));
  for (const b of document.querySelectorAll("[data-set-state]")) b.setAttribute("aria-pressed", b.dataset.setState === state);
  for (const b of document.querySelectorAll("[data-set-theme]")) b.setAttribute("aria-pressed", b.dataset.setTheme === theme);
  if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  document.querySelector('#nav a[aria-current]')?.setAttribute("data-tone", state === "busy" ? "alert" : "warning");
  for (const a of document.querySelectorAll(".mockbar a[data-page]")) a.hash = state;
  if (!THUMB) localStorage.setItem(KEY, JSON.stringify({ state, theme }));
}
function filter(box) {
  const kind = box.querySelector('.seg [aria-pressed="true"]')?.dataset.value ?? "", q = (box.querySelector('input[type="search"]')?.value ?? "").trim().toLowerCase();
  for (const r of box.querySelectorAll("[data-kind]")) r.hidden = (kind && r.dataset.kind !== kind) || (q && !r.dataset.text.includes(q));
}
document.addEventListener("click", (e) => {
  const s = e.target.closest("[data-set-state]"), t = e.target.closest("[data-set-theme]"), k = e.target.closest('.events .seg button');
  if (s) { state = s.dataset.setState; show(); }
  if (t) { theme = t.dataset.setTheme; show(); }
  if (k) { for (const b of k.parentElement.children) b.setAttribute("aria-pressed", b === k); filter(k.closest(".events")); }
});
document.addEventListener("input", (e) => { if (e.target.matches('.events input[type="search"]')) filter(e.target.closest(".events")); });
addEventListener("hashchange", () => { if (named()) { state = named(); show(); } });
show();
`;

const mockbar = (file: string) => `<div class="mockbar"><b>Status redesign</b><a href="index.html">Overview</a>${PAGES.map(([f2, t]) => `<a data-page href="${f2}"${f2 === file ? ' aria-current="page"' : ""}>${esc(t)}</a>`).join("")}` +
  `<span class="mb-r"><span>State</span><span class="seg" role="group" aria-label="State"><button type="button" data-set-state="busy">Busy</button><button type="button" data-set-state="quiet">Quiet</button></span>` +
  `<span>Theme</span><span class="seg" role="group" aria-label="Theme"><button type="button" data-set-theme="">System</button><button type="button" data-set-theme="light">Light</button><button type="button" data-set-theme="dark">Dark</button></span></span></div>`;

const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,">
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/hack-font/3.3.0/web/hack.min.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn/styles/themes/default.css">
<script type="module" src="https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn/webawesome.loader.js"></script>
<link rel="stylesheet" href="app.css"><link rel="stylesheet" href="mock.css">`;

/** A page with each state in a template. A link of the live markup (`#/issues/…`) goes to the live UI. */
const page = (file: string, title: string, draw: (v: View) => string) => (`<!doctype html><html lang="en"><head><title>Status · ${esc(title)}</title>${HEAD}</head><body>${mockbar(file)}<div class="shell">${side}<main><div id="view"></div></main></div>` +
  (["busy", "quiet"] as const).map((k) => `<template data-state="${k}"><div class="page sp">${draw(views[k])}</div></template>`).join("") + `<script>${SCRIPT}</script></body></html>`).replaceAll('href="#/', `href="${LIVE}#/`);

for (const [file, title, , draw] of PAGES) await Bun.write(`${dir}/${file}`, page(file, title, draw));
await Bun.write(`${dir}/app.css`, await Bun.file(`${dir}/../../../ui/app.css`).text());

const thumb = (file: string, title: string, k: string) => `<a class="shot" href="${file}#${k}"><iframe src="${file}?thumb#${k}" title="${esc(`${title}, ${k}`)}" loading="lazy" tabindex="-1" scrolling="no"></iframe></a>`;
const index = `<!doctype html><html lang="en"><head><title>Status redesign</title>${HEAD}</head><body><div class="page sp overview"><header class="ph"><h1>Status Redesign</h1><span class="count">3 directions</span></header>` +
  `<p class="lede">Busy is the factory at 11/20 11:05. Quiet is the live state of 11/21 11:07. The week's figures are those of 11/21 in both. README.md gives the reason for each choice.</p>` +
  `<div class="trio">${PAGES.map(([file, title, line]) => `<section class="card"><div class="sh"><h2>${esc(title)}</h2></div><p>${esc(line)}</p>${subHead("Busy")}${thumb(file, title, "busy")}${subHead("Quiet")}${thumb(file, title, "quiet")}</section>`).join("")}</div></div>` +
  `<script>const fit = () => { for (const el of document.querySelectorAll(".shot")) el.style.setProperty("--k", el.clientWidth / 1600); }; addEventListener("resize", fit); fit();</script></body></html>`;
await Bun.write(`${dir}/index.html`, index);
console.log(PAGES.map(([file]) => file).join(", "), "and index.html written");
