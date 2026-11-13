import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memory, use } from "../../../lib/langfuse.ts";
import { vault } from "../../../tests/git-fixture.ts";
import { sub } from "../../../vault/lib/maintain.ts";
import { readRun, today } from "../../../vault/lib/vault.ts";
import { dedupe, PAIRS } from "./dedupe.ts";
import { render } from "./maintainer.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "ALEPH_VAULT", "ALEPH_REPOS", "ALEPH_MAINTAINER_CMD", "ALEPH_JUDGE", "FAKE_DIR"] as const;
const GIT = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base = "", root = "", saved: Record<string, string | undefined> = {};

const FAKE = `#!/bin/bash
cat > "$FAKE_DIR/prompt.md"
cat "$FAKE_DIR/reply.json"
`;
const reply = (verdicts: unknown[]) => writeFileSync(join(base, "reply.json"), JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { verdicts } }) + "\n");
const page = (t: string) => join(root, "wiki", "decisions", `${t}.md`);
const read = (t: string) => readFileSync(page(t), "utf8");
const archived = (t: string) => existsSync(join(root, "archive", `${t}.md`));

/** A note written through the vault op so git tracks it. */
async function seed(title: string, extra: Record<string, unknown> = {}) {
  const file = join(base, `${title}.md`);
  const text = render({ title, kind: "decision", scope: "aleph", confidence: "reported", sources: ["trace:abc123"], claim: `${title} is true.`, details: "old details", evidence: "old evidence", related: ["Home"], ...extra }, today());
  writeFileSync(file, extra.core ? text.replace("\nsupersedes", `\ncore: ${extra.core}\nsupersedes`) : text);
  const r = await sub(["write", file, "--why", "seed"]);
  expect(r.code).toBe(0);
}
const v = (a: string, b: string, verdict: string, more: Record<string, unknown> = {}) => ({ a, b, verdict, why: "w", ...more });

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  base = mkdtempSync(join(tmpdir(), "dedupe-"));
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

test("merge rewrites the kept note, supersedes and archives the other; archive moves the drop; distinct adds the field only", async () => {
  await seed("Alpha Gate Rules"); await seed("Alpha Gate Draft");
  await seed("Beta Cache Layer"); await seed("Beta Cache Extra");
  await seed("Gamma Queue Order"); await seed("Gamma Queue Shape");
  const was = { "Gamma Queue Order": read("Gamma Queue Order"), "Gamma Queue Shape": read("Gamma Queue Shape") };
  reply([
    v("Alpha Gate Draft", "Alpha Gate Rules", "merge", { keep: "Alpha Gate Rules", claim: "Gate rules hold.", details: "merged details", evidence: "merged evidence" }),
    v("Beta Cache Extra", "Beta Cache Layer", "archive", { drop: "Beta Cache Extra" }),
    v("Gamma Queue Order", "Gamma Queue Shape", "distinct"),
  ]);
  const r = await dedupe(root, false);
  expect(r.pairs.map((p) => [p.verdict, !!p.commit, p.refused])).toEqual([["merge", true, undefined], ["archive", true, undefined], ["distinct", true, undefined]]);
  const keep = read("Alpha Gate Rules");
  expect(keep).toContain("supersedes: [Alpha Gate Draft]");
  expect(keep).toContain("merged details");
  expect(keep).toContain(`**Claim.** Gate rules hold, as of ${today()}.`);
  expect(existsSync(page("Alpha Gate Draft"))).toBe(false);
  expect(archived("Alpha Gate Draft")).toBe(true);
  expect(archived("Beta Cache Extra")).toBe(true);
  expect(existsSync(page("Beta Cache Layer"))).toBe(true);
  const { a, b } = r.pairs[2];
  expect(read(a).replace(`distinct: [${b}]\n`, "")).toBe(was[a as keyof typeof was]);
  expect(read(a)).toContain(`distinct: [${b}]`);
  expect(read(b)).toBe(was[b as keyof typeof was]);
  expect(readRun(root, "dedupe")?.detail).toBe("3 resolved");
});

test("a dry run asks the model, lists each verdict and writes nothing", async () => {
  await seed("Alpha Gate Rules"); await seed("Alpha Gate Draft");
  const was = read("Alpha Gate Draft");
  reply([v("Alpha Gate Draft", "Alpha Gate Rules", "archive", { drop: "Alpha Gate Draft" }), v("Nope One", "Nope Two", "distinct")]);
  const r = await dedupe(root, true);
  expect(r.pairs).toEqual([{ a: "Alpha Gate Draft", b: "Alpha Gate Rules", verdict: "archive", why: "w" }]);
  expect(read("Alpha Gate Draft")).toBe(was);
  expect(archived("Alpha Gate Draft")).toBe(false);
});

test(`the run takes ${PAIRS} pairs, skips core pairs and refuses malformed replies with rule reply`, async () => {
  for (let i = 0; i < 7; i++) { await seed(`Word${"abcdefg"[i]} Shared Thing`); }
  await seed("Core Shared Thing", { core: "always" });
  reply([]);
  await dedupe(root, false);
  const prompt = readFileSync(join(base, "prompt.md"), "utf8");
  expect([...prompt.matchAll(/^# Pair \d+$/gm)].length).toBe(PAIRS);
  expect(prompt).not.toContain("Core Shared Thing");
  const asked = [...prompt.matchAll(/^## Note [AB]: (.+)$/gm)].map((m) => m[1]);
  reply([v(asked[0], asked[1], "merge", { keep: "Not In Pair", claim: "c", details: "d", evidence: "e" }), v(asked[2], asked[3], "merge", { keep: asked[2], claim: "c" })]);
  const r = await dedupe(root, false);
  expect(r.pairs.map((p) => p.rule)).toEqual(["reply", "reply"]);
  expect(readRun(root, "dedupe")?.detail).toBe("0 resolved");
});

test("a later pair that names a note an earlier verdict archived is skipped with rule gone", async () => {
  await seed("Alpha Gate Rules"); await seed("Alpha Gate Draft"); await seed("Alpha Gate Notes");
  reply([]);
  await dedupe(root, true);
  const asked = [...readFileSync(join(base, "prompt.md"), "utf8").matchAll(/^## Note [AB]: (.+)$/gm)].map((m) => m[1]);
  const [p1, p2, p3] = [asked.slice(0, 2), asked.slice(2, 4), asked.slice(4, 6)];
  const dup = p2.find((t) => p1.includes(t))!;
  reply([v(p1[0], p1[1], "archive", { drop: dup }), v(p2[0], p2[1], "distinct"), v(p3[0], p3[1], "distinct")]);
  const r = await dedupe(root, false);
  const gone = r.pairs.filter((p) => p.rule === "gone");
  expect(gone.length).toBeGreaterThan(0);
  expect(archived(dup)).toBe(true);
});

test("no overlapping pair makes no model call", async () => {
  await seed("Alpha Gate Rules");
  const r = await dedupe(root, false);
  expect(r.skipped).toBe("no overlapping pairs");
  expect(existsSync(join(base, "prompt.md"))).toBe(false);
});
