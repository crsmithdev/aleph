import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { digest, userGrantedSkip } from "./lib/digest.ts";
import { changedFiles, isCode, snapshot, type Snapshot } from "./lib/snapshot.ts";
import { gate } from "./lib/gate.ts";
import type { JudgeResult } from "./lib/judge.ts";

const HOOKS = import.meta.dir;
const run = (cwd: string, ...args: string[]) => { const p = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdout: "ignore", stderr: "pipe" }); if (p.exitCode !== 0) throw new Error(p.stderr.toString()); };

describe("snapshot", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "aleph-snap-"));
    run(root, "init", "-q", "-b", "main");
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, ".gitignore"), ".worktrees/\n.claude/\n"); // as in aleph
    run(root, "add", "a.txt", ".gitignore"); run(root, "commit", "-q", "-m", "init");
    run(root, "worktree", "add", "-q", join(root, ".worktrees", "w"), "-b", "feature/w");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const diff = (a: Snapshot | null, b: Snapshot | null) => changedFiles(a!, b!).sort();

  test("is stable, names an edited file, and sees worktrees", () => {
    const w = join(root, ".worktrees", "w");
    const s0 = snapshot(root);
    expect(diff(s0, snapshot(root))).toEqual([]);
    writeFileSync(join(w, "b.txt"), "b");
    const s1 = snapshot(root);
    expect(diff(s0, s1)).toEqual([join(w, "b.txt")]);
    run(w, "add", "b.txt"); run(w, "commit", "-q", "-m", "b");
    expect(diff(s1, snapshot(root))).toEqual([join(w, "b.txt")]);
    expect(snapshot(w)).toEqual(snapshot(root));
  });
  test("names an untracked file whose contents change, and not one that stays the same", () => {
    const w = join(root, ".worktrees", "w");
    writeFileSync(join(w, "u.txt"), "one");
    writeFileSync(join(w, "same.txt"), "same");
    const s0 = snapshot(w);
    writeFileSync(join(w, "u.txt"), "two");
    expect(diff(s0, snapshot(w))).toEqual([join(w, "u.txt")]);
  });
  test("names the files a worktree created this turn commits", () => {
    const s0 = snapshot(root);
    const n = join(root, ".worktrees", "n");
    run(root, "worktree", "add", "-q", n, "-b", "feature/n");
    expect(diff(s0, snapshot(root))).toEqual([]);
    writeFileSync(join(n, "n.ts"), "n"); run(n, "add", "n.ts"); run(n, "commit", "-q", "-m", "n");
    expect(diff(s0, snapshot(root))).toEqual([join(n, "n.ts")]);
  });
  test("leaves out a subagent's worktree under .claude/worktrees, except from inside it", () => {
    const agent = join(root, ".claude", "worktrees", "agent-x");
    run(root, "worktree", "add", "-q", agent, "-b", "worktree-agent-x");
    const s0 = snapshot(root);
    const inside0 = snapshot(agent);
    writeFileSync(join(agent, "c.txt"), "c");
    expect(diff(s0, snapshot(root))).toEqual([]);
    expect(diff(inside0, snapshot(agent))).toEqual([join(agent, "c.txt")]);
  });
  test("a doc is not code", () => {
    expect(isCode("/r/docs/verify-gate.md")).toBe(false);
    expect(isCode("/r/hooks/verify-gate.ts")).toBe(true);
  });
  test("is null outside a repo", () => {
    const plain = mkdtempSync(join(tmpdir(), "aleph-plain-"));
    expect(snapshot(plain)).toBeNull();
    rmSync(plain, { recursive: true, force: true });
  });
});

function transcript(path: string, promptId: string, lines: object[]) {
  writeFileSync(path, lines.map((l) => JSON.stringify({ promptId, isSidechain: false, ...l })).join("\n") + "\n"); // assistant lines override promptId with undefined, as in real transcripts
}
const user = (text: string) => ({ type: "user", message: { role: "user", content: text } });
const toolUse = (id: string, name: string, input: object, text?: string) => ({ type: "assistant", promptId: undefined, message: { role: "assistant", content: [...(text ? [{ type: "text", text }] : []), { type: "tool_use", id, name, input }] } });
const toolResult = (id: string, content: string, tur?: object) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] }, toolUseResult: tur });
const say = (text: string) => ({ type: "assistant", promptId: undefined, message: { role: "assistant", content: [{ type: "text", text }] } });

describe("digest", () => {
  test("orders edits, runs and the final message; skips other prompts and meta", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aleph-digest-")), "t.jsonl");
    transcript(path, "p1", [
      { ...user("older prompt"), promptId: "p0" },
      user("fix the bug"),
      { ...user("skill body"), isMeta: true },
      toolUse("t1", "Edit", { file_path: "/repo/a.ts" }),
      toolResult("t1", "ok"),
      toolUse("t2", "Bash", { command: "bun test" }),
      toolResult("t2", "3 pass", { stdout: "3 pass\n0 fail", stderr: "" }),
      say("Fixed and tested."),
      { ...user("next prompt"), promptId: "p2" },
      { ...say("unrelated"), promptId: undefined },
    ]);
    const d = digest(path, "p1");
    expect(d.prompt).toBe("fix the bug");
    expect(d.edits).toEqual(["/repo/a.ts"]);
    expect(d.items).toHaveLength(2);
    expect(d.items[1]).toContain("RUN bun test");
    expect(d.items[1]).toContain("3 pass");
    expect(d.finalMessage).toBe("Fixed and tested.");
    expect(d.text).toContain("FINAL MESSAGE:\nFixed and tested.");
  });
  test("skip grant is detected only from the user prompt text", () => {
    expect(userGrantedSkip("ok skip verify this one")).toBe(true);
    expect(userGrantedSkip("please skip verification")).toBe(true);
    expect(userGrantedSkip("verify it")).toBe(false);
  });
  test("a job worker cannot skip the gate", () => {
    process.env.ALEPH_JOB_ID = "20260925-000000-demo-alpha-agent";
    try {
      expect(userGrantedSkip("skip verify")).toBe(false);
    } finally {
      delete process.env.ALEPH_JOB_ID;
    }
  });
});

describe("verify gate", () => {
  let root: string, spool: string, transcriptPath: string;
  const posted: any[] = [];
  let server: ReturnType<typeof Bun.serve>;
  let verdict: JudgeResult = { verdict: null, error: "unset", ms: 0 };
  const says = (v: "pass" | "deny", reason: string): JudgeResult => ({ verdict: { verdict: v, reason }, ms: 1 });
  const env = { ALEPH_SPOOL: process.env.ALEPH_SPOOL, LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "aleph-gate-"));
    run(root, "init", "-q", "-b", "main");
    writeFileSync(join(root, "a.txt"), "a"); run(root, "add", "a.txt"); run(root, "commit", "-q", "-m", "init");
    spool = mkdtempSync(join(tmpdir(), "aleph-gate-spool-"));
    transcriptPath = join(root, "t.jsonl");
    server = Bun.serve({ port: 0, fetch: async (req) => { posted.push({ url: new URL(req.url).pathname, body: await req.json() }); return new Response("{}"); } });
    Object.assign(process.env, { ALEPH_SPOOL: spool, LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    server.stop(); rmSync(root, { recursive: true, force: true }); rmSync(spool, { recursive: true, force: true });
  });

  const fire = (event: string, promptId: string, extra: object = {}) =>
    gate({ hook_event_name: event, session_id: "s1", prompt_id: promptId, cwd: root, transcript_path: transcriptPath, ...extra }, { judge: async () => verdict });
  const lastSpan = () => posted.filter((p) => p.url === "/api/public/otel/v1/traces").at(-1).body.resourceSpans[0].scopeSpans[0].spans[0];
  const attr = (span: any, key: string) => span.attributes.find((a: any) => a.key === key).value;

  test("unchanged tree: passes silently, posts nothing", async () => {
    transcript(transcriptPath, "p1", [user("hello"), say("hi")]);
    await fire("UserPromptSubmit", "p1");
    const before = posted.length;
    expect(await fire("Stop", "p1", { last_assistant_message: "hi" })).toMatchObject({ verdict: "pass", kind: "unchanged" });
    expect(posted.length).toBe(before);
  });

  test("a change to docs only: passes silently, posts nothing", async () => {
    transcript(transcriptPath, "p0", [user("write a note"), toolUse("t1", "Write", { file_path: join(root, "notes.md") }), toolResult("t1", "ok"), say("Published the page, version 3.")]);
    await fire("UserPromptSubmit", "p0");
    writeFileSync(join(root, "notes.md"), "a doc");
    verdict = says("deny", "should not be consulted");
    const before = posted.length;
    expect(await fire("Stop", "p0", { last_assistant_message: "Published the page, version 3." })).toMatchObject({ verdict: "pass", kind: "unchanged" });
    expect(posted.length).toBe(before);
  });

  test("changed tree, judge denies twice, third stop is a forced pass", async () => {
    await fire("UserPromptSubmit", "p2");
    writeFileSync(join(root, "a.txt"), "changed");
    transcript(transcriptPath, "p2", [user("change a"), toolUse("t1", "Bash", { command: "sed -i s/a/changed/ a.txt" }), toolResult("t1", "", { stdout: "", stderr: "" }), say("Done, it works.")]);
    verdict = says("deny", "Nothing ran after the edit.");

    expect(await fire("Stop", "p2", { last_assistant_message: "Done, it works." })).toMatchObject({ verdict: "deny", kind: "judged", reason: "Nothing ran after the edit." });
    expect(posted.filter((p) => p.url === "/api/public/scores").at(-1).body).toMatchObject({ name: "verified", value: 0 });
    expect(await fire("Stop", "p2", { last_assistant_message: "Done, it works.", stop_hook_active: true })).toMatchObject({ verdict: "deny" });
    expect(await fire("Stop", "p2", { last_assistant_message: "Done, it works.", stop_hook_active: true })).toMatchObject({ verdict: "pass", kind: "forced" });
    expect(posted.filter((p) => p.url === "/api/public/scores").at(-1).body).toMatchObject({ name: "verified", value: 0.5 });
    const last = lastSpan();
    expect(last.name).toBe("verify-gate");
    expect(attr(last, "langfuse.observation.metadata.kind")).toEqual({ stringValue: "forced" });
    expect(last.parentSpanId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("judge passes: score 1", async () => {
    await fire("UserPromptSubmit", "p3");
    writeFileSync(join(root, "a.txt"), "changed again");
    transcript(transcriptPath, "p3", [user("change a"), toolUse("t1", "Bash", { command: "bun test" }), toolResult("t1", "1 pass", { stdout: "1 pass", stderr: "" }), say("Tests pass.")]);
    verdict = says("pass", "bun test ran after the edit and passed.");
    expect(await fire("Stop", "p3", { last_assistant_message: "Tests pass." })).toMatchObject({ verdict: "pass", kind: "judged" });
    expect(posted.filter((p) => p.url === "/api/public/scores").at(-1).body).toMatchObject({ value: 1 });
  });

  test("user skip passes without calling the judge", async () => {
    await fire("UserPromptSubmit", "p4");
    writeFileSync(join(root, "a.txt"), "x");
    transcript(transcriptPath, "p4", [user("edit a, skip verify"), say("Done.")]);
    verdict = says("deny", "should not be consulted");
    expect(await fire("Stop", "p4", { last_assistant_message: "Done." })).toMatchObject({ verdict: "pass", kind: "skip" });
    const last = lastSpan();
    expect(attr(last, "langfuse.observation.metadata.kind")).toEqual({ stringValue: "skip" });
    // A span without the trace name lets Langfuse rename the trace after its root span.
    expect(attr(last, "langfuse.trace.name")).toEqual({ stringValue: basename(root) });
  });

  test("judge unavailable: fails open with a warning span", async () => {
    await fire("UserPromptSubmit", "p5");
    writeFileSync(join(root, "a.txt"), "y");
    transcript(transcriptPath, "p5", [user("edit a"), say("Done.")]);
    verdict = { verdict: null, error: "garbage", ms: 1 };
    expect(await fire("Stop", "p5", { last_assistant_message: "Done." })).toMatchObject({ verdict: "pass", kind: "fail-open" });
    const last = lastSpan();
    expect(attr(last, "langfuse.observation.metadata.kind")).toEqual({ stringValue: "fail-open" });
    expect(attr(last, "langfuse.observation.level")).toEqual({ stringValue: "WARNING" });
  });

  test("a code change in another worktree wakes the gate only when the turn names a path in it", async () => {
    writeFileSync(join(root, ".git", "info", "exclude"), ".worktrees/\nt.jsonl\n");
    const w = join(root, ".worktrees", "sib");
    run(root, "worktree", "add", "-q", w, "-b", "feature/sib");
    verdict = says("deny", "judge was called");
    const w2 = join(root, ".worktrees", "sib2");
    run(root, "worktree", "add", "-q", w2, "-b", "feature/sib2");
    const stop = async (id: string, calls: object[], tree = w, cwd = root) => {
      await fire("UserPromptSubmit", id, { cwd });
      writeFileSync(join(tree, `${id}.ts`), id);
      transcript(transcriptPath, id, [user("go"), ...calls, say("Done.")]);
      return (await fire("Stop", id, { cwd, last_assistant_message: "Done." }))!.verdict;
    };
    expect(await stop("p6", [])).toBe("pass");
    expect(await stop("p9", [toolUse("t1", "Bash", { command: "echo x > .worktrees/sib/p9.ts" }), toolResult("t1", "", { stdout: "", stderr: "" })], w2)).toBe("pass");
    expect(await stop("p10", [toolUse("t1", "Edit", { file_path: "/elsewhere/.worktrees/sib/p10.ts" }), toolResult("t1", "ok")])).toBe("pass");
    expect(await stop("p7", [toolUse("t1", "Edit", { file_path: join(w, "p7.ts") }), toolResult("t1", "ok")])).toBe("deny");
    expect(await stop("p8", [toolUse("t1", "Bash", { command: "echo x > .worktrees/sib/p8.ts" }), toolResult("t1", "", { stdout: "", stderr: "" })])).toBe("deny");
    expect(await stop("p11", [toolUse("t1", "Bash", { command: "echo x >.worktrees/sib/p11.ts" }), toolResult("t1", "", { stdout: "", stderr: "" })])).toBe("deny");
    expect(await stop("p12", [], root, w2)).toBe("pass");
    const at = (cwd: string, command: string) => [{ type: "assistant", cwd, message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command } }] } }, toolResult("t1", "", { stdout: "", stderr: "" })];
    expect(await stop("p14", at(w, "echo x > p14.ts"))).toBe("deny");
    expect(await stop("p15", at(w2, "echo x > .worktrees/sib/p15.ts"))).toBe("pass");
    expect(await stop("p13", [toolUse("t1", "Bash", { command: `cd ${root} && echo x > p13.ts` }), toolResult("t1", "", { stdout: "", stderr: "" })], root, w2)).toBe("deny");
  });

  test("the script prints a block when the judge denies, and nothing when it passes", async () => {
    const verdictFile = join(spool, "verdict.txt");
    const wrapper = join(spool, "claude");
    writeFileSync(join(spool, "judge.ts"), `const v = await Bun.file(${JSON.stringify(verdictFile)}).text(); console.log(JSON.stringify({ type: "result", is_error: false, result: v }));`);
    writeFileSync(wrapper, `#!/bin/sh\nexec bun ${join(spool, "judge.ts")}\n`);
    Bun.spawnSync(["chmod", "+x", wrapper]);
    const script = async (event: string, promptId: string, extra: object = {}) => {
      const proc = Bun.spawn(["bun", join(HOOKS, "verify-gate.ts")], {
        stdin: new TextEncoder().encode(JSON.stringify({ hook_event_name: event, session_id: "s1", prompt_id: promptId, cwd: root, transcript_path: transcriptPath, ...extra })),
        env: { ...process.env, ALEPH_JUDGE: "haiku", ALEPH_JUDGE_CMD: wrapper },
        stdout: "pipe", stderr: "pipe",
      });
      expect(await proc.exited).toBe(0);
      return (await new Response(proc.stdout).text()).trim();
    };
    for (const [id, v] of [["s1", '{"verdict":"deny","reason":"Nothing ran after the edit."}'], ["s2", '{"verdict":"pass","reason":"It ran."}']]) {
      await script("UserPromptSubmit", id);
      writeFileSync(join(root, `${id}.ts`), id);
      transcript(transcriptPath, id, [user("change it"), toolUse("t1", "Edit", { file_path: join(root, `${id}.ts`) }), toolResult("t1", "ok"), say("Done.")]);
      writeFileSync(verdictFile, v);
      const out = await script("Stop", id, { last_assistant_message: "Done." });
      if (id === "s1") expect(JSON.parse(out)).toEqual({ decision: "block", reason: "Verify gate: Nothing ran after the edit. Run it, report what you observed, or say plainly what is unverified." });
      else expect(out).toBe("");
    }
  });
});
