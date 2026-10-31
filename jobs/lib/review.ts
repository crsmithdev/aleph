/**
 * The review a held run gets before it reaches Chris. One `claude -p`
 * under srt in a scratch clone of the repo, which merges the run branch onto origin/main,
 * runs the checks, reads the test diff, lists the changes outside the goal's
 * edit surface, and for a `ui` goal the harness starts the ui server on the merge
 * result and loads the changed views in Chrome (review-browser.ts), both outside the sandbox, before the reviewer starts. It writes call.md in the run folder, and only that: state.json belongs to the
 * run's owner. The verdict, a `PENDING` line or a last `ERROR: <reason>` line
 * are read back from call.md (`readCall`), and `recordReview` puts the call on the run's state.json. Nothing lands here: `reviewBack` in unit.ts passes a held run that passed both reviews.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { BROWSER, browserStep, changedViews, startUiServer } from "./review-browser.ts";
import { areasOf, reader } from "../../todo/lib/store.ts";
import { git, gitWith } from "./git.ts";
import { outcome } from "./gate.ts";
import { askOf, CALL_FILE, isAwaiting, loadRegistry, onOf, parseVerdict, readCall, readEnvFile, readRun, updateRun, type Repo, type Run } from "./ledger.ts";
import { startUnit } from "./launch.ts";
import { linkBins, runPath, sandboxed, stallReason, stallSeconds, workerToken, writeHome } from "./sandbox.ts";

/**
 * The reviewer's profile: it reads the run folder, writes only in review/ (its
 * clone and home) and tmp/, and reaches the Anthropic API and localhost, with
 * local binding. No Unix sockets: the ui server and Chrome run in the harness (review-browser.ts).
 */
export const REVIEW_SANDBOX = {
  read: ["."], write: ["review", "tmp"], net: { domains: ["api.anthropic.com", "localhost"], localBinding: true },
};

export { parseVerdict };

const RECIPE = (o: { name: string; branch: string; main: string; checks: string[]; tsc: boolean; ui: boolean; folder: string; spec: string }) => `You review job \`${o.name}\`, a run held for Chris. You are in a scratch clone of the repo
and may change nothing outside it. The clone has the run branch \`${o.branch}\` checked out and
\`origin-main\` as a local branch at origin/${o.main}. Nothing you do is pushed.

1. Merge \`${o.branch}\` onto \`origin-main\` in this clone (\`git switch -c review origin-main && git merge ${o.branch}\`). A conflict is a reason to go back.
2. Run the repo's checks on the merge result:
${o.checks.map((c) => `   - \`${c}\``).join("\n")}
${o.tsc ? `   - \`bunx tsc --noEmit\` (the clone has the repo's node_modules). Write one line \`Type check: pass\` or \`Type check: fail <n> errors\`, and name the errors the branch adds.
` : ""}3. Diff the tests (\`git diff origin-main...${o.branch}\` on test files) for dropped or weakened assertions: removed tests, removed expect lines, .skip/.only, loosened matchers.
4. List the changes outside the goal's edit surface (the "Edit surface" in the spec below).
${o.ui ? `5. The goal is labelled \`ui\`. The harness has already started the ui server on the merge result and loaded each changed view in Chrome at 1440 and 390 px wide, in light and dark.
   Do not start a server or a browser. Read \`${o.folder}/${BROWSER}/report.md\` and look at the screenshots it names. Take page errors and horizontal scroll (the \`overflow:\` line of each width and theme) from the report, not from the screenshots; record them for each view, and
   write one line \`Browser: <what you saw>\`, or \`Browser: ERROR <the report's error>\` when the report has an ERROR line or is missing, and go on.
` : ""}
Write down what you found, then end with exactly one line:
VERDICT: land
VERDICT: back <reason, one line: what the worker must fix>
VERDICT: chris <question, one line: what only Chris can decide>

## Spec

${o.spec}
`;

/**
 * The made-up jobs, issues, projects and notes of ui/fixtures/review in the clone, laid out under `dest` by this
 * repo's builder (the clone's own code does not run outside the sandbox), as the ALEPH_* variables the UI reads.
 * A clone without the fixture gets an empty home. A string is the builder's error.
 */
function fixtureEnv(work: string, dest: string): Record<string, string> | string {
  const src = join(work, "ui", "fixtures", "review");
  const env: Record<string, string> = { LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" };
  if (!existsSync(src)) return env;
  const p = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "..", "ui", "fixtures", "review", "build.ts"), dest, src], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) return `review fixture failed: ${p.stderr.toString().slice(0, 200)}`;
  for (const l of p.stdout.toString().split("\n")) { const i = l.indexOf("="); if (i > 0) env[l.slice(0, i)] = l.slice(i + 1); }
  return env;
}

/** Whether the run's goal carries the `ui` label. */
function isUi(repo: Repo, run: Run): boolean {
  const on = onOf(run);
  if (on === undefined) return false;
  const item = reader().item(repo.key, on);
  return !!item && areasOf(item).includes("ui");
}

/** Whether a review process is alive for `folder`: its review.pid names a process whose command line holds the folder. */
function reviewing(folder: string): boolean {
  try {
    const pid = Number(readFileSync(join(folder, "review.pid"), "utf8").trim());
    if (pid === process.pid) return true;
    return Number.isInteger(pid) && pid > 0 && readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(folder);
  } catch { return false; }
}

/** Run the review of the run in `folder`, to the end. Records the verdict, or `error`, and never throws; refuses, with a thrown error, when one is already running. */
export async function runReview(folder: string): Promise<void> {
  const pidFile = join(folder, "review.pid");
  if (reviewing(folder)) throw new Error(`review is already running for ${folder}`);
  writeFileSync(pidFile, String(process.pid));
  try {
    await review(folder);
  } finally {
    rmSync(pidFile, { force: true });
  }
}

/**
 * The browser step of a `ui` goal, before the reviewer starts: merge the branch onto origin-main in a worktree of the
 * scratch clone, start `bun ui/server.ts` from it outside the sandbox, load each changed view in Chrome, write browser/ in
 * the run folder, and stop the server and drop the worktree, also on an error. Never throws.
 */
async function uiBrowser(folder: string, work: string, branch: string): Promise<void> {
  const out = join(folder, BROWSER);
  const merged = join(folder, "review", "merged");
  const note = (msg: string) => writeFileSync(join(out, "report.md"), `# Browser\n\nERROR: ${msg.replace(/\s+/g, " ").slice(0, 400)}\n`);
  let server: Awaited<ReturnType<typeof startUiServer>> | null = null;
  try {
    const id = { GIT_AUTHOR_NAME: "aleph factory", GIT_AUTHOR_EMAIL: "factory@aleph.invalid", GIT_COMMITTER_NAME: "aleph factory", GIT_COMMITTER_EMAIL: "factory@aleph.invalid" };
    const w = git(work, "worktree", "add", "-q", "--detach", merged, "origin-main");
    if (!w.ok) return note(`review worktree failed: ${w.out}`);
    const m = gitWith({ env: id }, merged, "merge", "-q", "--no-edit", branch);
    if (!m.ok) return note(`the branch does not merge onto origin-main: ${m.out}`);
    // The merge result has no node_modules of its own: it shares the clone's.
    if (existsSync(join(work, "node_modules"))) symlinkSync(join(work, "node_modules"), join(merged, "node_modules"));
    const files = git(merged, "diff", "--name-only", "origin-main...HEAD").out.split("\n").filter(Boolean);
    try {
      // Not process.env: the real ALEPH_* stores and tokens stay out. The server runs on the made-up set of ui/fixtures/review.
      const fx = fixtureEnv(merged, join(folder, "review", "fixture"));
      if (typeof fx === "string") return note(fx);
      server = await startUiServer(merged, join(out, "server.log"), { PATH: runPath(), HOME: join(folder, "review", "home"), ...fx });
    } catch (e: any) {
      return note(String(e?.message ?? e));
    }
    await browserStep(folder, changedViews(files, server.url));
  } catch (e: any) {
    try { note(`browser step: ${e?.message ?? e}`); } catch { /* the run folder is gone */ }
  } finally {
    await server?.stop();
    git(work, "worktree", "remove", "--force", merged);
    rmSync(merged, { recursive: true, force: true });
  }
}

async function review(folder: string): Promise<void> {
  const run = readRun(folder)!;
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  const scratch = join(folder, "review");
  const md = join(folder, CALL_FILE);
  const fail = (reason: string) => {
    try {
      const prior = existsSync(md) ? readFileSync(md, "utf8").trimEnd() : "";
      writeFileSync(md, `${prior === "PENDING" ? "" : prior + "\n"}ERROR: ${reason.replace(/\s+/g, " ")}\n`);
    } catch { /* the run folder is gone: it was dropped */ }
  };
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
    // The repo's node_modules, copied: the sandbox reads nothing outside the run folder, and npm is out of reach.
    if (existsSync(join(repo.path, "node_modules"))) {
      const cp = Bun.spawnSync(["cp", "-a", "--reflink=auto", join(repo.path, "node_modules"), join(work, "node_modules")], { stdout: "pipe", stderr: "pipe" });
      if (cp.exitCode !== 0) return void fail(`node_modules copy failed: ${cp.stderr.toString().slice(0, 200)}`);
    }
    const ui = isUi(repo, run);
    const spec = readFileSync(join(folder, "..", run.job, "spec.md"), "utf8").trim();
    const text = RECIPE({
      name: run.name, branch: run.branch, main: repo.main, checks: repo.checks.map((c) => c.run),
      tsc: existsSync(join(work, "tsconfig.json")) && existsSync(join(work, "node_modules", "typescript")), ui, folder, spec,
    });
    writeFileSync(join(folder, "review-prompt.md"), text);
    // The reviewer's home is in the scratch folder, so its settings and git identity are writable there.
    // The reviewer's tmp/ sits in the run folder, as a worker's does in its own.
    const home = join(scratch, "home");
    writeHome(home);
    linkBins(folder);
    // browser/ exists before the sandbox starts, so the profile's read of "." holds it: the reviewer reads the harness's report there.
    for (const d of ["tmp", BROWSER]) mkdirSync(join(folder, d), { recursive: true });
    if (ui) await uiBrowser(folder, work, run.branch);
    const env: Record<string, string> = {
      ...readEnvFile(repo.env ?? process.env.ALEPH_RUN_ENV), CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || workerToken(),
      HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"),
    };
    delete env.ANTHROPIC_API_KEY;
    const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
    const argv = [process.env.ALEPH_REVIEW_CMD ?? "claude", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      "--tools", "Read", "Grep", "Glob", "Bash", "--model", "claude-opus-5-5"];
    const log = join(folder, "review.log");
    const once = async (): Promise<string | null> => {
      const r = await sandboxed(folder, `exec ${argv.map(q).join(" ")}`, {
        ...REVIEW_SANDBOX, cwd: "review/work", env, stdin: text, stdout: log, stderr: log,
        limit: Number(process.env.ALEPH_REVIEW_CALL_TIMEOUT ?? 1500), stall: stallSeconds(),
      });
      const o = outcome(existsSync(log) ? readFileSync(log, "utf8") : "");
      writeFileSync(md, o.result.trimEnd() + "\n");
      if (r.stalled) return stallReason();
      if (r.timedOut) return "time box";
      if (!o.ok) return o.line || `exit ${r.code}`;
      return parseVerdict(o.result) ? null : "no VERDICT line";
    };
    // A reviewer that gives no verdict runs once more; a second miss stays with Chris as an error.
    if (!await once()) return;
    writeFileSync(md, "PENDING\n");
    const why = await once();
    if (why) fail(why);
  } catch (e: any) {
    fail(`error: ${e?.message ?? e}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * When a run is held, start `aleph review <folder>` detached, once: call.md is written (PENDING) before the spawn, so a second pass finds it taken.
 * Returns whether it started one.
 */
export function startReview(folder: string): boolean {
  const run = readRun(folder);
  if (!run || existsSync(join(folder, CALL_FILE)) || !isAwaiting(run.state) || !["held-path", "review"].includes(askOf(run)?.reason ?? "")) return false;
  writeFileSync(join(folder, CALL_FILE), "PENDING\n");
  try {
    // Its own transient unit: the run's unit stops its whole cgroup when the run ends.
    const err = join(folder, "review.err");
    startUnit(["review", folder], { unit: `aleph-${basename(folder)}-review`, cwd: folder, output: { file: err },
      props: [`--property=StandardOutput=append:${err}`, `--property=StandardError=append:${err}`] });
  } catch (e: any) {
    writeFileSync(join(folder, CALL_FILE), `ERROR: could not start: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
    return false;
  }
  return true;
}

/**
 * When the review has ended, put its call on the run's state.json: `review: { call, reason }`, beside call.md.
 * `chris` in the VERDICT line reads as `ask`. A review that ended in an error, or is still pending, records nothing.
 * Never throws: a dropped run's folder is gone.
 */
export function recordReview(folder: string): void {
  try {
    const r = readCall(folder);
    if (!r || r.call === "pending" || r.call === "error") return;
    if (!readRun(folder)) return;
    updateRun(folder, { review: { call: r.call, ...(r.reason !== undefined && { reason: r.reason }) } });
  } catch { /* the run folder is gone */ }
}
