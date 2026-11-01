/**
 * The author: before a goal's first worker run, one read-only `claude -p` run writes
 * hidden checks from the goal alone. They count only if they fail by assertion on
 * today's main: a test that passes proves nothing, and one that cannot load would
 * block every run of the goal. A goal gets one attempt; the issue's note says how it
 * went, and a goal with no sealed check runs as before.
 */
import { existsSync } from "node:fs";
import { note, reader, writeHidden } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { sandboxRunner, type Ran, type Runner } from "./acceptance.ts";
import { replyOf } from "./gate.ts";
import { git } from "./git.ts";
import type { Repo } from "./ledger.ts";
import { section } from "./plan.ts";

export const AUTHOR_MODEL = "claude-opus-5-5";
const TIME_BOX_MS = () => Number(process.env.ALEPH_AUTHOR_TIMEOUT ?? 600) * 1000;
const MAX_FILES = 3;
const FILE_NAME = /^[\w-]+\.test\.ts$/;
/** The note that marks the attempt; the UI reads it as a machine note. */
const NOTE = "sealed checks:";

/** The goal section only: the author does not see the Oracle or the Edit surface the worker is given, so its tests do not follow them. */
export function authorPrompt(repo: Repo, item: issues.Issue): string {
  return `You write hidden tests for one goal of the repo ${repo.key}, which is your working directory. You have read-only tools: read the code, and change nothing. A worker will build the goal later and will never see your tests.

# Goal: ${item.title}

${section(item.spec, "Goal") || item.spec.trim()}

# The tests

Write 1 to ${MAX_FILES} bun test files that assert the goal's end state as a user of the code would see it. The files are copied to \`.hidden/\` in the repo and run with \`${repo.hiddenRun}\` from the repo root.

- Test only through what exists today or what the goal names: a CLI command, a route, a file, or an exported function. The worker chooses every other name, so a test that imports a new module cannot load and is thrown away.
- Each test must fail on today's code by an assertion, and pass once the goal is met. Your tests are run on today's main, and they are thrown away if none fails or if a file does not load.
- Assert what the goal asks for and nothing more. Do not assert wording, layout or internals the goal leaves open.
- The tests have no network and no services.

If the goal cannot be tested this way, return no files and say why.

# Your reply

Reply with one JSON object and nothing else:

{"files": {"<name>.test.ts": "<the file's text>"}, "reason": "<why there are no files, when there are none>"}
`;
}

/** The files of a reply, the reason it gives none, or a string that says what is wrong with it. */
export function parseFiles(reply: string): { files: Record<string, string> } | { none: string } | string {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) return "the reply has no JSON object";
  let o: any;
  try { o = JSON.parse(reply.slice(start, end + 1)); } catch (e: any) { return `the reply is not JSON: ${e?.message ?? e}`; }
  const files = o?.files ?? {};
  const names = Object.keys(files);
  if (!names.length) return { none: typeof o?.reason === "string" && o.reason.trim() ? o.reason.trim() : "the author gave no reason" };
  if (names.length > MAX_FILES) return `${names.length} files; the limit is ${MAX_FILES}`;
  const bad = names.find((n) => !FILE_NAME.test(n) || typeof files[n] !== "string" || !files[n].trim());
  return bad === undefined ? { files } : `a bad file: ${bad}`;
}

const LOAD_ERROR = /Unhandled error between tests|Cannot find (module|package)|SyntaxError|error: Unexpected/;

/** Why the tests' run on today's main does not prove anything, or null when at least one fails by assertion and every file loads. */
export function whyRejected(r: Ran): string | null {
  if (r.infra) return `they could not run: ${r.output.slice(-200)}`;
  if (LOAD_ERROR.test(r.output)) return "a file does not load on main";
  const fails = Number(r.output.match(/^\s*(\d+) fail\s*$/m)?.[1] ?? 0);
  return fails > 0 ? null : "no test fails on main, so they prove nothing";
}

async function ask(repo: Repo, input: string): Promise<{ text: string; cost?: number }> {
  const argv = [process.env.ALEPH_AUTHOR_CMD ?? "claude", "-p", "--output-format", "stream-json", "--verbose", "--model", AUTHOR_MODEL, "--tools", "Read", "Grep", "Glob"];
  const env = { ...process.env, ANTHROPIC_API_KEY: undefined, CLAUDECODE: undefined };
  const p = Bun.spawn(argv, { cwd: existsSync(repo.path) ? repo.path : undefined, env, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), TIME_BOX_MS());
  try {
    const [out, , code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) throw new Error(`the author exited ${code}`);
    return replyOf(out);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Give the goal `id` sealed checks if it has had no attempt. Returns the author's cost.
 * Nothing here stops the run: a goal with no sealed check is what every goal was before.
 */
export async function seal(repo: Repo, id: number | string, run: Runner = sandboxRunner): Promise<number | undefined> {
  const item = reader().item(repo.key, id);
  if (!item || !item.spec.trim() || item.notes.some((n) => n.includes(NOTE))) return undefined;
  const ref = `${repo.key}-${issues.refOf(item)}`;
  const say = (text: string) => { note(repo, issues.refOf(item), `${NOTE} ${text}`); };
  let cost: number | undefined;
  try {
    const reply = await ask(repo, authorPrompt(repo, item));
    cost = reply.cost;
    const parsed = parseFiles(reply.text);
    if (typeof parsed === "string") { say(`none: ${parsed}`); return cost; }
    if ("none" in parsed) { say(`none: ${parsed.none}`); return cost; }
    const sha = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
    const why = whyRejected(await run(repo, sha, repo.hiddenRun, parsed.files));
    if (why) { say(`none: ${why}`); return cost; }
    writeHidden(repo, ref, parsed.files);
    const n = Object.keys(parsed.files).length;
    say(`${n} file${n > 1 ? "s" : ""} from a fresh author`);
  } catch (e: any) {
    say(`none: ${String(e?.message ?? e).slice(0, 200)}`);
  }
  return cost;
}
