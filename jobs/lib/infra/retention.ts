/**
 * The tick's retention step: it bounds the stores that grow without limit to `KEEP_DAYS`. It deletes the run folder of a
 * run that ended over `KEEP_DAYS` ago in an archived record, a run folder that no record holds (`.records` and the archive beside it are not run folders) and that did not change
 * for `KEEP_DAYS`, the usage.jsonl rows and the `repos.json.bak-*` files that old, and the dispatch.<day>.log files of a day that old. The
 * event log and the job records stay forever; the folders of a record that is not archived stay at any age.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { factoryDir } from "../gates/factory-status.ts";
import { runsDir } from "../records/ledger.ts";
import { all } from "../records/record.ts";
import { reposFile, usageFile } from "./settings.ts";

const KEEP_DAYS = 90;

/** The UTC day a file began: its birth time, or its mtime when the file system gives no birth time. */
export const birthDay = (st: { birthtime: Date; mtime: Date }): string => (st.birthtime.getTime() > 0 ? st.birthtime : st.mtime).toISOString().slice(0, 10);

/** The newest change in a folder: the folder and its entries. */
const changed = (dir: string): number => Math.max(statSync(dir).mtimeMs, ...readdirSync(dir).map((f) => statSync(join(dir, f)).mtimeMs));

/** Delete what is over `KEEP_DAYS` old at `now`. Returns the number of paths it deleted. */
export function retain(now = Date.now()): number {
  const cut = now - KEEP_DAYS * 864e5;
  let n = 0;
  const drop = (p: string) => { rmSync(p, { recursive: true, force: true }); n++; };

  const live = new Set(all(true).map((r) => r.issue));
  const held = new Set<string>();
  const dir = runsDir();
  for (const r of all()) {
    for (const x of r.runs) {
      held.add(x.id);
      if (!live.has(r.issue) && x.ended && Date.parse(x.ended) < cut && existsSync(join(dir, x.id))) drop(join(dir, x.id));
    }
  }
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (!f.startsWith(".") && !held.has(f) && changed(join(dir, f)) < cut) drop(join(dir, f));

  const usage = usageFile();
  if (existsSync(usage)) {
    const rows = readFileSync(usage, "utf8").split("\n").filter(Boolean);
    const keep = rows.filter((l) => { try { return !(Date.parse(JSON.parse(l).at) < cut); } catch { return true; } });
    if (keep.length < rows.length) { writeFileSync(usage, keep.map((l) => `${l}\n`).join("")); n += rows.length - keep.length; }
  }

  const reg = reposFile();
  if (existsSync(dirname(reg))) {
    for (const f of readdirSync(dirname(reg))) if (f.startsWith(`${basename(reg)}.bak-`) && statSync(join(dirname(reg), f)).mtimeMs < cut) drop(join(dirname(reg), f));
  }

  // dispatch.day holds the UTC day the current dispatch.log began, so the aside file takes the day of its oldest line.
  const fdir = factoryDir(), log = join(fdir, "dispatch.log"), mark = join(fdir, "dispatch.day");
  const today = new Date(now).toISOString().slice(0, 10), oldest = new Date(cut).toISOString().slice(0, 10);
  const start = existsSync(mark) ? readFileSync(mark, "utf8").trim() : existsSync(log) ? birthDay(statSync(log)) : today;
  if (start < today && existsSync(log)) renameSync(log, join(fdir, `dispatch.${start}.log`));
  if ((start !== today || !existsSync(mark)) && existsSync(fdir)) writeFileSync(mark, today);
  if (existsSync(fdir)) for (const f of readdirSync(fdir)) if (/^dispatch\.\d{4}-\d\d-\d\d\.log$/.test(f) && f.slice(9, 19) < oldest) drop(join(fdir, f));
  return n;
}
