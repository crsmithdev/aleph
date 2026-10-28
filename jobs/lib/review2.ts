/**
 * review2: the review a held run gets before it reaches Chris. One `claude -p`
 * under srt in a scratch clone of the repo, which merges the run branch onto origin/main,
 * runs the checks, reads the test diff, lists the changes outside the goal's
 * edit surface, and for a `ui` goal has the harness load the changed views in
 * Chrome (review2-browser.ts), outside the sandbox. It writes review2.md in the run folder, and only that: state.json belongs to the
 * run's owner. The verdict, a `PENDING` line or a last `ERROR: <reason>` line
 * are read back from review2.md (`readReview2`). Nothing lands: Land stays a click.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { BROWSER, VIEWS, watchViews } from "./review2-browser.ts";
import { hasLabel, reader } from "../../todo/lib/store.ts";
import { git } from "./git.ts";
import { outcome } from "./gate.ts";
import { LOW, loadRegistry, parseVerdict, readEnvFile, readRun, type Repo, type Run } from "./ledger.ts";
import { linkBins, runPath, sandboxed, workerToken, writeHome } from "./sandbox.ts";

/**
 * The reviewer's profile: it reads the run folder, writes only in review2/ (its
 * clone and home) and tmp/ (where its browse request, tmp/views.txt, goes), and
 * reaches the Anthropic API and localhost, which a `ui` goal's server needs, with
 * local binding. No Unix sockets: Chrome runs in the harness (review2-browser.ts).
 */
export const REVIEW2_SANDBOX = {
  read: ["."], write: ["review2", "tmp"], net: { domains: ["api.anthropic.com", "localhost"], localBinding: true },
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
${o.ui ? `5. The goal is labelled \`ui\`. You cannot start a browser; the harness loads the views for you. Start \`bun ui/server.ts --port <free port>\` in the background (it listens on 127.0.0.1).
   Write the URL of each changed view, one per line (\`http://127.0.0.1:<port>/...\`, at most 8), to \`${o.folder}/tmp/views.part\`, then
   \`mv\` it to \`${o.folder}/${VIEWS}\`. The harness takes that file and loads each view at 1440 and 390 px wide, in light and dark, and writes
   \`${o.folder}/${BROWSER}/report.md\` last: wait for it (poll up to 5 minutes), then read it and look at the screenshots it names for anything else.
   Take page errors and horizontal scroll (the \`overflow:\` line of each width and theme) from the report, not from the screenshots; record them for each view, and write one line \`Browser: <what you saw>\`, or \`Browser: ERROR <the report's error>\` when
   the report has an ERROR line or never came, and go on. Stop the server.
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
  const item = reader().item(repo.key, run.todo);
  return !!item && hasLabel(item, "ui");
}

/** Whether a review2 process is alive for `folder`: its review2.pid names a process whose command line holds the folder. */
function reviewing(folder: string): boolean {
  try {
    const pid = Number(readFileSync(join(folder, "review2.pid"), "utf8").trim());
    if (pid === process.pid) return true;
    return Number.isInteger(pid) && pid > 0 && readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(folder);
  } catch { return false; }
}

/** Run the review of the run in `folder`, to the end. Records the verdict, or `error`, and never throws; refuses, with a thrown error, when one is already running. */
export async function runReview2(folder: string): Promise<void> {
  const pidFile = join(folder, "review2.pid");
  if (reviewing(folder)) throw new Error(`review2 is already running for ${folder}`);
  writeFileSync(pidFile, String(process.pid));
  try {
    await review(folder);
  } finally {
    rmSync(pidFile, { force: true });
  }
}

async function review(folder: string): Promise<void> {
  const run = readRun(folder)!;
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  const scratch = join(folder, "review2");
  const md = join(folder, "review2.md");
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
    writeFileSync(join(folder, "review2-prompt.md"), text);
    // The reviewer's home is in the scratch folder, so its settings and git identity are writable there.
    // srt's sockets and the reviewer's tmp/ sit in the run folder, as a worker's do in its own.
    const home = join(scratch, "home");
    writeHome(home);
    linkBins(folder);
    // browser/ exists before the sandbox starts, so the profile's read of "." holds it: the reviewer reads the harness's report there.
    for (const d of ["sock", "tmp", BROWSER]) mkdirSync(join(folder, d), { recursive: true });
    rmSync(join(folder, VIEWS), { force: true });
    const env: Record<string, string> = {
      ...readEnvFile(repo.env ?? process.env.ALEPH_RUN_ENV), CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || workerToken(),
      HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"),
    };
    delete env.ANTHROPIC_API_KEY;
    const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
    const argv = [process.env.ALEPH_REVIEW2_CMD ?? "claude", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      "--tools", "Read", "Grep", "Glob", "Bash", "--model", "claude-opus-5-5"];
    const log = join(folder, "review2.log");
    let root: number | undefined;
    const views = ui ? watchViews(folder, () => root, { sandbox: !process.env.ALEPH_SANDBOX_CMD }) : null;
    const r = await sandboxed(folder, `exec ${argv.map(q).join(" ")}`, {
      ...REVIEW2_SANDBOX, cwd: "review2/work", env, stdin: text, stdout: log, stderr: log,
      limit: Number(process.env.ALEPH_REVIEW2_TIMEOUT ?? 1500), onSpawn: (p) => { root = p.pid; },
    }).finally(() => views?.stop());
    const o = outcome(existsSync(log) ? readFileSync(log, "utf8") : "");
    writeFileSync(md, o.result.trimEnd() + "\n");
    if (r.timedOut) return void fail("time box");
    if (!o.ok) return void fail(o.line || `exit ${r.code}`);
    if (!parseVerdict(o.result)) return void fail("no VERDICT line");
  } catch (e: any) {
    fail(`error: ${e?.message ?? e}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * When a run is held, start `aleph review2 <folder>` detached, once: review2.md is written (PENDING) before the spawn, so a second pass finds it taken.
 * Returns whether it started one.
 */
export function startReview2(folder: string): boolean {
  const run = readRun(folder);
  if (!run || existsSync(join(folder, "review2.md")) || run.state !== "needs-you" || (run.needs !== "held" && run.needs !== "review")) return false;
  writeFileSync(join(folder, "review2.md"), "PENDING\n");
  try {
    const cli = join(import.meta.dir, "..", "cli.ts");
    if (process.env.ALEPH_JOB_FOREGROUND === "1") {
      const log = openSync(join(folder, "review2.err"), "a");
      try {
        Bun.spawn([process.execPath, cli, "review2", folder], { env: process.env, stdin: "ignore", stdout: log, stderr: log, detached: true }).unref();
      } finally {
        closeSync(log);
      }
    } else {
      // Its own transient unit: the run's unit stops its whole cgroup when the run ends.
      const pass = Object.entries(process.env).filter(([k]) => k.startsWith("ALEPH_") || k.startsWith("SIDETONE_")).map(([k, v]) => `--setenv=${k}=${v}`);
      const p = Bun.spawnSync(["systemd-run", "--user", "--collect", "--quiet", ...LOW, `--unit=aleph-${basename(folder)}-review2`, `--working-directory=${folder}`,
        `--property=StandardOutput=append:${join(folder, "review2.err")}`, `--property=StandardError=append:${join(folder, "review2.err")}`,
        `--setenv=PATH=${runPath()}`, ...pass, process.execPath, cli, "review2", folder], { stdout: "pipe", stderr: "pipe" });
      if (p.exitCode !== 0) throw new Error(`systemd-run failed: ${p.stderr.toString().trim()}`);
    }
  } catch (e: any) {
    writeFileSync(join(folder, "review2.md"), `ERROR: could not start: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
    return false;
  }
  return true;
}
