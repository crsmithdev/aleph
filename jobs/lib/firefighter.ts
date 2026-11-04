/**
 * The firefighter, as code: no agent runs. Each tick it reads the reds of the factory repos (a failed baseline in
 * baseline.json, a red GitHub CI on main in ci.json, a failed sandbox probe in probe.json) and files one critical
 * issue per failing commit, with the tail of the failure's log in its request. The request names the commit
 * (`Failing commit: <sha>`), so a second tick, or a second source for the same commit, files nothing more. While the
 * repo has an open red-main issue, a new failing commit is one note on that issue, not a second issue. It also sets a
 * rescue Ask on each land live past 30 minutes (`askSlowLands`, rescue.ts). Stuck, failed and lost runs are the
 * rescue's (rescue.ts), and a goal that loops is the loop guard's (goal-decision.ts); their Asks are the director's.
 * Older ledgers hold runs of kind `firefighter`, from when this was an agent.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { loadRegistry, type Repo } from "./ledger.ts";
import { redCi, ciLine } from "./ci.ts";
import { baselines, factoryDir, factoryRepos, gates, lastProbe, redLine } from "./factory-status.ts";
import { factoryLog } from "./layout.ts";
import { askSlowLands } from "./rescue.ts";
import { runFile } from "./run-files.ts";

/** The most of a log that goes into an issue's request: its last LOG_LINES lines, cut to LOG_CHARS. */
export const LOG_LINES = 200;
export const LOG_CHARS = 8000;
/** The most of a log that goes into a note: one line. */
const NOTE_CHARS = 300;

export type Source = "baseline" | "ci" | "probe";
const SOURCE_NAME: Record<Source, string> = { baseline: "the baseline checks", ci: "GitHub CI on main", probe: "the sandbox probe" };

/** One failure the firefighter files: the repo, the failing commit, what failed, and its log, read only when it is filed. */
export interface Red { repo: string; commit: string; source: Source; line: string; log: () => string }

/** How the firefighter reads what is outside the factory directory. Tests replace it. */
export interface Ports {
  /** The failed jobs' log of the GitHub CI run at `url`. */
  ciLog: (repo: Repo, url: string) => string;
}

const ghLog = (repo: Repo, url: string): string => {
  const id = /\/runs\/(\d+)/.exec(url)?.[1];
  if (!id) return `(no run id in ${url})`;
  const r = spawnSync("gh", ["run", "view", id, "--log-failed"], { cwd: repo.path, encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : `(gh run view ${id} --log-failed failed: ${(r.stderr || r.error?.message || `exit ${r.status}`).trim()})`;
};
export const defaultPorts: Ports = { ciLog: ghLog };

const read = (path: string): string => { try { return readFileSync(path, "utf8"); } catch { return ""; } };

/** The last LOG_LINES lines of a log, cut to LOG_CHARS from the front. */
export function tail(text: string): string {
  const t = text.trimEnd().split("\n").slice(-LOG_LINES).join("\n");
  return t.length > LOG_CHARS ? `…${t.slice(t.length - LOG_CHARS + 1)}` : t;
}

/** The last non-empty lines of a log as one line of at most NOTE_CHARS. */
const oneLine = (text: string): string => {
  const t = text.split("\n").map((l) => l.trim()).filter(Boolean).join(" | ");
  return t.length > NOTE_CHARS ? `…${t.slice(t.length - NOTE_CHARS + 1)}` : t;
};

/** Every red of the factory repos now: the failed baselines, the red CIs, and the last probe when it failed. */
export function reds(ports: Ports = defaultPorts): Red[] {
  const reg = loadRegistry();
  const keys = new Set(factoryRepos().map((r) => r.key));
  const out: Red[] = [];
  for (const b of Object.values(baselines())) {
    if (b.ok || !keys.has(b.repo)) continue;
    out.push({ repo: b.repo, commit: b.commit, source: "baseline", line: `${b.repo} ${redLine(b)}`, log: () => read(runFile(join(factoryDir(), "baseline", b.repo), "checks.log")) });
  }
  for (const c of redCi()) {
    if (!keys.has(c.repo) || !c.sha) continue;
    out.push({ repo: c.repo, commit: c.sha, source: "ci", line: ciLine(c), log: () => ports.ciLog(reg[c.repo], c.url) });
  }
  const p = lastProbe();
  const repo = p?.repo ?? factoryRepos()[0]?.key;
  if (p && !p.ok && repo && keys.has(repo)) {
    const log = () => [read(join(factoryDir(), "probe.log")), read(join(factoryDir(), "probe.log.stderr"))].filter((t) => t.trim()).join("\n");
    // An older probe record has no commit: its time stands for it.
    out.push({ repo, commit: p.commit ?? `probe at ${p.at}`, source: "probe", line: `the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}`, log });
  }
  return out;
}

const mark = (commit: string) => `Failing commit: ${commit}`;
const isRedMain = (i: issues.Issue) => store.areasOf(i).includes("red-main") || store.labels(i).includes("red-main");
/** The issue that holds this commit already: in its request, as filed, or in a note, as a later commit during an open fix. */
const holds = (i: issues.Issue, commit: string) => isRedMain(i) && (i.request.includes(mark(commit)) || i.notes.some((n) => n.includes(mark(commit))));

const TITLES: Record<Source, string> = { baseline: "Fix the red main at", ci: "Fix the red CI on main at", probe: "Fix the failed sandbox probe at" };
const titleOf = (r: Red) => (/^[0-9a-f]{7,}$/.test(r.commit) ? `${TITLES[r.source]} ${r.commit.slice(0, 7)}` : TITLES[r.source].replace(/ at$/, ""));

export type Filed = { repo: string; commit: string; source: Source } & ({ filed: number } | { noted: number });

/**
 * File one red: nothing when an issue of the repo already holds its commit; a note on the newest open red-main issue
 * when there is one; else a new critical issue with the log's tail. The check runs again inside the write, on the
 * store as it is then, so two ticks at once file it once.
 */
export function fileRed(r: Red): Filed | null {
  if ((store.reader().list(r.repo)?.items ?? []).some((i) => holds(i, r.commit))) return null;
  const repo = loadRegistry()[r.repo];
  if (!repo) return null;
  const log = tail(r.log());
  const request = `${mark(r.commit)}\nFailed: ${SOURCE_NAME[r.source]}\n${r.line}\n\nThe last ${LOG_LINES} lines of the log, at most ${LOG_CHARS} characters:\n\n\`\`\`\n${log || "(no log)"}\n\`\`\`\n`;
  const w = store.writeList(repo, `firefighter: ${SOURCE_NAME[r.source]} red at ${r.commit.slice(0, 7)}`, (doc): Filed | null => {
    if (doc.items.some((i) => holds(i, r.commit))) return null;
    const open = doc.items.filter((i) => issues.status(i) === "open" && isRedMain(i)).at(-1);
    const at = { repo: r.repo, commit: r.commit, source: r.source };
    if (open) {
      issues.note(open, `firefighter: ${mark(r.commit)}; ${SOURCE_NAME[r.source]} failed again while this fix is open: ${r.line}${log ? `; log: ${oneLine(log)}` : ""}`);
      return { ...at, noted: open.id };
    }
    return { ...at, filed: issues.add(doc, titleOf(r), { kind: "bug", priority: "critical", labels: ["red-main"], source: "agent", request }).id };
  }, true);
  return w?.value ?? null;
}

export interface Fired { filed: Filed[]; asked: string[] }

/**
 * The tick's firefighter: file each red, then ask about each slow land. Under the pause alone. An error is a factory log
 * line, never thrown.
 */
export async function firefight(ports: Ports = defaultPorts, now = Date.now()): Promise<Fired | null> {
  if (gates({ only: ["pause"] })) return null;
  const filed: Filed[] = [];
  for (const r of (() => { try { return reds(ports); } catch (e: any) { factoryLog(`firefighter: failed: ${e?.message ?? e}`); return []; } })()) {
    try {
      const f = fileRed(r);
      if (!f) continue;
      filed.push(f);
      factoryLog("filed" in f ? `firefighter: filed ${f.repo}-${f.filed} (critical) for ${r.line}` : `firefighter: noted ${f.repo}-${f.noted}: also red at ${r.commit.slice(0, 7)}: ${r.line}`);
    } catch (e: any) {
      factoryLog(`firefighter: ${r.repo} red at ${r.commit.slice(0, 7)} not filed: ${e?.message ?? e}`);
    }
  }
  let asked: string[] = [];
  try { asked = await askSlowLands(now); } catch (e: any) { factoryLog(`firefighter: slow lands: failed: ${e?.message ?? e}`); }
  return { filed, asked };
}
