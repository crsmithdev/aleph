/**
 * review2: the review a held run gets before it reaches Chris. One `claude -p`
 * in a scratch clone of the repo, which merges the run branch onto origin/main,
 * runs the checks, reads the test diff, lists the changes outside the goal's
 * edit surface, and for a `ui` goal loads the changed views in a browser. It
 * writes review2.md in the run folder; its `VERDICT:` line lands on the run as
 * `review2: { verdict, reason }`. Nothing lands on it: Land stays a click.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readList } from "../../todo/lib/store.ts";
import { git } from "./git.ts";
import { outcome, tagged } from "./gate.ts";
import { loadRegistry, readEnvFile, readRun, updateRun, type Repo, type Run } from "./ledger.ts";
import { runPath, workerToken } from "./sandbox.ts";

/** The last `VERDICT:` line: `land`, `back <reason>` or `chris <question>`; null when it is none of them. */
export function parseVerdict(result: string): NonNullable<Run["review2"]> | null {
  const v = tagged(result, "VERDICT").at(-1);
  if (v === undefined) return null;
  if (v === "land") return { verdict: "land" };
  const m = v.match(/^(back|chris)\s+(\S.*)$/);
  return m ? { verdict: m[1] as "back" | "chris", reason: m[2] } : null;
}

const RECIPE = (o: { name: string; branch: string; main: string; checks: string[]; ui: boolean; spec: string }) => `You review job \`${o.name}\`, a run held for Chris. You are in a scratch clone of the repo
and may change nothing outside it. The clone has the run branch \`${o.branch}\` checked out and
\`origin-main\` as a local branch at origin/${o.main}. Nothing you do is pushed.

1. Merge \`${o.branch}\` onto \`origin-main\` in this clone (\`git switch -c review origin-main && git merge ${o.branch}\`). A conflict is a reason to go back.
2. Run the repo's checks on the merge result:
${o.checks.map((c) => `   - \`${c}\``).join("\n")}
3. Diff the tests (\`git diff origin-main...${o.branch}\` on test files) for dropped or weakened assertions: removed tests, removed expect lines, .skip/.only, loosened matchers.
4. List the changes outside the goal's edit surface (the "Edit surface" in the spec below).
${o.ui ? `5. The goal is labelled \`ui\`. Start a one-off \`bun ui/server.ts\` on a free port, and with Playwright and \`/usr/bin/google-chrome\` load each changed view at 1440 and 390 px wide, in light and dark. Record page errors and horizontal scroll for each. Stop the server.
` : ""}
Write down what you found, then end with exactly one line:
VERDICT: land
VERDICT: back <reason, one line: what the worker must fix>
VERDICT: chris <question, one line: what only Chris can decide>

## Spec

${o.spec}
`;

/** Whether the run's goal carries the `ui` label. */
function isUi(repo: Repo, run: Run): boolean {
  if (run.todo === undefined) return false;
  try {
    const item = readList({ key: repo.key })?.items.find((i) => i.id === run.todo);
    return ((item?.fm.labels as string[]) ?? []).includes("ui");
  } catch { return false; }
}

/** Run the review of the run in `folder`, to the end. Records the verdict, or `error`, and never throws. */
export async function runReview2(folder: string): Promise<void> {
  const run = readRun(folder)!;
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  const scratch = join(folder, "review2");
  const fail = (reason: string) => updateRun(folder, { review2: { verdict: "error", reason } });
  try {
    if (!repo || !run.branch) return void fail("no repo or branch");
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(scratch, { recursive: true });
    const work = join(scratch, "work");
    const base = `refs/remotes/origin/${repo.main}`;
    for (const args of [["clone", "-q", repo.path, work], ["-C", work, "fetch", "-q", repo.path, `${base}:refs/heads/origin-main`], ["-C", work, "switch", "-q", run.branch]]) {
      const g = git(scratch, ...args);
      if (!g.ok) return void fail(`scratch clone failed: ${g.out.slice(0, 200)}`);
    }
    const spec = readFileSync(join(folder, "..", run.job, "spec.md"), "utf8").trim();
    const text = RECIPE({ name: run.name, branch: run.branch, main: repo.main, checks: repo.checks.map((c) => c.run), ui: isUi(repo, run), spec });
    writeFileSync(join(folder, "review2-prompt.md"), text);
    const env: Record<string, string | undefined> = {
      ...process.env, ...readEnvFile(repo.env ?? process.env.ALEPH_RUN_ENV), PATH: runPath(),
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? (workerToken() || undefined),
    };
    delete env.ANTHROPIC_API_KEY;
    delete env.CLAUDECODE;
    const argv = [process.env.ALEPH_REVIEW2_CMD ?? "claude", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      "--tools", "Read", "Grep", "Glob", "Bash", "--model", "claude-opus-5-5"];
    const log = join(folder, "review2.log");
    const fd = openSync(log, "a");
    const limit = Number(process.env.ALEPH_REVIEW2_TIMEOUT ?? 1500);
    const start = performance.now();
    const p = Bun.spawn(["timeout", "--kill-after=30", String(limit), ...argv], { cwd: work, env, stdin: new Blob([text]), stdout: fd, stderr: fd });
    const code = await p.exited;
    closeSync(fd);
    const o = outcome(existsSync(log) ? readFileSync(log, "utf8") : "");
    writeFileSync(join(folder, "review2.md"), o.result);
    if (performance.now() - start >= limit * 1000) return void fail("time box");
    if (!o.ok) return void fail(o.line || `exit ${code}`);
    const v = parseVerdict(o.result);
    if (!v) return void fail("no VERDICT line");
    updateRun(folder, { review2: v });
  } catch (e: any) {
    fail(`error: ${e?.message ?? e}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * When a run is held, start `aleph review2 <folder>` detached, once: the run's
 * `review2` field is set before the spawn, so a second pass finds it taken.
 * Returns whether it started one.
 */
export function startReview2(folder: string): boolean {
  const run = readRun(folder);
  if (!run || run.review2 || run.state !== "needs-you" || (run.needs !== "held" && run.needs !== "review")) return false;
  updateRun(folder, { review2: { verdict: "pending" } });
  try {
    const log = openSync(join(folder, "review2.err"), "a");
    try {
      Bun.spawn([process.execPath, join(import.meta.dir, "..", "cli.ts"), "review2", folder], { env: process.env, stdin: "ignore", stdout: log, stderr: log, detached: true }).unref();
    } finally {
      closeSync(log);
    }
  } catch (e: any) {
    updateRun(folder, { review2: { verdict: "error", reason: `could not start: ${e?.message ?? e}` } });
    return false;
  }
  return true;
}
