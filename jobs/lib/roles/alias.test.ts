import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memory, use } from "../../../lib/langfuse.ts";
import { vault } from "../../../tests/git-fixture.ts";
import { sub } from "../../../vault/lib/maintain.ts";
import { loadVault, readRun, today, wikiNotes } from "../../../vault/lib/vault.ts";
import { alias, findMisses, MISSES } from "./alias.ts";
import { render } from "./maintainer.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "ALEPH_VAULT", "ALEPH_REPOS", "ALEPH_MAINTAINER_CMD", "ALEPH_JUDGE", "FAKE_DIR"] as const;
const GIT = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const NOW = Date.parse("2026-11-04T12:00:00Z"), AT = (min: number) => new Date(NOW - 60 * 60_000 + min * 60_000).toISOString();
let base = "", root = "", saved: Record<string, string | undefined> = {};

const FAKE = `#!/bin/bash
cat > "$FAKE_DIR/prompt.md"
cat "$FAKE_DIR/reply.json"
`;
const reply = (verdicts: unknown[]) => writeFileSync(join(base, "reply.json"), JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { verdicts } }) + "\n");
const rel = (t: string) => `wiki/decisions/${t}.md`;
const read = (t: string) => readFileSync(join(root, rel(t)), "utf8");
const notes = async () => wikiNotes(await loadVault(root));

async function seed(title: string, core?: string) {
  const file = join(base, `${title}.md`);
  const text = render({ title, kind: "decision", scope: "aleph", confidence: "reported", sources: ["trace:abc123"], claim: `${title} is true.`, details: "d", evidence: "e", related: ["Home"] }, today());
  writeFileSync(file, core ? text.replace("\nsupersedes", `\ncore: ${core}\nsupersedes`) : text);
  expect((await sub(["write", file, "--why", "seed"])).code).toBe(0);
}

/** One turn: its prompt, the hook's span (asked paths, offered), then each recall and read in order. */
type Step = { recall: string; out: string } | { read: string };
function turn(id: string, session: string, input: string, hook: { asked: string[]; offered?: string[] } | null, steps: Step[]) {
  const trace = { id, sessionId: session, timestamp: AT(0), input };
  const obs: any[] = [];
  if (hook) obs.push({ traceId: id, name: "vault-recall", startTime: AT(1), metadata: { askedPaths: hook.asked.join("\n") || undefined, offered: hook.offered?.join("\n") } });
  steps.forEach((s, i) => obs.push("recall" in s
    ? { traceId: id, name: "Bash", startTime: AT(2 + i), input: { command: `aleph memory recall '${s.recall}'` }, output: { stdout: s.out } }
    : { traceId: id, name: "Read", startTime: AT(2 + i), input: { file_path: join(root, s.read) } }));
  return { trace, obs };
}
const data = (...turns: ReturnType<typeof turn>[]) => use(memory({ traces: turns.map((t) => t.trace), observations: turns.flatMap((t) => t.obs) }));

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  base = mkdtempSync(join(tmpdir(), "alias-"));
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  root = join(base, "vault");
  Object.assign(process.env, GIT, {
    ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_VAULT: root, ALEPH_REPOS: join(base, "repos.json"),
    ALEPH_MAINTAINER_CMD: join(base, "fake"), ALEPH_JUDGE: "haiku", FAKE_DIR: base,
  });
  vault(root);
  use(memory({ traces: [], observations: [] }));
});

afterEach(() => {
  use(null);
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  rmSync(base, { recursive: true, force: true });
});

test("a miss is a query that did not surface a note the turn then read, and that today's ranking still misses", async () => {
  await seed("Alpha Gate Rules"); await seed("Beta Cache Layer"); await seed("Gamma Queue Order"); await seed("Delta Core Thing", "always");
  data(
    // The hook did not ask about Alpha, and the agent's recall did not name it: two misses.
    turn("t1", "s1", "why does the merge wait so long before it starts", { asked: [rel("Beta Cache Layer")] }, [{ recall: "merge wait", out: "[]" }, { read: rel("Alpha Gate Rules") }]),
    // The hook asked about Beta: no miss. A recall that named Gamma: no miss for it, but the hook's prompt before it missed Gamma.
    turn("t2", "s2", "tell me about the storage of the build outputs", { asked: [rel("Beta Cache Layer")] }, [{ read: rel("Beta Cache Layer") }, { recall: "storage order", out: '[{"title":"Gamma Queue Order"}]' }, { read: rel("Gamma Queue Order") }]),
    // A core note is never a miss; nor is a note the hook offered earlier in the session.
    turn("t3", "s3", "what was the decision on the large item", { asked: [], offered: [rel("Gamma Queue Order")] }, [{ read: rel("Delta Core Thing") }]),
    turn("t4", "s3", "and how about the follow up on that one", { asked: [] }, [{ read: rel("Gamma Queue Order") }]),
    // Today's ranking finds Alpha for a query with its title words: no miss.
    turn("t5", "s5", "check the alpha gate rules once more please", { asked: [] }, [{ read: rel("Alpha Gate Rules") }]),
  );
  const m = await findMisses(root, await notes(), NOW);
  expect(m.map((x) => [x.source, x.query, x.note.title])).toEqual([
    ["hook", "why does the merge wait so long before it starts", "Alpha Gate Rules"],
    ["recall", "merge wait", "Alpha Gate Rules"],
    ["hook", "tell me about the storage of the build outputs", "Gamma Queue Order"],
  ]);
});

test("an alias verdict adds the aliases through the write op, skip writes nothing, and a duplicate alias is refused", async () => {
  await seed("Alpha Gate Rules"); await seed("Beta Cache Layer");
  data(
    turn("t1", "s1", "why does the merge wait so long before it starts", { asked: [] }, [{ read: rel("Alpha Gate Rules") }]),
    turn("t2", "s2", "where do the build outputs go after a run", { asked: [] }, [{ read: rel("Beta Cache Layer") }]),
    turn("t3", "s3", "is there a waiting room for the merges today", { asked: [] }, [{ read: rel("Beta Cache Layer") }]),
  );
  const beta = read("Beta Cache Layer");
  reply([
    { miss: 1, note: "Alpha Gate Rules", verdict: "alias", aliases: ["merge wait", "Alpha Gate Rules"], why: "w" },
    { miss: 2, note: "Beta Cache Layer", verdict: "skip", why: "w" },
    { miss: 3, note: "Beta Cache Layer", verdict: "alias", aliases: ["Alpha Gate Rules"], why: "w" },
  ]);
  const r = await alias(root, false, NOW);
  expect(r.misses.map((m) => [m.note, m.verdict, m.aliases, !!m.commit, m.rule])).toEqual([
    ["Alpha Gate Rules", "alias", ["merge wait"], true, undefined],
    ["Beta Cache Layer", "skip", undefined, false, undefined],
    ["Beta Cache Layer", "alias", ["Alpha Gate Rules"], false, "duplicate"],
  ]);
  expect(read("Alpha Gate Rules")).toContain("aliases: [merge wait]");
  expect(read("Beta Cache Layer")).toBe(beta);
  expect(readRun(root, "alias")?.detail).toBe("1 aliased");
});

test(`a dry run asks the model about at most ${MISSES} misses, lists the verdicts and writes nothing`, async () => {
  await seed("Alpha Gate Rules");
  data(...Array.from({ length: MISSES + 2 }, (_, i) => turn(`t${i}`, `s${i}`, `the long question number ${i} about waits`, { asked: [] }, [{ read: rel("Alpha Gate Rules") }])));
  const was = read("Alpha Gate Rules");
  reply([{ miss: 1, note: "Alpha Gate Rules", verdict: "alias", aliases: ["waits"], why: "w" }, { miss: 2, note: "Nope", verdict: "skip", why: "w" }, { miss: 99, note: "Alpha Gate Rules", verdict: "skip", why: "w" }]);
  const r = await alias(root, true, NOW);
  expect([...readFileSync(join(base, "prompt.md"), "utf8").matchAll(/^# Miss \d+$/gm)].length).toBe(MISSES);
  expect(r.misses).toEqual([{ query: "the long question number 0 about waits", note: "Alpha Gate Rules", verdict: "alias", aliases: ["waits"], why: "w" }]);
  expect(read("Alpha Gate Rules")).toBe(was);
});

test("no miss makes no model call", async () => {
  await seed("Alpha Gate Rules");
  const r = await alias(root, false, NOW);
  expect(r.skipped).toBe("no misses");
  expect(existsSync(join(base, "prompt.md"))).toBe(false);
});
