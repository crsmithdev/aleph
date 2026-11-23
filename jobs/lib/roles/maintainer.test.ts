import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memory, use } from "../../../lib/langfuse.ts";
import { vault } from "../../../tests/git.testkit.ts";
import { compiledDays, readRun, retryDays } from "../../../vault/lib/vault.ts";
import { allRuns } from "../records/record.ts";
import { serializeFrontmatter } from "../../../lib/frontmatter.ts";
import type { Draft } from "../../../vault/lib/ops.ts";
import { compileDay, draft, related } from "./maintainer.ts";
import { setModel } from "../routing/models.ts";

const KEYS = ["ALEPH_DB", "ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "ALEPH_VAULT", "ALEPH_HANDOFFS_DIR", "ALEPH_MAINTAINER_CMD", "ALEPH_JUDGE", "FAKE_DIR", "FAKE_RECALL", "ALEPH_RECALL_UNLOGGED"] as const;
const GIT = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base = "", root = "", saved: Record<string, string | undefined> = {};
const DAY = "2026-11-03";

// The fake maintainer: it keeps its prompt and arguments, and replies the stream line in reply.json.
const FAKE = `#!/bin/bash
cat > "$FAKE_DIR/prompt.md"
echo "$*" > "$FAKE_DIR/args"
echo "$ALEPH_BASH_ALLOW" > "$FAKE_DIR/bash-allow"
[ -n "$FAKE_RECALL" ] && bun "$FAKE_RECALL" memory recall "keep the digest" > /dev/null
cat "$FAKE_DIR/reply.json"
`;

const note = (title: string, extra: Record<string, unknown> = {}) => ({
  title, kind: "decision", scope: "aleph", confidence: "reported", sources: ["trace:abc123"], claim: `${title} was decided.`,
  details: "It came up in the day's work.", evidence: "The handoff says so.", related: [], ...extra,
});
/** A draft's file text, as the vault op writes it. */
const text = (d: Draft) => serializeFrontmatter(d.fm) + d.body;
const reply = (notes: unknown[]) => writeFileSync(join(base, "reply.json"), JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { notes } }) + "\n");

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  base = mkdtempSync(join(tmpdir(), "maintainer-"));
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  root = join(base, "vault");
  Object.assign(process.env, GIT, {
    ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_DB: join(base, "aleph.db"), ALEPH_VAULT: root, ALEPH_HANDOFFS_DIR: join(base, "handoffs"),
    ALEPH_MAINTAINER_CMD: join(base, "fake"), ALEPH_JUDGE: "haiku", FAKE_DIR: base,
  });
  vault(root);
  // The day has one handoff and no traces, and no test reads the live Langfuse.
  use(memory({ traces: [], observations: [] }));
  mkdirSync(join(base, "handoffs"));
  writeFileSync(join(base, "handoffs", `${DAY}-120000.md`), "We decided to keep the compile digest as it is.\n");
});

afterEach(() => {
  use(null);
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  rmSync(base, { recursive: true, force: true });
});

const notes = () => allRuns().filter((e) => e.run.role === "maintainer");

test("a note whose title has a slash is refused for its title and writes no file", async () => {
  reply([note("A/B")]);
  const r = await compileDay(root, DAY, false);
  expect(r.notes.map((n) => [n.title, !!n.commit, n.rule])).toEqual([["A/B", false, "title"]]);
  expect(existsSync(join(root, "wiki", "decisions", "A"))).toBe(false);
});

test("a real compile writes each note through the vault write op, keeps a refusal with its rule, drops core and records the day", async () => {
  reply([note("Keep The Digest"), note("Bad Link", { related: ["No Such Note"] }), note("Core Try", { core: "always on" })]);
  const r = await compileDay(root, DAY, false);
  expect(r.notes.map((n) => [n.title, !!n.commit, n.rule])).toEqual([["Keep The Digest", true, undefined], ["Bad Link", false, "dangling"], ["Core Try", true, undefined]]);
  expect(r.notes[1].refused).toMatch(/^refuse dangling Bad Link/);
  expect(existsSync(join(root, "wiki", "decisions", "Keep The Digest.md"))).toBe(true);
  expect(existsSync(join(root, "wiki", "decisions", "Bad Link.md"))).toBe(false);
  expect(readFileSync(join(root, "wiki", "decisions", "Core Try.md"), "utf8")).not.toContain("core:");
  expect(compiledDays(root)).toEqual([DAY]);
  expect(readRun(root, "compile")?.detail).toBe("2 notes, 1 refused");
  expect(notes()[0].run).toMatchObject({ state: "done", reason: "2 notes, 1 refused", name: `maintainer-${DAY}` });
  const prompt = readFileSync(join(base, "prompt.md"), "utf8");
  expect(prompt).toContain("## write");
  expect(prompt).toContain("We decided to keep the compile digest as it is.");
  expect(prompt).toContain("## Already cited");
  expect(readFileSync(join(base, "args"), "utf8")).toContain("--allowedTools Bash(aleph memory recall:*),Read");
  expect(JSON.parse(readFileSync(join(base, "bash-allow"), "utf8"))).toEqual(["aleph memory recall"]);
});

test("a dry compile runs the model, reports the titles, writes nothing and records nothing", async () => {
  reply([note("Keep The Digest")]);
  const r = await compileDay(root, DAY, true);
  expect(r.notes).toEqual([{ title: "Keep The Digest", kind: "decision" }]);
  expect(existsSync(join(root, "wiki", "decisions", "Keep The Digest.md"))).toBe(false);
  expect(compiledDays(root)).toEqual([]);
  expect(notes()[0].run.reason).toBe("dry: 1 notes");
});

// The fake runs a vault recall that returns a note the vault already holds.
const recallOf = (dry: boolean) => {
  process.env.FAKE_RECALL = join(import.meta.dir, "../../../cli/cli.ts");
  mkdirSync(join(root, "wiki", "decisions"), { recursive: true });
  writeFileSync(join(root, "wiki", "decisions", "Keep The Digest.md"), text(draft(note("Keep The Digest"), DAY)));
  reply([]);
  return compileDay(root, DAY, dry);
};

test("a dry compile's recall leaves the read log and the recall log alone, and a real compile's recall is logged in both", async () => {
  await recallOf(true);
  expect(existsSync(join(root, ".recall.json"))).toBe(false);
  expect(existsSync(join(root, ".recall-log.jsonl"))).toBe(false);
  await recallOf(false);
  expect(Object.keys(JSON.parse(readFileSync(join(root, ".recall.json"), "utf8")))).toEqual(["Keep The Digest"]);
  expect(readFileSync(join(root, ".recall-log.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
});

test("a day with nothing in it makes no model call", async () => {
  rmSync(join(base, "handoffs"), { recursive: true });
  const r = await compileDay(root, DAY, false);
  expect(r.skipped).toBe("nothing on the day");
  expect(notes()).toHaveLength(0);
  expect(compiledDays(root)).toEqual([DAY]);
});

test("a failed run is in the report and leaves the day uncompiled", async () => {
  writeFileSync(join(base, "fake"), "#!/bin/bash\ncat > /dev/null\nexit 3\n");
  const r = await compileDay(root, DAY, false);
  expect(r.error).toMatch(/exited 3/);
  expect(compiledDays(root)).toEqual([]);
  expect(retryDays(root)).toEqual([DAY]);
  expect(notes()[0].run.state).toBe("done");
  expect(notes()[0].run.reason).toStartWith("failed:");
  // A compile of the day that succeeds later clears the mark.
  writeFileSync(join(base, "fake"), FAKE);
  reply([note("Keep The Digest")]);
  expect((await compileDay(root, DAY, false)).error).toBeUndefined();
  expect(retryDays(root)).toEqual([]);
});

test("draft gives the frontmatter and the four body parts, and an empty Related when no note is related", () => {
  const t = text(draft(note("T", { related: [], aliases: ["t"], tags: ["x"], core: "no" }), DAY));
  expect(t).toStartWith("---\naliases: [t]\nkind: decision\nscope: aleph\nconfidence: reported\nupdated: 2026-11-03\nsupersedes: []\nsources: [\"trace:abc123\"]\ntags: [x]\n---\n");
  expect(t).toContain("**Claim.** T was decided, as of 2026-11-03.");
  expect(t).toContain("## Related\n\n\n");
  expect(t).not.toContain("core");
});

test("related reads the Related section as the Memory page writes it, and as body writes it", () => {
  expect(related("\n**Claim.** x\n\n## Related\n[[a]]\n")).toBe("[[a]]");
  expect(related("\n**Claim.** x\n\n## Related\n\n- [[a]]\n- [[b]]\n")).toBe("- [[a]]\n- [[b]]");
  expect(related("\n**Claim.** x\n")).toBe("");
});

test("an off maintainer opens no run, and marks the day so the next pass compiles it", async () => {
  reply([note("Keep The Digest")]);
  setModel("maintainer", { enabled: false });
  const r = await compileDay(root, DAY, false);
  expect(r.skipped).toBe("the maintainer is off");
  expect(notes()).toHaveLength(0);
  expect(compiledDays(root)).toEqual([]);
  expect(retryDays(root)).toEqual([DAY]);
  setModel("maintainer", { enabled: true });
  expect((await compileDay(root, DAY, false)).notes).toHaveLength(1);
  expect(retryDays(root)).toEqual([]);
});
