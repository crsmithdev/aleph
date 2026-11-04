/**
 * The main clone: a fresh clone of the repo at `origin/<main>`, made just before a read-only agent run
 * (triage, the planner, the spec check) and removed after it. The repo's checkout can be behind
 * `origin/<main>`; the clone is not, so the agent reads the code that is on main now.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchOrigin, git } from "./git.ts";
import type { Repo } from "./ledger.ts";

/**
 * Fetches `origin/<main>` into the repo, clones the repo (`--shared`) into a new temporary folder, checks out
 * `origin/<main>` there detached, calls `use` with the folder and removes the folder when `use` ends.
 * It throws when the fetch, the clone or the checkout fails.
 */
export async function withMainClone<T>(repo: Pick<Repo, "path" | "main">, prefix: string, use: (dir: string) => Promise<T>): Promise<T> {
  const f = fetchOrigin(repo.path, repo.main);
  if (!f.ok) throw new Error(`fetch of origin failed: ${f.out}`);
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    const c = git(tmpdir(), "clone", "-q", "--shared", "--no-checkout", repo.path, dir);
    if (!c.ok) throw new Error(`clone failed: ${c.out}`);
    // The clone's own origin is `repo.path`, so take that repo's remote-tracking main, not its local one.
    const r = git(dir, "fetch", "-q", repo.path, `+refs/remotes/origin/${repo.main}:refs/remotes/origin/${repo.main}`);
    if (!r.ok) throw new Error(`fetch failed: ${r.out}`);
    const o = git(dir, "checkout", "-q", "--detach", `origin/${repo.main}`);
    if (!o.ok) throw new Error(`checkout failed: ${o.out}`);
    return await use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
