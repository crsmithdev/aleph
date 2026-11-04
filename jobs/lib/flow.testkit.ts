/**
 * The in-process calls that jobs/inproc.ts does not have, for the run tests: a plain run, a drop with a fate, the
 * report's text, a tick, an item's notes, the status line and the pause. Each runs under the CLI's environment
 * (`asCli`) and calls the library functions that jobs/cli.ts calls, in the same order.
 */
import { base } from "../cli.helpers";
import { asCli, call, issueShow, status, type Result } from "../inproc.ts";
import * as issues from "../../todo/lib/todo.ts";
import { ciStep } from "./ci.ts";
import { firefight } from "./firefighter.ts";
import { behind, correctionsStep, episodeStep, directorStep, report, runDispatch, stallStep, triageStep } from "./factory.ts";
import { factoryRepos, health, setPaused } from "./factory-status.ts";
import { fetchOrigin } from "./git.ts";
import { factoryLog } from "./layout.ts";
import { loadRegistry } from "./ledger.ts";
import { flakeLines, reportLine } from "./monitor-table.ts";
import { monitorStep } from "./monitor.ts";
import type { Fate } from "./outcome.ts";
import { smokeStep } from "./smoke.ts";
import { drop as dropJob, startPlain } from "./transitions.ts";

/** `aleph run <name> -- <argv>`, from base: the started run, then the unit's exit code. */
export async function run(name: string, argv: string[]): Promise<Result> {
  let code = 0;
  const r = await call(async () => { const s = await startPlain({ name, argv, cwd: base }, { command: ["run", name, "--", ...argv], output: "ignore" }); code = (await s.child?.exited) ?? 0; return s.started; });
  return r.code ? r : { ...r, code };
}

/** `aleph drop <name> [<reason>] [--quiet] [--fate <fate>]`: the fate is by-hand unless quiet or given. */
export const dropAs = (name: string, a: { reason?: string; quiet?: boolean; fate?: Fate }) =>
  call(() => dropJob(name, { reason: a.reason, quiet: a.quiet, fate: a.fate ?? (a.quiet ? undefined : "by-hand") }));

/** `aleph report`: the text it prints, from the same parts in the same order. */
export const reportText = (): Promise<string> => asCli({}, () => {
  const lines = [report()];
  for (const repo of Object.values(loadRegistry()).filter((r) => r.sandbox)) {
    fetchOrigin(repo.path);
    lines.push(behind(repo) ?? "");
  }
  lines.push(...health(), ...flakeLines());
  const m = reportLine();
  if (m) lines.push(m);
  return lines.filter(Boolean).join("\n\n") || "nothing new";
});

/** `aleph tick`: its steps in the same order, and the JSON it prints. */
export const tick = (extra: Record<string, string> = {}): Promise<any> => asCli(extra, async () => {
  await correctionsStep();
  const d: any = await runDispatch();
  const t = !d.held ? await triageStep() : { triaged: {}, skipped: [] };
  await directorStep();
  const episodes = await episodeStep();
  try { ciStep(factoryRepos()); } catch (e: any) { factoryLog(`ci: failed: ${e?.message ?? e}`); }
  try { stallStep(); } catch (e: any) { factoryLog(`stalls: failed: ${e?.message ?? e}`); }
  await smokeStep();
  const f = await firefight();
  const m = await monitorStep();
  return { ...d, skipped: [...d.skipped, ...t.skipped], triaged: t.triaged, episodes, ...(f && (f.filed.length || f.asked.length) ? { firefighter: f } : {}), ...(m ? { monitor: m.day } : {}) };
});

/** `aleph pause` and `aleph resume`; the resume's dispatch is off in the tests (ALEPH_DISPATCH=off). */
export const pause = () => asCli({}, () => setPaused(true));
export const resume = () => asCli({}, () => setPaused(false));

/** The notes that `aleph issue show <repo> <id>` prints. */
export const issueNotes = async (key: string, id: number | string): Promise<string> => (await issueShow(key, id)).json.notes.join("\n");

/** `aleph status <repo>-<n>`: the line it prints. */
export async function statusLine(key: string, n: number): Promise<string> {
  const s = (await status(`${key}-${n}`)).json;
  return issues.localRefs(key, `${s.id} ${s.stage}: ${s.why}`);
}
