/** The user systemd: every `systemctl --user` call and a timer's next run. The unit folder is unitDir() in settings.ts. */
import { systemctlBin } from "./settings.ts";

/** `systemctl --user <args>`: ok when it exits 0, and its stdout and stderr. */
export function systemctl(...args: string[]): { ok: boolean; out: string } {
  try {
    const p = Bun.spawnSync([systemctlBin(), "--user", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: 15_000 });
    return { ok: p.exitCode === 0, out: (p.stdout.toString() + p.stderr.toString()).trim() };
  } catch (e: any) {
    return { ok: false, out: e?.message ?? String(e) };
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
  let rows: { unit: string; next?: number | null }[] = [];
  try { rows = JSON.parse(r.out); } catch {}
  const next = rows.find((x) => x.unit === unit)?.next;
  if (next) return { next: next / 1000, running: false, err: null };
  return { next: null, running: inProgress(unit.replace(/\.timer$/, ".service")), err: null };
}
