import { spawnSync } from "bun";

export const TRAILER = "Co-Authored-By: Claude <noreply@anthropic.com>";

export function git(dir: string, ...args: string[]): { ok: boolean; out: string } {
  const p = spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = (p.stdout.toString() + p.stderr.toString()).trim();
  return { ok: p.exitCode === 0, out };
}

/** Stage everything and commit with the agent trailer. Returns the short sha, or null when nothing changed. */
export function commitAll(dir: string, subject: string): string | null {
  git(dir, "add", "-A");
  if (git(dir, "diff", "--cached", "--quiet").ok) return null;
  const r = git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", `${subject}\n\n${TRAILER}`);
  if (!r.ok) throw new Error(`git commit failed: ${r.out}`);
  return git(dir, "rev-parse", "--short", "HEAD").out;
}
