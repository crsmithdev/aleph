/**
 * The in-process calls that jobs/inproc.ts does not have, for the run tests: a plain run, a drop with a fate, the
 * report's text, a tick, an item's notes and the pause. Each runs under the CLI's environment
 * (`asCli`) and calls the library functions that jobs/cli.ts calls, in the same order.
 */
import { base } from "./cli.helpers";
import { asCli, call, issueShow, type Result } from "./inproc.ts";
import { behind, report } from "./lib/transitions/factory.ts";
import { runTick } from "./lib/transitions/tick.ts";
import { health } from "./lib/gates/factory-status.ts";
import { fetchOrigin } from "./lib/infra/git.ts";
import { loadRegistry } from "./lib/records/ledger.ts";
import { flakeLines, reportLine } from "./lib/learning/monitor-table.ts";
import { shortText } from "../lib/naming.ts";
import type { Fate } from "./lib/records/outcome.ts";
import { drop as dropJob, startPlain } from "./lib/transitions/transitions.ts";

/** `aleph run <name> -- <argv>`, from base: the started run, then the unit's exit code. */
export async function run(name: string, argv: string[]): Promise<Result> {
  let code = 0;
  const r = await call(async () => { const s = await startPlain({ name, argv, cwd: base }, { command: ["run", name, "--", ...argv], output: "ignore" }); code = (await s.child?.exited) ?? 0; return s.started; });
  return r.code ? r : { ...r, code };
}

/** `aleph drop <name> [<reason>] [--quiet] [--fate <fate>]`: the fate is manual unless quiet or given. */
export const dropAs = (name: string, a: { reason?: string; quiet?: boolean; fate?: Fate }) =>
  call(() => dropJob(name, { reason: a.reason, quiet: a.quiet, fate: a.fate ?? (a.quiet ? undefined : "manual") }));

/** `aleph report`: the text it prints, from the same parts in the same order. */
export const reportText = (): Promise<string> => asCli({}, () => {
  const lines = [report()];
  for (const repo of Object.values(loadRegistry()).filter((r) => r.sandbox)) {
    fetchOrigin(repo.path);
    lines.push(behind(repo) ?? "");
  }
  lines.push(...health().map((h) => shortText(h.text)), ...flakeLines().map(shortText));
  const m = reportLine();
  if (m) lines.push(shortText(m));
  return lines.filter(Boolean).join("\n\n") || "nothing new";
});

/** `aleph tick`: the library call jobs/cli.ts makes, and the JSON it prints. */
export const tick = (extra: Record<string, string> = {}): Promise<any> => asCli(extra, () => runTick());

/** The notes that `aleph issue show <repo> <id>` prints. */
export const issueNotes = async (key: string, id: number | string): Promise<string> => (await issueShow(key, id)).json.notes.join("\n");
