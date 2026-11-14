/**
 * The tick's retention step: it bounds the stores that grow without limit to `KEEP_DAYS`. It deletes the folder of a
 * job that ended over `KEEP_DAYS` ago (its row stays), a job folder that no row holds and that did not change
 * for `KEEP_DAYS`, the `usage` rows that old, and the dispatch.<day>.log files of a day that old. The
 * event log and the job rows stay forever.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { factoryDir } from "../gates/factory-status.ts";
import { today } from "../../../lib/day.ts";
import { jobsDir } from "../records/ledger.ts";
import { allRunRecords } from "../records/record.ts";
import { conn } from "../../../lib/db.ts";

const KEEP_DAYS = 90;

/** The local day a file began: its birth time, or its mtime when the file system gives no birth time. */
export const birthDay = (st: { birthtime: Date; mtime: Date }): string => today(st.birthtime.getTime() > 0 ? st.birthtime : st.mtime);

/** The newest change in a folder: the folder and its entries. */
const changed = (dir: string): number => Math.max(statSync(dir).mtimeMs, ...readdirSync(dir).map((f) => statSync(join(dir, f)).mtimeMs));

/** Delete what is over `KEEP_DAYS` old at `now`. Returns the number of paths it deleted. */
export function retain(now = Date.now()): number {
  const cut = now - KEEP_DAYS * 864e5;
  let n = 0;
  const drop = (p: string) => { rmSync(p, { recursive: true, force: true }); n++; };

  // The rows stay; a job folder goes 90 days after its job ended. A folder that no row holds goes when it has not changed for that long.
  const dir = jobsDir();
  const held = new Set<string>();
  for (const r of allRunRecords()) {
    held.add(r.id.slice(4));
    if (r.ended && Date.parse(r.ended) < cut && existsSync(join(dir, r.id.slice(4)))) drop(join(dir, r.id.slice(4)));
  }
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (!f.startsWith(".") && !held.has(f) && changed(join(dir, f)) < cut) drop(join(dir, f));

  n += conn().query("DELETE FROM usage WHERE time < ?").run(new Date(cut).toISOString()).changes;

  // dispatch.day holds the local day the current dispatch.log began, so the aside file takes the day of its oldest line.
  const fdir = factoryDir(), log = join(fdir, "dispatch.log"), mark = join(fdir, "dispatch.day");
  const day = today(new Date(now)), oldest = today(new Date(cut));
  const start = existsSync(mark) ? readFileSync(mark, "utf8").trim() : existsSync(log) ? birthDay(statSync(log)) : day;
  if (start < day && existsSync(log)) renameSync(log, join(fdir, `dispatch.${start}.log`));
  if ((start !== day || !existsSync(mark)) && existsSync(fdir)) writeFileSync(mark, day);
  if (existsSync(fdir)) for (const f of readdirSync(fdir)) if (/^dispatch\.\d{4}-\d\d-\d\d\.log$/.test(f) && f.slice(9, 19) < oldest) drop(join(fdir, f));
  return n;
}
