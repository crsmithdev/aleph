import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, userGrantedSkip } from "./lib/digest.ts";
import { snapshot } from "./lib/snapshot.ts";

const HOOKS = import.meta.dir;
const run = (cwd: string, ...args: string[]) => { const p = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdout: "ignore", stderr: "pipe" }); if (p.exitCode !== 0) throw new Error(p.stderr.toString()); };

describe("snapshot", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "aleph-snap-"));
    run(root, "init", "-q", "-b", "main");
    writeFileSync(join(root, "a.txt"), "a");
    run(root, "add", "a.txt"); run(root, "commit", "-q", "-m", "init");
    run(root, "worktree", "add", "-q", join(root, ".worktrees", "w"), "-b", "feature/w");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("is stable, changes on an edit, and sees worktrees", () => {
    const s0 = snapshot(root);
    expect(s0).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot(root)).toBe(s0);
    writeFileSync(join(root, ".worktrees", "w", "b.txt"), "b");
    const s1 = snapshot(root);
    expect(s1).not.toBe(s0);
    run(join(root, ".worktrees", "w"), "add", "b.txt"); run(join(root, ".worktrees", "w"), "commit", "-q", "-m", "b");
    expect(snapshot(root)).not.toBe(s1);
    expect(snapshot(join(root, ".worktrees", "w"))).toBe(snapshot(root));
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
});

describe("verify-gate hook", () => {
  let root: string, spool: string, transcriptPath: string, fakeJudge: string, verdictFile: string;
  const posted: any[] = [];
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "aleph-gate-"));
    run(root, "init", "-q", "-b", "main");
    writeFileSync(join(root, "a.txt"), "a"); run(root, "add", "a.txt"); run(root, "commit", "-q", "-m", "init");
    spool = mkdtempSync(join(tmpdir(), "aleph-gate-spool-"));
    transcriptPath = join(root, "t.jsonl");
    verdictFile = join(spool, "verdict.txt");
    fakeJudge = join(spool, "judge.ts");
    writeFileSync(fakeJudge, `const v = await Bun.file(${JSON.stringify(verdictFile)}).text(); console.log(JSON.stringify({ result: v }));`);
    server = Bun.serve({ port: 0, fetch: async (req) => { posted.push({ url: new URL(req.url).pathname, body: await req.json() }); return new Response("{}"); } });
  });
  afterAll(() => { server.stop(); rmSync(root, { recursive: true, force: true }); rmSync(spool, { recursive: true, force: true }); });

  async function fire(event: string, promptId: string, extra: object = {}) {
    const proc = Bun.spawn(["bun", join(HOOKS, "verify-gate.ts")], {
      stdin: new TextEncoder().encode(JSON.stringify({ hook_event_name: event, session_id: "s1", prompt_id: promptId, cwd: root, transcript_path: transcriptPath, ...extra })),
      env: { ...process.env, ALEPH_SPOOL: spool, ALEPH_JUDGE_CMD: join(spool, "claude"), LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" },
      stdout: "pipe", stderr: "pipe",
    });
    const code = await proc.exited;
    return { code, stdout: (await new Response(proc.stdout).text()).trim(), stderr: await new Response(proc.stderr).text() };
  }
  beforeAll(() => {
    const wrapper = join(spool, "claude");
    writeFileSync(wrapper, `#!/bin/sh\nexec bun ${fakeJudge}\n`);
    Bun.spawnSync(["chmod", "+x", wrapper]);
  });

  test("unchanged tree: passes silently, posts nothing", async () => {
    transcript(transcriptPath, "p1", [user("hello"), say("hi")]);
    await fire("UserPromptSubmit", "p1");
    const before = posted.length;
    const r = await fire("Stop", "p1", { last_assistant_message: "hi" });
    expect(r.stdout).toBe("");
    expect(posted.length).toBe(before);
  });

  test("changed tree, judge denies twice, third stop is a forced pass", async () => {
    await fire("UserPromptSubmit", "p2");
    writeFileSync(join(root, "a.txt"), "changed");
    transcript(transcriptPath, "p2", [user("change a"), toolUse("t1", "Bash", { command: "sed -i s/a/changed/ a.txt" }), toolResult("t1", "", { stdout: "", stderr: "" }), say("Done, it works.")]);
    writeFileSync(verdictFile, '{"verdict":"deny","reason":"Nothing ran after the edit."}');

    const r1 = await fire("Stop", "p2", { last_assistant_message: "Done, it works." });
    const out1 = JSON.parse(r1.stdout);
    expect(out1.decision).toBe("block");
    expect(out1.reason).toContain("Nothing ran after the edit.");
    const span1 = posted.at(-2)?.url === "/api/public/otel/v1/traces" ? posted.at(-2) : posted.at(-1);
    const scores = posted.filter((p) => p.url === "/api/public/scores");
    expect(scores.at(-1).body).toMatchObject({ name: "verified", value: 0 });

    const r2 = await fire("Stop", "p2", { last_assistant_message: "Done, it works.", stop_hook_active: true });
    expect(JSON.parse(r2.stdout).decision).toBe("block");

    const r3 = await fire("Stop", "p2", { last_assistant_message: "Done, it works.", stop_hook_active: true });
    expect(r3.stdout).toBe("");
    expect(posted.filter((p) => p.url === "/api/public/scores").at(-1).body).toMatchObject({ name: "verified", value: 0.5 });
    const spans = posted.filter((p) => p.url === "/api/public/otel/v1/traces").map((p) => p.body.resourceSpans[0].scopeSpans[0].spans[0]);
    const last = spans.at(-1);
    expect(last.name).toBe("verify-gate");
    expect(last.attributes.find((a: any) => a.key === "langfuse.observation.metadata.kind").value).toEqual({ stringValue: "forced" });
    expect(last.parentSpanId).toMatch(/^[0-9a-f]{16}$/);
    void span1;
  });

  test("judge passes: no output, score 1", async () => {
    await fire("UserPromptSubmit", "p3");
    writeFileSync(join(root, "a.txt"), "changed again");
    transcript(transcriptPath, "p3", [user("change a"), toolUse("t1", "Bash", { command: "bun test" }), toolResult("t1", "1 pass", { stdout: "1 pass", stderr: "" }), say("Tests pass.")]);
    writeFileSync(verdictFile, '{"verdict":"pass","reason":"bun test ran after the edit and passed."}');
    const r = await fire("Stop", "p3", { last_assistant_message: "Tests pass." });
    expect(r.stdout).toBe("");
    expect(posted.filter((p) => p.url === "/api/public/scores").at(-1).body).toMatchObject({ value: 1 });
  });

  test("user skip passes without calling the judge", async () => {
    await fire("UserPromptSubmit", "p4");
    writeFileSync(join(root, "a.txt"), "x");
    transcript(transcriptPath, "p4", [user("edit a, skip verify"), say("Done.")]);
    writeFileSync(verdictFile, '{"verdict":"deny","reason":"should not be consulted"}');
    const r = await fire("Stop", "p4", { last_assistant_message: "Done." });
    expect(r.stdout).toBe("");
    const last = posted.filter((p) => p.url === "/api/public/otel/v1/traces").at(-1).body.resourceSpans[0].scopeSpans[0].spans[0];
    expect(last.attributes.find((a: any) => a.key === "langfuse.observation.metadata.kind").value).toEqual({ stringValue: "skip" });
  });

  test("judge garbage: fails open with a warning span", async () => {
    await fire("UserPromptSubmit", "p5");
    writeFileSync(join(root, "a.txt"), "y");
    transcript(transcriptPath, "p5", [user("edit a"), say("Done.")]);
    writeFileSync(verdictFile, "not json at all");
    const r = await fire("Stop", "p5", { last_assistant_message: "Done." });
    expect(r.stdout).toBe("");
    const last = posted.filter((p) => p.url === "/api/public/otel/v1/traces").at(-1).body.resourceSpans[0].scopeSpans[0].spans[0];
    expect(last.attributes.find((a: any) => a.key === "langfuse.observation.metadata.kind").value).toEqual({ stringValue: "fail-open" });
    expect(last.attributes.find((a: any) => a.key === "langfuse.observation.level").value).toEqual({ stringValue: "WARNING" });
  });
});
