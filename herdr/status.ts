// The Status page (ui/views/now.js) as plain terminal text for a herdr side panel, for the week window.
// It reads the data in-process, as the routes of ui/api/now.ts and ui/api/speed.ts do, and redraws every 10 s and on a resize.
// `render` is the whole page as lines no wider than the pane; the rest of the file is the terminal loop.
import { baseline, figures, speed } from "../ui/api/speed.ts";
import { stateBody } from "../ui/api/now.ts";
import { currentFit } from "../ui/usage.ts";
import { verdict } from "../lib/status-words.ts";
import { clip, NAMES, sayText, shortText, shownId, targetOf } from "../lib/naming.ts";
// @ts-ignore plain JS, shared with the page
import { cardTrend, clock, count, dur, hours, mean, pct, when } from "../ui/lib.js";
// @ts-ignore plain JS, shared with the page
import { cardHours, cardPct, pace } from "../ui/views/speed.js";
import { errText } from "../lib/errtext.ts";

const REFRESH_MS = 10_000;
/** The colour of each tone of the status sentence: red, yellow or green. */
const TONES: Record<string, number> = { alert: 31, ask: 33, warning: 33, fine: 32 };
const paint = (code: number, t: string) => `\x1b[${code}m${t}\x1b[0m`;

/** The trend of the page's scorecard as text: the page draws it as HTML. */
const trend = (html: string) => html.replace(/<[^>]*>/g, "");

/** The Status page for the state `s` and the flow `d` (with its baseline) as lines of at most `width` columns, at most `height` of them. */
export function render(s: any, d: any, { width, height }: { width: number; height: number }): string[] {
  const out: string[] = [], line = (t: string) => out.push(clip(t, width)), head = (t: string) => out.push(`\x1b[1m${clip(t, width)}\x1b[22m`);
  const v = verdict(s);
  out.push(paint(TONES[v.tone], clip(v.text, width)));

  const f = d.figures, base = d.baseline?.base, prev = d.baseline?.prev, basis = d.baseline?.basis ?? "";
  const t = (key: string, o: object) => trend(base ? cardTrend(f[key], base[key], prev?.[key], { basis, ...o }) : "");
  const live = s.factory.liveRuns, p = pace(s);
  head("Scorecard");
  line(`Lost time ${cardPct(f.lost)} / ${cardHours(f.hours)} ${t("lost", { kind: "points", lowerIsGood: true, format: cardPct })} lost / hours`);
  line(`Completion ${dur(f.leadP50)} / ${dur(f.leadP90)} ${t("leadP50", { kind: "relative", lowerIsGood: true, format: dur })} p50 / p90`);
  line(`Landed ${cardPct(f.firstPass)} / ${count(f.landed)} ${t("firstPass", { kind: "points", lowerIsGood: false, format: cardPct })} clean / landed`);
  line(`Jobs ${count(live)} / ${count((s.queued ?? []).length)} running / queued`);
  line(`Usage ${s.usage?.now ? pct(s.usage.now.seven_day) : "–"} ${s.usage?.stale ? "stale" : p ? `${p.word} pace` : s.usage?.now ? "live" : ""}`);

  head("Agent Time");
  const cs = (d.classes ?? []).filter((c: any) => c.hours > 0), all = cs.reduce((a: number, c: any) => a + c.hours, 0), kept = cs.filter((c: any) => !c.lost).reduce((a: number, c: any) => a + c.hours, 0);
  line(all > 0 ? `${pct((kept / all) * 100)} reached main · ${hours(kept)} of ${hours(all)}` : "No data");

  head("Pipeline");
  const by = new Map<string, any>((d.stages?.rows ?? []).map((r: any) => [r.stage, r]));
  for (const k of ["intake", "queue", "build", "review", "recheck", "land"]) {
    const r = by.get(k), name = NAMES[k];
    if (k === "queue") line(d.phases?.queue?.count > 0 ? `${name} wait · p90 ${dur(d.phases.queue.p90)}` : `${name} –`);
    else if (!r?.items) line(`${name} –`);
    else line(`${name} ${mean(r.runs / r.items)}/issue · p90 ${dur(r.p90)} · ${pct((r.runs ? (r.unusable ?? 0) / r.runs : 0) * 100)} failed`);
  }

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
  const waits = ["held", "waiting", "paused", "red", "after", "full", "gpu", "busy", "parent", "credit"];
  const events = (s.herald?.events ?? []).filter((e: any) => !waits.includes(e.action)).sort((a: any, b: any) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  for (const e of events) line(`${clock(e.time) || when(e.time)} ${sayText(e)} ${s.herald?.titles?.[targetOf(e)] ?? ""}`);
  // The newest events come first, so the cut at the pane's height drops the oldest.
  return out.slice(0, height);
}

/** The state and the week's flow, read as the routes do. */
async function load() {
  const now = new Date(), fit = await currentFit().catch(() => null), d = speed("week", now, fit);
  return [await stateBody(null), { ...d, figures: figures(d), baseline: baseline("week", now, fit) }];
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
