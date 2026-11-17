// The Status page (ui/views/now.js) as plain terminal text for a herdr side panel, for the week window, or with
// `--json` as data for the Herdr desktop app's mod.
// It reads the data in-process, as the routes of ui/api/now.ts and ui/api/flow.ts do, and redraws every 10 s and on a resize.
// `render` is the whole page as lines no wider than the pane; the rest of the file is the terminal loop.
import { baseline, speed } from "../ui/api/flow.ts";
import { figures } from "../ui/flow/baseline.ts";
import { stateBody } from "../ui/api/now.ts";
import { currentFit } from "../ui/usage.ts";
import { verdict } from "../lib/status-words.ts";
import { clip, NAMES, runWord, shortText, shownId } from "../lib/naming.ts";
import { plain, type Row } from "../ui/herald.ts";
// @ts-ignore plain JS, shared with the page
import { clock, count, dur, hours, mean, pct, when } from "../ui/views/lib/format.js";
// @ts-ignore plain JS, shared with the page
import { cardTrend } from "../ui/views/lib/html.js";
// @ts-ignore plain JS, shared with the page
import { cardHours, cardPct, pace } from "../ui/views/lib/flow-parts.js";
import { errText } from "../lib/errtext.ts";

type State = Awaited<ReturnType<typeof stateBody>>;
type Flow = ReturnType<typeof speed> & { figures: ReturnType<typeof figures>; baseline: ReturnType<typeof baseline> };

const REFRESH_MS = 10_000;
/** The colour of each tone of the status sentence: red, yellow or green. */
const TONES: Record<string, number> = { alert: 31, ask: 33, warning: 33, fine: 32 };
const paint = (code: number, t: string) => `\x1b[${code}m${t}\x1b[0m`;

/** The trend of the page's scorecard as text: the page draws it as HTML. */
const trend = (html: string) => html.replace(/<[^>]*>/g, "");

/** The scorecard of the page: each card's name, value, trend and what the value counts. */
function scorecard(s: State, d: Flow) {
  const f = d.figures, base = d.baseline?.base, prev = d.baseline?.prev, basis = d.baseline?.basis ?? "";
  const t = (key: keyof Flow["figures"], o: object) => trend(base ? cardTrend(f[key], base[key], prev?.[key], { basis, ...o }) : "");
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
function agentTime(d: Flow) {
  const classes = (d.classes ?? []).filter((c) => c.hours > 0).map((c) => ({ key: c.key, lost: c.lost, hours: c.hours }));
  const sum = (cs: { hours: number }[]) => cs.reduce((a, c) => a + c.hours, 0);
  return { classes, kept: sum(classes.filter((c) => !c.lost)), all: sum(classes) };
}

/** The health of a stage by its failed share, as on the page: under 10% fine, to 25% warning, above that alert. */
const health = (share: number) => (share < 0.1 ? "fine" : share <= 0.25 ? "warning" : "alert");

/** The Pipeline: each stage's runs per issue, p90 time and failed share, with its health. */
function pipeline(d: Flow) {
  const by = new Map((d.stages?.rows ?? []).map((r) => [r.stage, r]));
  return ["intake", "queue", "build", "review", "recheck", "land"].map((k) => {
    const r = by.get(k), name = NAMES[k];
    if (k === "queue") return { name, text: d.phases?.queue?.count > 0 ? `wait · p90 ${dur(d.phases.queue.p90)}` : "–", tone: "quiet" };
    if (!r?.items) return { name, text: "–", tone: "quiet" };
    const share = r.runs ? (r.unusable ?? 0) / r.runs : 0;
    return { name, text: `${mean(r.runs / r.items)}/issue · p90 ${dur(r.p90)} · ${pct(share * 100)} failed`, tone: health(share) };
  });
}

const at = (t: string) => clock(t) || when(t);

/** The Herald's rows as the page draws them, from the server's rows (ui/herald.ts): the time, the chip's word, the ID, the text, and the fold's lines. */
const heraldRows = (s: State) => (s.herald?.rows ?? []).map((r: Row) => ({ key: r.key, at: at(r.at), word: r.word, id: plain(r.id), title: plain(r.text),
  fold: r.lines.map((l) => ({ at: at(l.at), label: l.label, text: plain(l.text) })) }));

/** The Status page as data for the Herdr desktop app's mod: the status sentence, the cards and the Herald. */
export function data(s: State, d: Flow) {
  return {
    status: verdict(s),
    scorecard: scorecard(s, d),
    agentTime: agentTime(d),
    pipeline: pipeline(d),
    active: (d.active ?? []).map((b) => ({ at: b.at, intake: b.intake, queue: b.queue, running: b.running, landed: b.landed })),
    asks: (s.asks ?? []).map((a) => ({ label: a.label, id: shownId(a.id, a.repo), title: shortText(a.headline || a.title) })),
    stuck: (s.stuck ?? []).map((j) => ({ id: shownId(j.name), title: j.item?.title || j.name })),
    running: [
      ...(s.runningIssues ?? []).map((i) => ({ at: clock(i.at ?? i.since) || when(i.at ?? i.since), word: i.stage, id: shownId(i.id), title: i.title, size: "" })),
      ...(s.running ?? []).map((j) => {
        const run = j.run ?? { kind: "build", started: j.started };
        return { at: clock(run.started ?? j.started) || when(run.started ?? j.started), word: runWord(run.kind), id: shownId(j.id ?? j.name), title: j.item?.title || j.name, size: run.kind === "build" ? j.size ?? "" : "" };
      }),
    ],
    herald: heraldRows(s),
  };
}

/** The Status page for the state `s` and the flow `d` (with its baseline) as lines of at most `width` columns, at most `height` of them. */
export function render(s: State, d: Flow, { width, height }: { width: number; height: number }): string[] {
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
    line(`${clock(run.started ?? j.started) || when(run.started ?? j.started)} ${runWord(run.kind)} ${shownId(j.id ?? j.name)} ${j.item?.title || j.name}`);
  }
  for (const r of heraldRows(s)) line(`${r.at} ${r.word} ${r.id} ${r.title}`);
  // The newest events come first, so the cut at the pane's height drops the oldest.
  return out.slice(0, height);
}

/** The state and the week's flow, read as the routes do. */
async function load(): Promise<[State, Flow]> {
  const now = new Date(), fit = await currentFit(), d = speed("week", now, fit);
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
