import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tagged } from "./gate.ts";
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

export interface Verdict { fact: string; source: string; verdict: "keep" | "reject"; reason: string; scope: string; title: string }

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
    out.push({ fact, source: "", verdict: v.verdict, reason, scope: str(v.scope) || "global", title: str(v.title) });
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
