/**
 * Locks between processes. A lock is a directory on a tmpfs that a reboot clears, `$XDG_RUNTIME_DIR/aleph/<name>`,
 * with the holder's pid in `owner`. It comes into being whole, by a rename onto a name that must not exist, so a crash
 * cannot leave one with no owner. It is stale when that process is gone.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** How long a lock with no readable owner may stand: only a version before the atomic rename can leave one. */
const OWNERLESS_MS = 60_000;

/** How long a reclaim guard may stand before a waiter removes it as left by a crash. */
const GUARD_MS = 10_000;

const root = () => join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`, "aleph");

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === "EPERM"; }
}

/** The one way to remove a lock: another process's rename cannot land on a half-removed directory. */
function remove(dir: string): void {
  const gone = `${dir}.gone.${process.pid}.${crypto.randomUUID()}`;
  try { renameSync(dir, gone); } catch { return; }
  rmSync(gone, { recursive: true, force: true });
}

/** True when the lock has no live owner: a dead pid, or no readable pid for longer than OWNERLESS_MS. */
function isStale(dir: string): boolean {
  let text = "";
  try { text = readFileSync(join(dir, "owner"), "utf8"); } catch {}
  if (/^\d+$/.test(text)) return !pidAlive(Number(text));
  try { return Date.now() - statSync(dir).mtimeMs > OWNERLESS_MS; } catch { return false; }
}

/**
 * Remove a stale lock under a guard, so that two waiters who both saw the dead
 * owner cannot remove the live lock one of them then took. The holder of the
 * guard checks again, and only a guard holder removes a lock. A guard left by
 * a crash goes after GUARD_MS. True when this waiter held the guard.
 */
function reclaim(dir: string): boolean {
  const guard = `${dir}.reclaim`;
  try { mkdirSync(guard); } catch {
    try { if (Date.now() - statSync(guard).mtimeMs > GUARD_MS) rmSync(guard, { recursive: true, force: true }); } catch {}
    return false;
  }
  try { if (isStale(dir)) remove(dir); } finally { rmSync(guard, { recursive: true, force: true }); }
  return true;
}

/**
 * The tries at the lock `name` up to `waitMs`: yields each pause in ms, and returns the release, or null at the
 * deadline. A waiter that loses the reclaim guard waits like any other, so the deadline holds.
 */
function* tries(name: string, waitMs: number): Generator<number, (() => void) | null> {
  mkdirSync(root(), { recursive: true });
  const dir = join(root(), name);
  const deadline = Date.now() + waitMs;
  const made = `${dir}.new.${process.pid}.${crypto.randomUUID()}`;
  mkdirSync(made);
  writeFileSync(join(made, "owner"), String(process.pid));
  try {
    for (;;) {
      try {
        renameSync(made, dir); // A non-empty directory at `dir` refuses it.
        return () => remove(dir);
      } catch (e: any) {
        if (e.code !== "EEXIST" && e.code !== "ENOTEMPTY") throw e;
      }
      if (isStale(dir) && reclaim(dir)) continue;
      if (Date.now() >= deadline) return null;
      yield 50;
    }
  } finally {
    rmSync(made, { recursive: true, force: true });
  }
}

/** Take the lock `name`, waiting up to `waitMs`. Returns its release, or null when it stays held. */
export async function lock(name: string, waitMs = 20_000): Promise<(() => void) | null> {
  const it = tries(name, waitMs);
  for (let r = it.next(); ; r = it.next()) {
    if (r.done) return r.value;
    await Bun.sleep(r.value);
  }
}

/** `lock` that blocks the thread while it waits. */
export function lockSync(name: string, waitMs = 20_000): (() => void) | null {
  const it = tries(name, waitMs);
  for (let r = it.next(); ; r = it.next()) {
    if (r.done) return r.value;
    Bun.sleepSync(r.value);
  }
}

/** True when a live process holds the lock `name`. */
export function held(name: string): boolean {
  const dir = join(root(), name);
  return existsSync(dir) && !isStale(dir);
}
