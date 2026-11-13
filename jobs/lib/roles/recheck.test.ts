import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memory, use } from "../../../lib/langfuse.ts";
import { vault } from "../../../tests/git-fixture.ts";
import { decayQueue, sub } from "../../../vault/lib/maintain.ts";
import { lintVault, loadVault, readRun, today } from "../../../vault/lib/vault.ts";
import { render } from "./maintainer.ts";
import { BUDGET, recheck } from "./recheck.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "ALEPH_VAULT", "ALEPH_REPOS", "ALEPH_MAINTAINER_CMD", "ALEPH_JUDGE", "FAKE_DIR"] as const;
const GIT = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base = "", root = "", saved: Record<string, string | undefined> = {};
const OLD = "2026-01-01";

const FAKE = `#!/bin/bash
cat > "$FAKE_DIR/prompt.md"
cat "$FAKE_DIR/reply.json"
`;
const reply = (verdicts: unknown[]) => writeFileSync(join(base, "reply.json"), JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { verdicts } }) + "\n");
const page = (t: string) => join(root, "wiki", "decisions", `${t}.md`);
const read = (t: string) => readFileSync(page(t), "utf8");

/** A stale note, written through the vault op so git tracks it, with `n` recalls in the log. */
async function seed(title: string, n = 0, extra: Record<string, unknown> = {}) {
  const file = join(base, `${title}.md`);
  const text = render({ title, kind: "decision", scope: "aleph", confidence: "reported", sources: ["trace:abc123"], claim: `${title} is true.`, details: "old details", evidence: "old evidence", related: ["Home"], ...extra }, OLD);
  writeFileSync(file, extra.core ? text.replace("\nsupersedes", `\ncore: ${extra.core}\nsupersedes`) : text);
  const r = await sub(["write", file, "--why", "seed"]);
  expect(r.code).toBe(0);
  const log = join(root, ".recall-log.jsonl");
  const lines = Array.from({ length: n }, () => JSON.stringify({ date: today(), title, query: "q", session: null, source: "cli" })).join("\n");
  if (n) writeFileSync(log, (existsSync(log) ? readFileSync(log, "utf8") : "") + lines + "\n");
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  base = mkdtempSync(join(tmpdir(), "recheck-"));
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

test("the decay queue is the stale notes by recall count, most first, ties in lint order, and a read no longer resets staleness", async () => {
  await seed("Aa", 1); await seed("Bb", 3); await seed("Cc", 0); await seed("Dd", 1);
  // A read today does not move a note out of the queue.
  writeFileSync(join(root, ".recall.json"), JSON.stringify({ Cc: today() }));
  const stale = lintVault(await loadVault(root)).warn.filter((f) => f.rule === "stale");
  expect(stale.map((f) => f.note).sort()).toEqual(["Aa", "Bb", "Cc", "Dd"]);
  const q = decayQueue(root, stale);
  expect(q.map((f) => [f.note, f.count])).toEqual([["Bb", 3], ...stale.filter((f) => ["Aa", "Dd"].includes(f.note)).map((f) => [f.note, 1]), ["Cc", 0]]);
});

test("refresh bumps updated only, correct rewrites the claim and keeps frontmatter and Related, archive moves the note", async () => {
  await seed("Keep", 3); await seed("Fix", 2, { related: ["Home", "Keep"], tags: ["x"] }); await seed("Drop", 1);
  const fm = (t: string) => read(t).split("---")[1];
  const before = { keep: read("Keep"), fix: fm("Fix") };
  reply([
    { title: "Keep", verdict: "refresh", why: "still so" },
    { title: "Fix", verdict: "correct", why: "moved", claim: "Fix now holds.", details: "new details", evidence: "new evidence" },
    { title: "Drop", verdict: "archive", why: "gone" },
  ]);
  const r = await recheck(root, false);
  expect(r.notes.map((n) => [n.title, n.verdict, !!n.commit, n.refused])).toEqual([["Keep", "refresh", true, undefined], ["Fix", "correct", true, undefined], ["Drop", "archive", true, undefined]]);
  expect(read("Keep")).toBe(before.keep.replace(`updated: ${OLD}`, `updated: ${today()}`));
  const fix = read("Fix");
  expect(fix.split("---")[1]).toBe(before.fix.replace(`updated: ${OLD}`, `updated: ${today()}`));
  expect(fix).toContain(`**Claim.** Fix now holds, as of ${today()}.`);
  expect(fix).toContain("new details");
  expect(fix).toMatch(/## Related\n\n- \[\[Home\]\]\n- \[\[Keep\]\]\n$/);
  expect(existsSync(page("Drop"))).toBe(false);
  expect(existsSync(join(root, "archive", "Drop.md"))).toBe(true);
  expect(readRun(root, "recheck")?.detail).toBe("3 rechecked");
  const prompt = readFileSync(join(base, "prompt.md"), "utf8");
  expect(prompt).toContain("# Keep");
  expect(prompt).toContain("old details");
});

test("a refused verdict is kept with its rule, is not counted, and the rest go on", async () => {
  await seed("Keep", 2); await seed("Fix", 1);
  reply([{ title: "Fix", verdict: "correct", why: "w", claim: "c", details: "d", evidence: "e", related: ["No Such"] }, { title: "Keep", verdict: "correct", why: "w" }]);
  const r = await recheck(root, false);
  expect(r.notes.map((n) => [n.title, n.rule])).toEqual([["Keep", "reply"], ["Fix", undefined]]);
  expect(readRun(root, "recheck")?.detail).toBe("1 rechecked");
});

test("a dry run asks the model, lists each verdict and writes nothing", async () => {
  await seed("Keep", 1);
  const was = read("Keep");
  reply([{ title: "Keep", verdict: "archive", why: "gone" }]);
  const r = await recheck(root, true);
  expect(r.notes).toEqual([{ title: "Keep", verdict: "archive", why: "gone" }]);
  expect(read("Keep")).toBe(was);
  expect(existsSync(join(root, "archive", "Keep.md"))).toBe(false);
});

test(`the run takes the ${BUDGET} most recalled notes, skips core notes and answers to titles it asked about`, async () => {
  for (let i = 0; i < 7; i++) await seed(`N${i}`, i);
  await seed("Core", 99, { core: "always" });
  reply([{ title: "N0", verdict: "refresh", why: "w" }, { title: "Core", verdict: "archive", why: "w" }, { title: "N6", verdict: "refresh", why: "w" }]);
  const r = await recheck(root, false);
  const prompt = readFileSync(join(base, "prompt.md"), "utf8");
  expect([...prompt.matchAll(/^# (\S+)$/gm)].map((m) => m[1])).toEqual(["N6", "N5", "N4", "N3", "N2"]);
  expect(r.notes.map((n) => n.title)).toEqual(["N6"]);
  expect(existsSync(page("Core"))).toBe(true);
  expect(read("N0")).toContain(`updated: ${OLD}`);
});

test("no stale note makes no model call", async () => {
  const r = await recheck(root, false);
  expect(r.skipped).toBe("nothing to re-check");
  expect(existsSync(join(base, "prompt.md"))).toBe(false);
});
