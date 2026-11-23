// The Status page (ui/views/now.js) as plain terminal text for a herdr side panel, or with `--json` as data for the
// Herdr desktop app's mod, for the window of `--window` (hour, day, week or month; week by default).
// It reads the data in-process, as the routes of ui/api/now.ts, flow.ts, memory.ts and log.ts do, and redraws every 10 s and on a resize.
// `render` is the whole page as lines no wider than the pane; the rest of the file is the terminal loop.
import { baseline, openNow, speed } from "../ui/api/flow.ts";
import { figures } from "../ui/flow/baseline.ts";
import { stateBody } from "../ui/api/now.ts";
import { routes as memoryRoutes } from "../ui/api/memory.ts";
import { routes as logRoutes } from "../ui/api/log.ts";
import { currentFit } from "../ui/usage.ts";
import { verdict } from "../lib/status-words.ts";
import { FACTORY, type Window } from "../lib/windows.ts";
import { clip, NAMES, runWord, shortText, shownId } from "../lib/naming.ts";
// @ts-ignore plain JS, shared with the page
import { clock, count, dur, hours } from "../ui/views/lib/format.js";
// @ts-ignore plain JS, shared with the page
import { cardList } from "../ui/views/lib/flow-parts.js";
// @ts-ignore plain JS, shared with the page
import { errorSentence, failedRuns, flowStats, FULL, holdsOf, lostCauses, memoryStats, onText, phasesNow } from "../ui/views/now.js";
import { errText } from "../lib/errtext.ts";

/** `memory` is /api/memory with /api/memory/processes as `processes`, and `log` the first page of /api/log, as the page reads them. */
type State = Awaited<ReturnType<typeof stateBody>> & { memory?: any; log?: { rows: any[]; total: number } };
type Flow = ReturnType<typeof speed> & { figures: ReturnType<typeof figures>; baseline: ReturnType<typeof baseline>; open: ReturnType<typeof openNow> };

const REFRESH_MS = 10_000;
/** The colour of each tone of the status sentence: red, yellow or green. */
const TONES: Record<string, number> = { alert: 31, ask: 33, warning: 33, fine: 32 };
const paint = (code: number, t: string) => `\x1b[${code}m${t}\x1b[0m`;

/** The trend of the page's scorecard as text: the page draws it as HTML. */
const trend = (html: string) => html.replace(/<[^>]*>/g, "");

/** The scorecard of the page: each card's name, value, trend and what the value counts, from the page's card list. */
const scorecard = (s: State, d: Flow): { name: string; value: string; trend: string; note: string }[] => cardList(s, d, { memory: s.memory ?? null }).map((c: any) => ({
  name: c.k, value: [c.v, c.v2].flat().filter((x) => x !== undefined).join(" / "), trend: trend(c.trend ?? ""), note: c.q?.join(" / ") ?? c.note ?? "",
}));

/** Side stats as the page draws them: the name, the value and its note. */
const stats = (xs: { k: string; v: string; note?: string }[]) => xs.map((x) => ({ name: x.k, value: x.v, note: x.note ?? "" }));

/** The Problems card: the factory's alerts, the Asks, the errored jobs, a backend that is down and a full start context, each with its kind, ID, title and detail. */
function problems(s: State, m: any) {
  const v = verdict(s), backend = s.factory.backend, aleph = m?.start.aleph;
  return [
    ...v.errors.map((e) => ({ kind: "Alert", id: "", title: e.text, detail: "" })),
    ...(s.asks ?? []).map((a) => ({ kind: a.label, id: shownId(a.id, a.repo), title: shortText(a.headline || a.title, a.repo), detail: shortText(a.situation ?? a.problem ?? "", a.repo) })),
    ...(s.errored ?? []).map((j) => ({ kind: "Error", id: shownId(j.id ?? j.name), title: j.item?.title || j.name, detail: j.blocker ? `Waits on ${shortText(j.blocker.id, j.repo)}: ${j.blocker.title}` : errorSentence(j) })),
    ...(backend ? [{ kind: "Backend", id: "", title: `${backend.via} is down`, detail: backend.why }] : []),
    ...(aleph && aleph.bytes >= FULL * aleph.budget ? [{ kind: "Memory", id: "", title: "Start context near its budget", detail: `${count(aleph.budget - aleph.bytes)} B left in aleph` }] : []),
  ];
}

/** The Status page as data for the Herdr desktop app's mod, in the order of page A: the status sentence and badge, the scorecard,
 * Problems, Issues in Motion, Efficiency, Flow, Memory and the newest events. */
export function data(s: State, d: Flow) {
  const v = verdict(s), m = s.memory && !s.memory.error ? s.memory : null, now = Date.parse(s.now);
  const alerts = problems(s, m), f = d.figures, phases = phasesNow(s);
  return {
    window: d.window,
    status: v,
    // An errored job or an error outranks an Ask: the badge takes the worst alert's tone.
    badge: alerts.length ? { text: "Not OK", tone: s.errored?.length || v.errors.length ? "alert" : "ask" } : { text: "OK", tone: "fine" },
    scorecard: scorecard(s, d),
    problems: alerts,
    motion: {
      running: [
        ...(s.runningIssues ?? []).map((i) => ({ id: shownId(i.id), word: i.stage, for: dur((now - Date.parse(i.at ?? i.since)) / 1000), title: i.title })),
        ...(s.running ?? []).map((j) => {
          const run = j.run ?? { kind: "build", started: j.started };
          return { id: shownId(j.id ?? j.name), word: runWord(run.kind), for: dur((now - Date.parse(run.started ?? j.started)) / 1000), title: j.item?.title || j.name };
        }),
      ],
      waiting: (holdsOf(s) as { qs: any[]; waited: number | null }[]).map(({ qs, waited }) => ({ hold: qs[0].kind, on: onText(qs[0]), waited: waited === null ? "–" : dur(waited), issues: qs.map((q: any) => ({ id: shownId(`${q.repo}-${q.id}`), title: q.title ?? "" })) })),
    },
    efficiency: {
      kept: hours(f.kept), all: hours((f.kept ?? 0) + (f.hours ?? 0)),
      classes: d.classes.filter((c) => c.hours > 0).map((c) => ({ key: c.key, text: hours(c.hours) })),
      lost: (lostCauses(d) as [string, number][]).map(([name, h]) => ({ name, text: hours(h) })),
      failed: (failedRuns(d) as any[]).map((r) => ({ name: NAMES[r.stage], text: `${count(r.unusable)} of ${count(r.runs)}` })),
    },
    flow: {
      stats: stats(flowStats(d)),
      phases: Object.entries(phases).map(([k, n]) => { const ph = d.phases[k as keyof typeof d.phases]; return { name: NAMES[k === "implement" ? "build" : k], now: count(n), p90: ph.count ? dur(ph.p90) : "–" }; }),
    },
    memory: m && {
      start: Object.entries(m.start).map(([k, st]: [string, any]) => ({ name: k, lines: count(st.core.length), text: `${count(st.bytes)} / ${count(st.budget)} B` })),
      stats: stats(memoryStats(m, s.now)),
    },
    events: (s.log?.rows ?? []).map((r) => ({ at: clock(r.at), action: r.action, id: r.issue?.id ?? r.job?.id ?? "", title: r.title, by: r.by, took: r.took == null ? "" : dur(r.took) })),
  };
}

/** The Status page for the state `s` and the flow `d` (with its baseline) as lines of at most `width` columns, at most `height` of them. */
export function render(s: State, d: Flow, { width, height }: { width: number; height: number }): string[] {
  const out: string[] = [], line = (t: string) => out.push(clip(t, width));
  const head = (t: string) => out.push(`\x1b[1m${clip(t, width)}\x1b[22m`), sub = (t: string) => out.push(`\x1b[2m${clip(t, width)}\x1b[22m`);
  const lines = (xs: string[]) => (xs.length ? xs.forEach(line) : line("No data"));
  const joined = (xs: { name: string; value: string; note: string }[]) => xs.map((x) => [x.name, x.value, x.note].filter(Boolean).join(" ")).join(" · ");
  const p = data(s, d);
  out.push(paint(TONES[p.status.tone], clip(p.status.text, width)));

  head("Scorecard");
  for (const c of p.scorecard) line(`${c.name} ${c.value} ${c.trend} ${c.note}`);

  head("Problems");
  if (!p.problems.length) line("No data");
  // The detail is muted, as the page's alert draws it.
  for (const a of p.problems) { line([a.kind, a.id, a.title].filter(Boolean).join(" ")); if (a.detail) sub(a.detail); }

  head("Issues in Motion");
  lines(p.motion.running.map((r) => `${r.id} ${r.word} ${r.for} ${r.title}`));
  if (p.motion.waiting.length) sub("Waiting");
  for (const w of p.motion.waiting) line(`${w.hold} ${w.on} ${w.waited}: ${w.issues.map((i) => `${i.id} ${i.title}`).join(" · ")}`);

  head("Efficiency");
  line(`${p.efficiency.kept} of ${p.efficiency.all} reached main`);
  line(p.efficiency.classes.map((c) => `${c.key} ${c.text}`).join(" · "));
  sub("Lost Time by Cause");
  lines(p.efficiency.lost.map((c) => `${c.name} ${c.text}`));
  sub("Failed Runs by Stage");
  lines(p.efficiency.failed.map((r) => `${r.name} ${r.text}`));

  head("Flow");
  line(joined(p.flow.stats));
  sub("Time by Phase, p90");
  for (const r of p.flow.phases) line(`${r.name} ${r.now} ${r.p90}`);

  head("Memory");
  if (p.memory) {
    for (const st of p.memory.start) line(`${st.name} ${st.lines} lines ${st.text}`);
    line(joined(p.memory.stats));
  } else line("No data");

  head("Events");
  lines(p.events.map((e) => `${e.at} ${e.action} ${e.id} ${e.title}`));
  // The newest events come first, so the cut at the pane's height drops the oldest.
  return out.slice(0, height);
}

/** The window of `--window`, week when it is not given. */
const flag = process.argv.indexOf("--window"), win = (flag < 0 ? "week" : process.argv[flag + 1]) as Window;
if (flag >= 0 && !FACTORY.includes(win)) throw new Error(`--window takes ${FACTORY.join(", ")}`);

/** The Memory page's data, read as its routes do. */
async function memoryOf() {
  const [m, processes] = await Promise.all(["/api/memory", "/api/memory/processes"].map(async (path) => (await memoryRoutes[`GET ${path}`](new Request(`http://aleph${path}`), {}, new URL(`http://aleph${path}`))).json()));
  return { ...m, processes };
}

/** The first page of the window's event log, read as its route does. */
async function logOf() {
  const path = `/api/log?window=${win}`;
  return (await logRoutes["GET /api/log"](new Request(`http://aleph${path}`), {}, new URL(`http://aleph${path}`))).json();
}

/** The state and the window's flow, read as the routes do. */
async function load(): Promise<[State, Flow]> {
  const now = new Date(), fit = await currentFit(), d = speed(win, now, fit);
  return [{ ...(await stateBody(null)), memory: await memoryOf(), log: await logOf() }, { ...d, figures: figures(d), baseline: baseline(win, now, fit), open: openNow() }];
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
