/**
 * The doc-claims check on this repo: which docs it reads, and the code they are compared with.
 * `bun jobs/lib/gates/doc-claims-repo.ts` (or `aleph doc-claims`) prints each claim the code does not back
 * and exits 1; `doc-claims.test.ts` runs the same check as part of `bun run test`, so the factory's
 * checks run it on the commit a job ends with, after its last edit.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { docProblems, type Doc, type Truth } from "./doc-claims.ts";
import * as s from "../infra/settings.ts";
import { stallSeconds } from "../roles/agent-run.ts";
import { JEV_PASS_BELOW } from "../../../hooks/lib/judge.ts";
import { judgeChoice } from "../../../lib/jev.ts";
import { spoolDir } from "../../../hooks/lib/handshake.ts";
import { classifyEnvironment, GH_USER_CMD } from "../../../lib/env.ts";
import { DEFAULT_WARN } from "../../../hooks/lib/context.ts";
import { homedir, tmpdir } from "node:os";

export const ROOT = resolve(import.meta.dir, "..", "..", "..");

/** The docs the check reads: README.md, docs/*.md, llms.txt and compose/README.md. Specs and findings are records of their day, not claims about main. */
export function repoDocs(root = ROOT): Doc[] {
  const docs = existsSync(join(root, "docs")) ? readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`) : [];
  return ["README.md", "llms.txt", "compose/README.md", ...docs].filter((f) => existsSync(join(root, f))).map((file) => ({ file, text: readFileSync(join(root, file), "utf8") }));
}

/** The repo's files: git's list when the root is a checkout, else a scan without node_modules. */
function repoFiles(root: string): string[] {
  const g = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe", stderr: "ignore" });
  if (g.exitCode === 0) return g.stdout.toString().split("\0").filter(Boolean);
  return [...new Bun.Glob("**/*").scanSync({ cwd: root })].filter((f) => !f.includes("node_modules"));
}

/** Runs `fn` with `name` unset and `extra` set, then puts the environment back. */
function bare<T>(name: string, fn: () => T, extra: Record<string, string> = {}): T {
  const keys = [name, ...Object.keys(extra)];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  delete process.env[name];
  Object.assign(process.env, extra);
  try { return fn(); } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
}

const plain = (name: string, fn: () => string | number) => () => bare(name, fn);

/** Each setting a doc may give a default for, read from the code with its variable unset. */
export const DEFAULTS: Truth["defaults"] = {
  ALEPH_LIVE_CAP: () => s.LIVE_CAP_DEFAULT,
  ALEPH_DIRECTOR_CAP: plain("ALEPH_DIRECTOR_CAP", s.DIRECTOR_CAP),
  ALEPH_INTAKE_CAP: plain("ALEPH_INTAKE_CAP", s.INTAKE_CAP),
  ALEPH_INTAKE_TRIES: plain("ALEPH_INTAKE_TRIES", s.INTAKE_TRIES),
  ALEPH_PROPOSE_AT: plain("ALEPH_PROPOSE_AT", s.PROPOSE_AT),
  ALEPH_JOB_TIMEOUT: plain("ALEPH_JOB_TIMEOUT", s.jobSeconds),
  ALEPH_CHECK_TIMEOUT: plain("ALEPH_CHECK_TIMEOUT", s.checkSeconds),
  ALEPH_REVIEW_TIMEOUT: plain("ALEPH_REVIEW_TIMEOUT", s.reviewSeconds),
  ALEPH_REVIEW_DIFF_MAX: plain("ALEPH_REVIEW_DIFF_MAX", s.reviewDiffMax),
  ALEPH_STALL_SECONDS: plain("ALEPH_STALL_SECONDS", stallSeconds),
  ALEPH_FIX_ROUNDS: plain("ALEPH_FIX_ROUNDS", s.fixRounds),
  ALEPH_LAND_BATCH: plain("ALEPH_LAND_BATCH", s.landBatch),
  ALEPH_LOAD_LIMIT: () => s.LOAD_LIMIT_DEFAULT,
  ALEPH_UI_CACHE_TTL: plain("ALEPH_UI_CACHE_TTL", () => s.uiCacheMs() / 1000),
  ALEPH_UI_FETCH_TTL: plain("ALEPH_UI_FETCH_TTL", s.uiFetchTtl),
  ALEPH_UI_PORT: plain("ALEPH_UI_PORT", s.uiPort),
  ALEPH_WORKER_CMD: plain("ALEPH_WORKER_CMD", s.workerCmd),
  ALEPH_REVIEWER_CMD: () => bare("ALEPH_REVIEWER_CMD", () => s.reviewerCmd() === "worker-sentinel" ? "the worker command" : s.reviewerCmd(), { ALEPH_WORKER_CMD: "worker-sentinel" }),
  ALEPH_JEV_PASS_BELOW: plain("ALEPH_JEV_PASS_BELOW", JEV_PASS_BELOW),
  ALEPH_RUN_CAP: () => s.RUN_CAP_DEFAULT,
  ALEPH_CONTEXT_WARN: () => DEFAULT_WARN,
  ALEPH_GH_USER: () => GH_USER_CMD.join(" "),
  ALEPH_JUDGE: () => bare("ALEPH_JUDGE", judgeChoice, { ALEPH_JUDGE_FILE: join(tmpdir(), "no-such-judge-file") }),
  ALEPH_SPOOL: () => bare("ALEPH_SPOOL", spoolDir).replace(homedir(), "~"),
  ALEPH_ENV: () => bare("ALEPH_ENV", () => classifyEnvironment([])),
  ALEPH_DISPATCH: () => bare("ALEPH_DISPATCH", s.dispatchOn) ? "on" : "off",
};

/** What the docs of `root` are compared with: its source, its CLI source, its files and DEFAULTS. */
export function repoTruth(root = ROOT): Truth {
  const files = repoFiles(root);
  const read = (fs: string[]) => fs.map((f) => { try { return readFileSync(join(root, f), "utf8"); } catch { return ""; } }).join("\n");
  const code = (f: string) => /^(hooks|jobs|issues|ui|vault|lib|tests)\/.*\.ts$/.test(f) || /^bin\/[^/]+$/.test(f);
  return {
    defaults: DEFAULTS,
    root,
    files,
    source: read(files.filter((f) => (code(f) || f === "package.json" || /^compose\/[^/]+$/.test(f) || f === ".env.example") && !f.startsWith("jobs/lib/gates/doc-claims"))),
    cliSource: read(files.filter((f) => code(f) && !f.startsWith("tests/") && !f.endsWith(".test.ts") && !f.startsWith("jobs/lib/gates/doc-claims"))),
  };
}

/** The check on `root` as it is now: each claim the code does not back. */
export const repoProblems = (root = ROOT): string[] => docProblems(repoDocs(root), repoTruth(root));

/** The check's output: one line per problem, then a count; `ok` when there is none. */
export function docClaimsReport(root = ROOT): { ok: boolean; text: string } {
  const problems = repoProblems(root);
  const n = problems.length;
  return { ok: !n, text: [...problems, n ? `${n} doc claim${n > 1 ? "s" : ""} the code does not back` : "every checked doc claim matches the code"].join("\n") };
}

if (import.meta.main) {
  const r = docClaimsReport();
  console.log(r.text);
  process.exit(r.ok ? 0 : 1);
}
