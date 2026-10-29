import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { tagged } from "./gate.ts";
import { readFile, allJobs } from "./job.ts";
import { jobsDir, stamp, updateRun, writeRun, type Entry, type Repo } from "./ledger.ts";

export interface Fact { fact: string; source: string }

const PATH = /^(?![a-z][a-z0-9+.-]*:\/\/)[\w.@\-]+(?:\/[\w.@\-]+)*(?::\d+)?$/i;
const SHA = /^[0-9a-f]{7,40}$/i;
const URL_ = /^https?:\/\/\S+$/i;
const valid = (s: string): boolean => URL_.test(s) || SHA.test(s) || PATH.test(s);

/**
 * The `FACT: <sentence> [source: <source>]` lines of a worker's result. A line
 * with no valid source goes to `unsourced`, whole; the caller logs those.
 */
export function parseFacts(result: string): { facts: Fact[]; unsourced: string[] } {
  const facts: Fact[] = [];
  const unsourced: string[] = [];
  for (const line of tagged(result, "FACT")) {
    const m = /^(.*?)\s*\[source:\s*([^\]]*?)\s*\]$/.exec(line);
    if (m && m[1] && valid(m[2])) facts.push({ fact: m[1], source: m[2] });
    else unsourced.push(line);
  }
  return { facts, unsourced };
}

export const FACTS_MODEL = "claude-opus-5-5";
const TIME_BOX_MS = () => Number(process.env.ALEPH_FACTS_TIMEOUT ?? 600) * 1000;

export interface Verdict { fact: string; source: string; verdict: "keep" | "reject"; reason: string; scope: string; title: string; kind?: "gotcha" | "concept" }

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The verdicts in the reviewer's output (the whole output, or its outermost braces), or why they fail the check. `source` is filled in by the caller. */
export function parseVerdicts(output: string): Verdict[] | string {
  let raw: any;
  for (const s of [output.trim(), output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)]) {
    try { raw = JSON.parse(s); break; } catch {}
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "no JSON";
  if (!Array.isArray(raw.verdicts)) return "no verdicts list";
  const out: Verdict[] = [];
  for (const [i, v] of raw.verdicts.entries()) {
    const fact = str(v?.fact);
    if (!fact) return `entry ${i + 1} has no fact`;
    if (v.verdict !== "keep" && v.verdict !== "reject") return `entry ${i + 1} has verdict ${JSON.stringify(v.verdict)}`;
    const reason = str(v.reason);
    if (!reason) return `entry ${i + 1} has no reason`;
    out.push({ fact, source: "", verdict: v.verdict, reason, scope: str(v.scope) || "global", title: str(v.title), ...(v.kind === "gotcha" || v.kind === "concept" ? { kind: v.kind } : {}) });
  }
  return out;
}

export function factsPrompt(facts: Fact[], commit: string): string {
  return `You review facts that a worker claims to have learned about a repo. Your working directory is the repo. The work landed as commit ${commit}: read the repo as landed with \`git show ${commit}:<path>\`, or read the files here. You have read-only tools. Change nothing.

Land commit: ${commit}

Facts, each with its cited source:
${facts.map((f, i) => `${i + 1}. ${f.fact}\n   source: ${f.source}`).join("\n")}

For each fact, open its cited source and judge: keep it only when that source shows the fact, and it is durable and true of the repo or its tools; reject it otherwise. Reply with one JSON object and nothing else:

{"verdicts": [{"fact": "<the fact>", "verdict": "keep" | "reject", "reason": "<one sentence>", "scope": "<the repo key, or global>", "title": "<Title Case note title>"}]}

Give exactly one entry per fact, in the order above.
`;
}

function makeRun(repo: Repo, landed: Entry): string {
  mkdirSync(jobsDir(), { recursive: true });
  const name = `facts-${landed.run.name}`;
  for (let n = 0; ; n++) {
    const folder = join(jobsDir(), `${stamp()}-${name}${n ? `-${n}` : ""}-facts`);
    try { mkdirSync(folder); } catch (e: any) { if (e.code === "EEXIST") continue; throw e; }
    writeRun(folder, { kind: "facts", job: landed.run.job, name, repo: repo.key, todo: landed.run.todo, state: "running", phase: "facts", model: FACTS_MODEL, told: true, shown: false, started: new Date().toISOString(), made: Date.now() });
    writeFileSync(join(folder, "command.txt"), `facts ${landed.run.name}\n`);
    return folder;
  }
}

/** One fresh read-only Opus run judges each fact against its source. A failed run rejects every fact. */
export async function reviewFacts(repo: Repo, landed: Entry, facts: Fact[], commit: string): Promise<{ folder: string; verdicts: Verdict[] }> {
  const folder = makeRun(repo, landed);
  const end = (reason: string) => updateRun(folder, { state: "done", reason, phase: undefined, ended: new Date().toISOString() });
  const rejectAll = (why: string): Verdict[] => facts.map((f) => ({ ...f, verdict: "reject", reason: why, scope: repo.key, title: "" }));
  try {
    const input = factsPrompt(facts, commit);
    writeFileSync(join(folder, "prompt.md"), input);
    const argv = [process.env.ALEPH_FACTS_CMD ?? "claude", "-p", "--model", FACTS_MODEL, "--tools", "Read,Grep,Glob,Bash", "--allowedTools", "Read,Grep,Glob,Bash(git show:*)"];
    const p = Bun.spawn(argv, { cwd: existsSync(repo.path) ? repo.path : undefined, env: process.env, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill(); }, TIME_BOX_MS());
    let out: string;
    try {
      const [o, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      writeFileSync(join(folder, "output.log"), o + err);
      if (timedOut) throw new Error("the facts reviewer timed out");
      if (code !== 0) throw new Error(`the facts reviewer exited ${code}`);
      out = o;
    } finally {
      clearTimeout(timer);
    }
    const parsed = parseVerdicts(out);
    const bad = typeof parsed === "string" ? parsed : parsed.length !== facts.length ? `${parsed.length} verdicts for ${facts.length} facts` : "";
    if (bad || typeof parsed === "string") {
      const why = `malformed verdicts: ${bad}`;
      end(`failed: ${why}`);
      return { folder, verdicts: rejectAll(why) };
    }
    const verdicts = parsed.map((v, i) => ({ ...v, fact: facts[i].fact, source: facts[i].source }));
    const kept = verdicts.filter((v) => v.verdict === "keep").length;
    end(`kept ${kept}, rejected ${verdicts.length - kept}`);
    return { folder, verdicts };
  } catch (e: any) {
    const why = `failed: ${e?.message ?? e}`;
    end(why);
    return { folder, verdicts: rejectAll(why) };
  }
}

const VAULT_CLI = join(import.meta.dir, "..", "..", "vault", "cli.ts");

/** The note kind for a kept fact: the reviewer's `kind`, else concept when its scope or reason says so, else gotcha. */
export const kindOf = (v: Verdict): "gotcha" | "concept" => v.kind ?? (/concept/i.test(`${v.scope} ${v.reason}`) ? "concept" : "gotcha");

/** Writes a kept fact to the vault as a draft through `vault write`. A refusal (schema, duplicate title, contradiction screen) is a rejection, not an error. */
export async function writeFact(v: Verdict, job: string, kind: "gotcha" | "concept"): Promise<{ written: true; path: string } | { written: false; reason: string }> {
  const title = v.title.replace(/[\/\\:*?"<>|\n\r]+/g, " ").replace(/\s+/g, " ").trim();
  if (!title) return { written: false, reason: "the verdict has no title" };
  // `vault write` replaces a note of the same title; the gate must not.
  const root = process.env.ALEPH_VAULT ?? join(homedir(), ".aleph", "vault");
  for (const d of ["decisions", "concepts", "entities", "projects", "gotchas", "episodes"].map((f) => join("wiki", f)).concat("archive")) {
    if (existsSync(join(root, d, `${title}.md`))) return { written: false, reason: `a note titled ${title} already exists in ${d}/` };
  }
  const today = new Date().toISOString().slice(0, 10);
  const one = (s: string) => s.replace(/\s+/g, " ").trim();
  const text = `---
kind: ${kind}
scope: ${v.scope}
confidence: reported
updated: ${today}
supersedes: []
sources: [${v.source}, job:${job}]
written_by: factory
---
**Claim.** ${one(v.fact).replace(/\.$/, "")} as of ${today}.

## Details
${v.reason}

## Evidence
${v.source}

## Related
`;
  const dir = mkdtempSync(join(tmpdir(), "fact-"));
  try {
    const draft = join(dir, `${title}.md`);
    writeFileSync(draft, text);
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.CLAUDE_CODE_SESSION_ID;
    const p = Bun.spawn(["bun", VAULT_CLI, "write", draft, "--why", `facts run of job ${job}`], { env, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) return { written: false, reason: one(err) || `vault write exited ${code}` };
    let path = `wiki/${kind === "concept" ? "concepts" : "gotchas"}/${title}.md`;
    try { path = JSON.parse(out).path ?? path; } catch {}
    return { written: true, path };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Runs the facts gate for a landed job: the sourced FACT lines of its worker's result go to
 * one reviewer run, and each kept verdict is written to the vault. Null when there is nothing to review.
 */
export async function factsGate(repo: Repo, landed: Entry, commit: string, log: (line: string) => void): Promise<{ kept: string[]; rejected: string[] } | null> {
  const name = landed.run.name;
  const job = allJobs().find((j) => j[0].run.job === landed.run.job) ?? [landed];
  const worker = job.findLast((e) => e.run.kind === "agent" || e.run.kind === "recheck");
  const result = (worker && readFile(worker, "result.md")) ?? "";
  const { facts, unsourced } = parseFacts(result);
  for (const line of unsourced) log(`${name}: fact dropped, no source: ${line}`);
  // Mark the land run first: the job is handled whatever the gate finds next.
  updateRun(landed.folder, { facts: true });
  if (!facts.length) return null;
  const { folder, verdicts } = await reviewFacts(repo, landed, facts, commit);
  const kept: string[] = [];
  const rejected: string[] = [];
  const reject = (v: Verdict, reason: string) => {
    rejected.push(`${v.fact}: ${reason}`);
    log(`${name}: fact rejected (${reason}): ${v.fact}`);
  };
  for (const v of verdicts) {
    if (v.verdict !== "keep") { reject(v, v.reason); continue; }
    const w = await writeFact(v, landed.run.job, kindOf(v));
    if (w.written) kept.push(basename(w.path, ".md"));
    else reject(v, w.reason);
  }
  updateRun(folder, { kept, rejected });
  return { kept, rejected };
}
