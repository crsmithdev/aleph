/** The user systemd: every `systemctl --user` call and a timer's next run. The unit folder is unitDir() in settings.ts. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { systemctlBin, unitDir } from "./settings.ts";
import { errText } from "../../../lib/errtext.ts";

/** `systemctl --user <args>`: ok when it exits 0, and its stdout and stderr. */
export function systemctl(...args: string[]): { ok: boolean; out: string } {
  try {
    const p = Bun.spawnSync([systemctlBin(), "--user", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: 15_000 });
    return { ok: p.exitCode === 0, out: (p.stdout.toString() + p.stderr.toString()).trim() };
  } catch (e) {
    return { ok: false, out: errText(e) };
  }
}

/** A oneshot service reports `activating` while it runs (exit 3), so read the state word and ignore the exit code. */
function inProgress(service: string): boolean {
  const state = systemctl("is-active", service).out.split("\n")[0]?.trim();
  return state === "activating" || state === "active";
}

/**
 * A timer's next run in wall-clock ms, from `list-timers --output=json`, whose `next` is wall-clock microseconds.
 * `NextElapseUSecMonotonic` is not that time: for an `OnUnitActiveSec` timer it is a point on the monotonic clock,
 * counted from boot. With no next run, `running` says whether its service runs now. `err` is the systemctl error text.
 */
export function timer(unit: string): { next: number | null; running: boolean; err: string | null } {
  const r = systemctl("list-timers", "--all", "--output=json", unit);
  if (!r.ok) return { next: null, running: false, err: r.out.split("\n")[0] || "systemctl failed" };
  let rows: { unit: string; next?: number | null }[];
  try { rows = JSON.parse(r.out); } catch (e) { return { next: null, running: false, err: `list-timers: ${(e as Error).message}` }; }
  const next = rows.find((x) => x.unit === unit)?.next;
  if (next) return { next: next / 1000, running: false, err: null };
  return { next: null, running: inProgress(unit.replace(/\.timer$/, ".service")), err: null };
}

/** The schedules that run on a systemd timer of their own, by the name the Schedules table shows. */
export const TIMERS: Record<string, string> = { tick: "aleph-tick.timer", suite: "aleph-suite.timer" };
/** An interval the Schedules form takes: a whole number of seconds, minutes or hours, as systemd writes it. */
const INTERVAL = /^[1-9]\d*(s|min|h)$/;

/** A timer's interval: its OnUnitActiveSec as systemd shows it ("1min", "1h"), or null when systemd does not answer. */
export function intervalOf(timer: string): string | null {
  const m = /OnUnitActiveUSec=(\S+)/.exec(systemctl("show", timer, "-p", "TimersMonotonic", "--no-pager").out);
  return m ? m[1] : null;
}

/**
 * Sets a timer's interval with a drop-in, then reloads systemd and restarts the timer. An empty OnUnitActiveSec= clears
 * every monotonic trigger, so the drop-in restates the boot and startup triggers of the unit file; without them no run
 * follows a reboot. Returns an error text, or null.
 */
export function setTimerInterval(name: string, every: string): string | null {
  const timer = TIMERS[name];
  if (!timer) return `only ${Object.keys(TIMERS).join(" and ")} have an interval`;
  if (!INTERVAL.test(every)) return `the interval is a whole number with s, min or h, as in 5min, not "${every}"`;
  const unit = readFileSync(join(import.meta.dir, "../../systemd", timer), "utf8");
  const keep = unit.split("\n").filter((l) => /^On(Boot|Startup)Sec=/.test(l));
  const dir = join(unitDir(), `${timer}.d`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "interval.conf"), ["# Written by the Automation page. An empty assignment clears every monotonic trigger,", "# so the boot and startup triggers of the unit file follow it.", "[Timer]", "OnUnitActiveSec=", ...keep, `OnUnitActiveSec=${every}`, ""].join("\n"));
  for (const args of [["daemon-reload"], ["restart", timer]]) {
    const r = systemctl(...args);
    if (!r.ok) return `systemctl --user ${args.join(" ")} failed: ${r.out.trim()}`;
  }
  return null;
}
