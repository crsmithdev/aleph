// The Status page (ui/views/now.js) as plain terminal text for a herdr side panel, or with `--json` as data for the
// Herdr desktop app's mod, for the window of `--window` (hour, day, week or month; week by default).
// It reads the data in-process, as the routes of ui/api/now.ts and ui/api/flow.ts do, and redraws every 10 s and on a resize.
// `render` is the whole page as lines no wider than the pane; the rest of the file is the terminal loop.
import { baseline, openNow, speed } from "../ui/api/flow.ts";
import { figures } from "../ui/flow/baseline.ts";
import { stateBody } from "../ui/api/now.ts";
import { routes as memoryRoutes } from "../ui/api/memory.ts";
import { currentFit } from "../ui/usage.ts";
import { verdict } from "../lib/status-words.ts";
import { FACTORY, type Window } from "../lib/windows.ts";
import { clip, NAMES, runWord, shortText, shownId } from "../lib/naming.ts";
import { plain, type Row } from "../ui/herald.ts";
// @ts-ignore plain JS, shared with the page
import { cardPct, clock, count, dur, hours, mean, when } from "../ui/views/lib/format.js";
// @ts-ignore plain JS, shared with the page
import { cardList } from "../ui/views/lib/flow-parts.js";
// @ts-ignore plain JS, shared with the page
import { needList } from "../ui/views/lib/memory-health.js";
import { errText } from "../lib/errtext.ts";

/** `memory` is /api/memory with /api/memory/processes as `processes`, as the page's Memory card reads it. */
type State = Awaited<ReturnType<typeof stateBody>> & { memory?: any };
type Flow = ReturnType<typeof speed> & { figures: ReturnType<typeof figures>; baseline: ReturnType<typeof baseline>; open: ReturnType<typeof openNow> };

const REFRESH_MS = 10_000;
/** The colour of each tone of the status sentence: red, yellow or green. */
const TONES: Record<string, number> = { alert: 31, ask: 33, warning: 33, fine: 32 };
const paint = (code: number, t: string) => `\x1b[${code}m${t}\x1b[0m`;

/** The trend of the page's scorecard as text: the page draws it as HTML. */
const trend = (html: string) => html.replace(/<[^>]*>/g, "");

/** The scorecard of the page: each card's name, value, trend and what the value counts, from the page's card list. */
const scorecard = (s: State, d: Flow): { name: string; value: string; trend: string; note: string }[] => cardList(s, d, {}).map((c: any) => ({
  name: c.k, value: [c.v, c.v2].flat().filter((x) => x !== undefined).join(" / "), trend: trend(c.trend ?? ""), note: c.q?.join(" / ") ?? c.note ?? "",
}));

/** The health of a stage by its failed share, as on the page: under 10% fine, to 25% warning, above that alert. */
const health = (share: number) => (share < 0.1 ? "fine" : share <= 0.25 ? "warning" : "alert");

/** The Pipeline card: each stage's runs per issue, p90, failed share with its health, and agent hours with its share of the
 * busiest stage's; Implement's hours split by outcome class, as the page's bar. Then the window's issue counts. */
function pipeline(d: Flow, errored: number) {
  const by = new Map((d.stages?.rows ?? []).map((r) => [r.stage, r]));
  const classes = (d.classes ?? []).filter((c) => c.hours > 0).map((c) => ({ key: c.key, lost: c.lost, hours: c.hours, text: hours(c.hours) }));
  // Implement's hours are its outcome classes', so its bar and the legend add up; the other stages' are runs times minutes.
  const agentH = (k: string) => (k === "build" ? classes.reduce((a, c) => a + c.hours, 0) : ((by.get(k)?.runs ?? 0) * (by.get(k)?.minutes ?? 0)) / 60);
  const most = Math.max(...["intake", "build", "review", "recheck", "land"].map(agentH)) || 1;
  const rows = ["intake", "queue", "build", "review", "recheck", "land"].map((k) => {
    const r = by.get(k), name = NAMES[k];
    if (k === "queue") return { key: k, name, runs: "", p90: d.phases?.queue?.count > 0 ? dur(d.phases.queue.p90) : "–", failed: "", tone: "quiet", hours: "", bar: 0 };
    if (!r?.items) return { key: k, name, runs: "–", p90: "–", failed: "–", tone: "quiet", hours: "–", bar: 0 };
    const share = r.runs ? (r.unusable ?? 0) / r.runs : 0;
    return { key: k, name, runs: mean(r.runs / r.items), p90: dur(r.p90), failed: cardPct(share), tone: health(share), hours: hours(agentH(k)), bar: agentH(k) / most };
  });
  const open = d.open ?? { open: 0, parked: 0 };
  const counts = [
    { name: "Filed", value: count(d.filed?.all ?? 0), tone: "" },
    { name: "Intake", value: count(by.get("intake")?.items ?? 0), tone: "" },
    { name: "Landed", value: count(d.done ?? 0), tone: "fine" },
    { name: "Dropped", value: count(d.dropped ?? 0), tone: "" },
    { name: "Open", value: `${count(open.open)}${open.parked ? ` +${count(open.parked)}` : ""}`, tone: "" },
    { name: "Errored", value: count(errored), tone: errored ? "alert" : "" },
  ];
  return { rows, classes, counts };
}

const at = (t: string) => clock(t) || when(t);

/** The Herald's rows as the page draws them, from the server's rows (ui/herald.ts): the time, the chip's word, the ID, the text, and the fold's lines. */
const heraldRows = (s: State) => (s.herald?.rows ?? []).map((r: Row) => ({ key: r.key, at: at(r.at), word: r.word, id: plain(r.id), title: plain(r.text),
  fold: r.lines.map((l) => ({ at: at(l.at), label: l.label, text: plain(l.text) })) }));

/** The Status page as data for the Herdr desktop app's mod: the status sentence, the scorecard, the Pipeline and Issues
 * cards, and the Herald with its pinned alerts, its badge and its Events, Active and Inspector tabs. */
export function data(s: State, d: Flow) {
  const v = verdict(s), asks = s.asks ?? [], errored = s.errored ?? [];
  const alerts = asks.length + errored.length + v.errors.length;
  const top = (xs: any[]) => xs.slice(0, 20).map((x) => ({ id: shownId(x.issue), title: x.title ?? "" }));
  return {
    window: d.window,
    status: v,
    // An errored job or an error outranks an Ask: the badge takes the worst alert's tone.
    badge: alerts ? { text: "Not OK", tone: errored.length || v.errors.length ? "alert" : "ask" } : { text: "OK", tone: "fine" },
    scorecard: scorecard(s, d),
    memory: needList(s.memory ?? {}).map(([, , text]: string[]) => text),
    pipeline: pipeline(d, errored.length),
    active: (d.active ?? []).map((b) => ({ at: b.at, intake: b.intake, queue: b.queue, running: b.running, landed: b.landed })),
    speed: (d.buckets ?? []).map((b) => ({ at: b.at, intake: b.intake ?? 0, queue: b.queue ?? 0, implement: b.implement ?? 0, land: b.land ?? 0 })),
    asks: asks.map((a) => ({ label: a.label, id: shownId(a.id, a.repo), title: shortText(a.headline || a.title) })),
    errored: errored.map((j) => ({ id: shownId(j.name), title: j.item?.title || j.name })),
    running: [
      ...(s.runningIssues ?? []).map((i) => ({ at: at(i.at ?? i.since), word: i.stage, id: shownId(i.id), title: i.title, size: "" })),
      ...(s.running ?? []).map((j) => {
        const run = j.run ?? { kind: "build", started: j.started };
        return { at: at(run.started ?? j.started), word: runWord(run.kind), id: shownId(j.id ?? j.name), title: j.item?.title || j.name, size: run.kind === "build" ? j.size ?? "" : "" };
      }),
    ],
    queued: (s.queued ?? []).map((q) => ({ id: shownId(`${q.repo}-${q.id}`), title: q.title ?? "" })),
    herald: heraldRows(s),
    // The Inspector's lists: the window's failures, the issues of each stage and of each outcome class.
    failures: (d.failures ?? []).slice(0, 20).map((x) => ({ id: shownId(x.issue), title: x.title ?? "", stage: NAMES[x.stage] ?? x.stage, at: when(x.at) })),
    stageIssues: Object.fromEntries(Object.entries(d.stages?.issues ?? {}).map(([k, xs]) => [k, top(xs as any[])])),
    classIssues: Object.fromEntries((d.classes ?? []).map((c) => [c.key, top(c.top ?? [])])),
  };
}

/** The Status page for the state `s` and the flow `d` (with its baseline) as lines of at most `width` columns, at most `height` of them. */
export function render(s: State, d: Flow, { width, height }: { width: number; height: number }): string[] {
  const out: string[] = [], line = (t: string) => out.push(clip(t, width)), head = (t: string) => out.push(`\x1b[1m${clip(t, width)}\x1b[22m`);
  const p = data(s, d);
  out.push(paint(TONES[p.status.tone], clip(p.status.text, width)));

  head("Scorecard");
  for (const c of p.scorecard) line(`${c.name} ${c.value} ${c.trend} ${c.note}`);

  head("Pipeline");
  for (const r of p.pipeline.rows) line([r.name, r.runs && `${r.runs}/issue`, `p90 ${r.p90}`, r.failed && `${r.failed} failed`, r.hours].filter(Boolean).join(" · "));
  line(p.pipeline.counts.map((c) => `${c.name} ${c.value}`).join(" · "));

  // The newest bucket is the stage counts now.
  head("Issues");
  const now = p.active.at(-1);
  line(now ? `${NAMES.intake} ${now.intake} · Queued ${now.queue} · Running ${now.running} · Landed ${now.landed}` : "No data");

  head("Memory");
  for (const t of p.memory) line(t);
  if (!p.memory.length) line("No data");

  head("Herald");
  for (const a of p.asks) line(`${a.label} ${a.id} ${a.title}`);
  for (const j of p.errored) line(`Error ${j.id} ${j.title}`);
  for (const r of p.running) line(`${r.at} ${r.word} ${r.id} ${r.title}`);
  for (const r of p.herald) line(`${r.at} ${r.word} ${r.id} ${r.title}`);
  // The newest events come first, so the cut at the pane's height drops the oldest.
  return out.slice(0, height);
}

/** The window of `--window`, week when it is not given. */
const win = (process.argv[process.argv.indexOf("--window") + 1] ?? "week") as Window;
if (process.argv.includes("--window") && !FACTORY.includes(win)) throw new Error(`--window takes ${FACTORY.join(", ")}`);

/** The Memory page's data, read as its routes do. */
async function memoryOf() {
  const [m, processes] = await Promise.all(["/api/memory", "/api/memory/processes"].map(async (path) => (await memoryRoutes[`GET ${path}`](new Request(`http://aleph${path}`), {}, new URL(`http://aleph${path}`))).json()));
  return { ...m, processes };
}

/** The state and the window's flow, read as the routes do. */
async function load(): Promise<[State, Flow]> {
  const now = new Date(), fit = await currentFit(), d = speed(win, now, fit);
  return [{ ...(await stateBody(null)), memory: await memoryOf() }, { ...d, figures: figures(d), baseline: baseline(win, now, fit), open: openNow() }];
}

// `--json` prints the page once as data, for the Herdr desktop app's mod, and exits.
if (import.meta.main && process.argv.includes("--json")) {
  const [s, d] = await load();
  console.log(JSON.stringify(data(s, d)));
  process.exit(0);
}

if (import.meta.main) {
  const { stdin, stdout } = process;
  let data: [State, Flow] | null = null, failed = "";
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
