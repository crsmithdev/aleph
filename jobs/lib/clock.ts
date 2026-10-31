/**
 * Clock checks shared by `aleph doctor` and the sandbox probe: the wall clock
 * against the monotonic clock, and WSL against Windows time. After the
 * 2026-10-30 power loss the wall clock stepped under a running suite.
 */
import { readFileSync } from "node:fs";

export const STEP_LIMIT_MS = 1000;
export const SKEW_LIMIT_MS = 5000;

export interface Clocks { wall: () => number; mono: () => number }
const real: Clocks = { wall: () => Date.now(), mono: () => performance.now() };

/** How far the wall clock moved beyond the monotonic clock since `start`: positive when it jumped forward. */
export const wallStepSince = (start: { wall: number; mono: number }, c: Clocks = real): number =>
  (c.wall() - start.wall) - (c.mono() - start.mono);

export const clockStart = (c: Clocks = real) => ({ wall: c.wall(), mono: c.mono() });

/** Watch both clocks for `windowMs`. Returns the step in milliseconds. */
export async function watchWall(windowMs: number, c: Clocks = real): Promise<number> {
  const start = clockStart(c);
  await Bun.sleep(windowMs);
  return wallStepSince(start, c);
}

export function onWsl(): boolean {
  if (process.env.ALEPH_WINDOWS_TIME_CMD) return true;
  if (process.env.WSL_DISTRO_NAME) return true;
  try { return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8")); } catch { return false; }
}

/** Windows time minus WSL time, in milliseconds, or null when Windows could not be asked (or this is not WSL). */
export function windowsSkew(): number | null {
  if (!onWsl()) return null;
  const cmd = process.env.ALEPH_WINDOWS_TIME_CMD ?? `powershell.exe -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()"`;
  const before = Date.now();
  const p = Bun.spawnSync(["bash", "-c", cmd], { stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout: 20_000 });
  const after = Date.now();
  const win = Number(p.stdout.toString().trim());
  if (p.exitCode !== 0 || !Number.isFinite(win) || win <= 0) return null;
  return win - (before + after) / 2;
}
