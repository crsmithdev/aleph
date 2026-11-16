// The Status page (ui/views/now.js) as plain terminal text for a herdr side panel, for the week window, or with
// `--json` as data for the Herdr desktop app's mod.
// It reads the data in-process, as the routes of ui/api/now.ts and ui/api/speed.ts do, and redraws every 10 s and on a resize.
// `render` is the whole page as lines no wider than the pane; the rest of the file is the terminal loop.
import { baseline, figures, speed } from "../ui/api/speed.ts";
import { stateBody } from "../ui/api/now.ts";
import { currentFit } from "../ui/usage.ts";
import { verdict } from "../lib/status-words.ts";
import { clip, NAMES, parseId, parseKey, sayText, shortText, shownId, targetOf } from "../lib/naming.ts";
// @ts-ignore plain JS, shared with the page
import { cardTrend, clock, count, dur, hours, mean, pct, when } from "../ui/lib.js";
// @ts-ignore plain JS, shared with the page
import { cardHours, cardPct, pace } from "../ui/flow-parts.js";
import { errText } from "../lib/errtext.ts";

const REFRESH_MS = 10_000;
/** The colour of each tone of the status sentence: red, yellow or green. */
const TONES: Record<string, number> = { alert: 31, ask: 33, warning: 33, fine: 32 };
const paint = (code: number, t: string) => `\x1b[${code}m${t}\x1b[0m`;

/** The trend of the page's scorecard as text: the page draws it as HTML. */
const trend = (html: string) => html.replace(/<[^>]*>/g, "");

/** The scorecard of the page: each card's name, value, trend and what the value counts. */
function scorecard(s: any, d: any) {
  const f = d.figures, base = d.baseline?.base, prev = d.baseline?.prev, basis = d.baseline?.basis ?? "";
  const t = (key: string, o: object) => trend(base ? cardTrend(f[key], base[key], prev?.[key], { basis, ...o }) : "");
  const p = pace(s);
  return [
    { name: "Lost time", value: `${cardPct(f.lost)} / ${cardHours(f.hours)}`, trend: t("lost", { kind: "points", lowerIsGood: true, format: cardPct }), note: "lost / hours" },
    { name: "Completion", value: `${dur(f.leadP50)} / ${dur(f.leadP90)}`, trend: t("leadP50", { kind: "relative", lowerIsGood: true, format: dur }), note: "p50 / p90" },
    { name: "Landed", value: `${cardPct(f.firstPass)} / ${count(f.landed)}`, trend: t("firstPass", { kind: "points", lowerIsGood: false, format: cardPct }), note: "clean / landed" },
    { name: "Jobs", value: `${count(s.factory.liveRuns)} / ${count((s.queued ?? []).length)}`, trend: "", note: "running / queued" },
    { name: "Usage", value: s.usage?.now ? pct(s.usage.now.seven_day) : "–", trend: "", note: s.usage?.stale ? "stale" : p ? `${p.word} pace` : s.usage?.now ? "live" : "" },
  ];
}

/** Agent Time: the hours of each outcome class, and the kept and total hours. */
function agentTime(d: any) {
  const classes = (d.classes ?? []).filter((c: any) => c.hours > 0).map((c: any) => ({ key: c.key, lost: c.lost, hours: c.hours }));
  const sum = (cs: any[]) => cs.reduce((a, c) => a + c.hours, 0);
  return { classes, kept: sum(classes.filter((c: any) => !c.lost)), all: sum(classes) };
}

/** The health of a stage by its failed share, as on the page: under 10% fine, to 25% warning, above that alert. */
const health = (share: number) => (share < 0.1 ? "fine" : share <= 0.25 ? "warning" : "alert");

/** The Pipeline: each stage's runs per issue, p90 time and failed share, with its health. */
function pipeline(d: any) {
  const by = new Map<string, any>((d.stages?.rows ?? []).map((r: any) => [r.stage, r]));
  return ["intake", "queue", "build", "review", "recheck", "land"].map((k) => {
    const r = by.get(k), name = NAMES[k];
    if (k === "queue") return { name, text: d.phases?.queue?.count > 0 ? `wait · p90 ${dur(d.phases.queue.p90)}` : "–", tone: "quiet" };
    if (!r?.items) return { name, text: "–", tone: "quiet" };
    const share = r.runs ? (r.unusable ?? 0) / r.runs : 0;
    return { name, text: `${mean(r.runs / r.items)}/issue · p90 ${dur(r.p90)} · ${pct(share * 100)} failed`, tone: health(share) };
  });
}

/** The holds: an issue's state while it waits, not an event, so the Herald leaves them out. */
const WAITS = ["held", "waiting", "paused", "red", "after", "full", "gpu", "busy", "parent", "credit"];
/** The events the Herald keeps, as on the page. */
const HERALD_KEEP = 50;
const isIssue = (t: string) => Boolean(parseId(t) || parseKey(t)?.kind === "issue");
const isJob = (id: string) => /^job\.\d+$/.test(id ?? "") || (id ?? "").includes("#");
/** What happened, never who: a done closes an issue or ends a routine's run. */
const stateWord = (e: any) => (e.action === "done" ? (isIssue(targetOf(e)) ? "closed" : "ended") : e.action === "running" ? "started" : e.action);
/** The past word of each verb a housekeeper change's detail starts with (`retitle: New title`). */
const VERBS: Record<string, string> = { close: "closed", drop: "dropped", retitle: "retitled", reprioritize: "reprioritized", note: "commented", unpark: "unparked" };
const FAILED = ["failed", "returned", "dropped"];
const at = (e: any) => clock(e.time) || when(e.time);

/**
 * The Herald's rows, newest first, grouped as on the page but simpler: one row per issue with its older events in the fold,
 * one row per routine run that changed something, failed or still runs (its changes in the fold), and one per other subject.
 * The page also splits an issue's row by attempt; this does not.
 */
function heraldRows(s: any) {
  const h = s.herald ?? {}, titles = h.titles ?? {}, runs = h.runs ?? {};
  const events = [...(h.events ?? [])].sort((a: any, b: any) => (a.time < b.time ? 1 : -1)).slice(0, HERALD_KEEP).filter((e: any) => !WAITS.includes(e.action)).reverse();
  const routines = new Set(events.filter((e: any) => !isIssue(targetOf(e)) && isJob(e.object)).map((e: any) => e.object));
  const groups = new Map<string, any[]>();
  for (const e of events) {
    const t = targetOf(e), k = e.action === "changed" && routines.has(e.subject) ? e.subject : isIssue(t) ? t : isJob(e.object) ? e.object : t;
    groups.set(k, [e, ...(groups.get(k) ?? [])]);
  }
  const rows = [...groups].flatMap(([k, evs]) => {
    if (routines.has(k)) {
      const head = evs.find((e) => e.action !== "changed") ?? evs[0], changes = evs.filter((e) => e.action === "changed").reverse();
      if (!changes.length && !FAILED.includes(head.action) && !evs.every((e) => e.action === "running")) return [];
      const fold = changes.map((c) => {
        const m = /^(\w+): ([\s\S]*)$/.exec(c.detail ?? ""), verb = m && Object.hasOwn(VERBS, m[1]) ? VERBS[m[1]] : stateWord(c);
        return { at: at(c), label: verb, text: `${shownId(targetOf(c), c.project)} ${m ? m[2] : c.detail ?? ""}`.trim() };
      });
      const title = changes.length ? `${changes.length} ${changes.length === 1 ? "change" : "changes"}` : sayText(head);
      return [{ key: k, time: head.time, at: at(head), word: stateWord(head), id: runs[k] ? `@${runs[k]}` : shownId(k), title, fold }];
    }
    const head = evs.find((e) => e.action !== "stalled") ?? evs[0], t = targetOf(head);
    const fold = evs.filter((e) => e !== head).map((e) => ({ at: at(e), label: runs[e.object] ?? stateWord(e), text: sayText(e) }));
    return [{ key: k, time: head.time, at: at(head), word: stateWord(head), id: isIssue(t) ? shownId(t, head.project) : shownId(k), title: titles[t] ?? sayText(head), fold }];
  });
  return rows.sort((a, b) => (a.time < b.time ? 1 : -1)).map(({ time: _, ...r }) => r);
}

/** The Status page as data for the Herdr desktop app's mod: the status sentence, the cards and the Herald. */
export function data(s: any, d: any) {
  return {
    status: verdict(s),
    scorecard: scorecard(s, d),
    agentTime: agentTime(d),
    pipeline: pipeline(d),
    active: (d.active ?? []).map((b: any) => ({ at: b.at, intake: b.intake, queue: b.queue, running: b.running, landed: b.landed })),
    asks: (s.asks ?? []).map((a: any) => ({ label: a.label, id: shownId(a.id, a.repo), title: shortText(a.headline || a.title) })),
    stuck: (s.stuck ?? []).map((j: any) => ({ id: shownId(j.name), title: j.item?.title || j.name })),
    running: [
      ...(s.runningIssues ?? []).map((i: any) => ({ at: clock(i.at ?? i.since) || when(i.at ?? i.since), word: i.stage, id: shownId(i.id), title: i.title, size: "" })),
      ...(s.running ?? []).map((j: any) => {
        const run = j.run ?? { kind: "build", started: j.started };
        return { at: clock(run.started ?? j.started) || when(run.started ?? j.started), word: run.kind === "build" ? "implement" : run.kind, id: shownId(j.id ?? j.name), title: j.item?.title || j.name, size: run.kind === "build" ? j.size ?? "" : "" };
      }),
    ],
    herald: heraldRows(s),
  };
}

/** The Status page for the state `s` and the flow `d` (with its baseline) as lines of at most `width` columns, at most `height` of them. */
export function render(s: any, d: any, { width, height }: { width: number; height: number }): string[] {
  const out: string[] = [], line = (t: string) => out.push(clip(t, width)), head = (t: string) => out.push(`\x1b[1m${clip(t, width)}\x1b[22m`);
  const v = verdict(s);
  out.push(paint(TONES[v.tone], clip(v.text, width)));

  head("Scorecard");
  for (const c of scorecard(s, d)) line(`${c.name} ${c.value} ${c.trend} ${c.note}`);

  head("Agent Time");
  const a = agentTime(d);
  line(a.all > 0 ? `${pct((a.kept / a.all) * 100)} reached main · ${hours(a.kept)} of ${hours(a.all)}` : "No data");

  head("Pipeline");
  for (const r of pipeline(d)) line(`${r.name} ${r.text}`);

  // The newest bucket is the stage counts now.
  head("Active Issues");
  const now = d.active?.at(-1);
  line(now ? `${NAMES.intake} ${now.intake} · Queued ${now.queue} · Running ${now.running} · Landed ${now.landed}` : "No data");

  head("Herald");
  for (const a of s.asks ?? []) line(`${a.label} ${shownId(a.id, a.repo)} ${shortText(a.headline || a.title)}`);
  for (const j of s.stuck ?? []) line(`Stuck ${shownId(j.name)} ${j.item?.title || j.name}`);
  for (const i of s.runningIssues ?? []) line(`${clock(i.at ?? i.since) || when(i.at ?? i.since)} ${i.stage} ${shownId(i.id)} ${i.title}`);
  for (const j of s.running ?? []) {
    const run = j.run ?? { kind: "build", started: j.started };
    line(`${clock(run.started ?? j.started) || when(run.started ?? j.started)} ${run.kind === "build" ? "implement" : run.kind} ${shownId(j.id ?? j.name)} ${j.item?.title || j.name}`);
  }
  // The holds are an issue's state, not events: the page's feed leaves them out.
  const events = (s.herald?.events ?? []).filter((e: any) => !WAITS.includes(e.action)).sort((a: any, b: any) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  for (const e of events) line(`${clock(e.time) || when(e.time)} ${sayText(e)} ${s.herald?.titles?.[targetOf(e)] ?? ""}`);
  // The newest events come first, so the cut at the pane's height drops the oldest.
  return out.slice(0, height);
}

/** The state and the week's flow, read as the routes do. */
async function load() {
  const now = new Date(), fit = await currentFit().catch(() => null), d = speed("week", now, fit);
  return [await stateBody(null), { ...d, figures: figures(d), baseline: baseline("week", now, fit) }];
}

// `--json` prints the page once as data, for the Herdr desktop app's mod, and exits.
if (import.meta.main && process.argv.includes("--json")) {
  const [s, d] = await load();
  console.log(JSON.stringify(data(s, d)));
  process.exit(0);
}

if (import.meta.main) {
  const { stdin, stdout } = process;
  let data: any[] | null = null, failed = "";
  const draw = () => {
    const size = { width: stdout.columns || 40, height: stdout.rows || 30 };
    const lines = failed ? [clip(failed, size.width)] : data ? render(data[0], data[1], size) : [];
    stdout.write(`\x1b[H\x1b[2J${lines.join("\n")}`);
  };
  const refresh = async () => { try { data = await load(); failed = ""; } catch (e) { failed = errText(e); } draw(); };
  const quit = () => { stdout.write("\x1b[?25h\x1b[?1049l"); stdin.setRawMode?.(false); process.exit(0); };
  stdout.write("\x1b[?1049h\x1b[?25l");
  stdin.setRawMode?.(true);
  stdin.on("data", (b) => { if (b.toString() === "q" || b.toString() === "\x03") quit(); });
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  stdout.on("resize", draw);
  setInterval(refresh, REFRESH_MS);
  await refresh();
}
