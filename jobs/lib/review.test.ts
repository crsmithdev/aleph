import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import type { Review } from "./ledger.ts";

let base: string, jobs: string, uiTodo: number, plainTodo: number;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(a, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${a.join(" ")}: ${p.stderr}`);
};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "review-"));
  jobs = join(base, "jobs");
  const repo = join(base, "repo");
  mkdirSync(repo);
  sh(repo, "git", "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-qm", "init");
  sh(repo, "git", "branch", "job/x");
  // job/x changes one view and carries a stand-in for ui/server.ts: it answers with its pid, parent and cwd on --port, and leaves a mark when it starts.
  sh(repo, "git", "switch", "-q", "job/x");
  mkdirSync(join(repo, "ui/views"), { recursive: true });
  writeFileSync(join(repo, "ui/views/status.js"), "export const view = 1;\n");
  writeFileSync(join(repo, "ui/server.ts"), `import { appendFileSync, existsSync } from "node:fs";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
appendFileSync(${JSON.stringify(join(base, "server-mark"))}, port + "\\n");
appendFileSync(${JSON.stringify(join(base, "server-env"))}, JSON.stringify(Object.keys(process.env)) + "\\n");
Bun.serve({ hostname: "127.0.0.1", port, fetch: () => Response.json({ pid: process.pid, ppid: process.ppid, port, merged: existsSync("ui/views/status.js"), git: Bun.spawnSync(["git", "--version"]).exitCode === 0 }) });
`);
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-qm", "view");
  sh(repo, "git", "switch", "-q", "main");
  // main moves on after the branch left it: the merge result holds both.
  writeFileSync(join(repo, "b.txt"), "b\n");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-qm", "main moves");
  sh(repo, "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ demo: { path: repo, main: "main", checks: [{ name: "t", run: "true" }] } }));
  process.env.ALEPH_JOBS_DIR = jobs;
  process.env.ALEPH_REPOS = join(base, "repos.json");
  process.env.ALEPH_ITEMS = join(base, "items");
  // The work store, with one goal labelled ui and one not.
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  uiTodo = writeList({ key: "demo" }, "add", (doc) => todos.addLegacy(doc, "a view", { labels: ["goal", "ui"], body: "b" }).id, true)!.value;
  plainTodo = writeList({ key: "demo" }, "add", (doc) => todos.addLegacy(doc, "a fix", { labels: ["goal"], body: "b" }).id, true)!.value;
  process.env.TEST_SERVER_MARK = join(base, "server-mark");
  process.env.ALEPH_REVIEW_SETTLE_MS = "0";
  // The stand-in for srt: the clean environment, as cli.test.ts has it.
  writeFileSync(join(base, "pass"), `#!/bin/bash\nshift\nexec env -i "$@"\n`, { mode: 0o755 });
  process.env.ALEPH_SANDBOX_CMD = join(base, "pass");
  process.env.ALEPH_RUNS_DIR = join(base, "runs");
  process.env.ALEPH_JOB_FOREGROUND = "1";
});
afterAll(() => {
  delete process.env.ALEPH_SANDBOX_CMD;
  delete process.env.ALEPH_REVIEW_CHROME;
  delete process.env.ALEPH_REVIEW_SETTLE_MS;
  delete process.env.TEST_SERVER_MARK;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  rmSync(base, { recursive: true, force: true });
});

/** A held run in a job folder, with the spec. */
function held(id: string, extra: object = {}): string {
  const folder = join(jobs, id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "spec.md"), "Goal: g\n");
  writeFileSync(join(folder, "state.json"), JSON.stringify({
    kind: "build", job: id, name: id, repo: "demo", branch: "job/x", state: "awaiting", ask: { kind: "approval", reason: "held-path", question: "held path a.txt", options: [], why: [] }, reason: "held path a.txt", told: false, started: "2026-10-27T10:00:00Z", ...extra,
  }));
  return folder;
}
const fakeClaude = (result: string) => {
  const f = join(base, `claude-${crypto.randomUUID()}`);
  writeFileSync(f, `#!/bin/bash\ncat > /dev/null\nprintf '%s\\n' '${JSON.stringify({ type: "result", is_error: false, result })}'\n`, { mode: 0o755 });
  return f;
};
const state = (folder: string) => JSON.parse(readFileSync(join(folder, "state.json"), "utf8"));
const reviewAt = async (folder: string) => (await import("./ledger.ts")).readCall(folder);

describe("review", () => {
  const cases: [string, string, Review][] = [
    ["VERDICT: land", "land", { call: "land" }],
    ["Looked.\nVERDICT: back a test lost an assertion", "back", { call: "back", reason: "a test lost an assertion" }],
    ["VERDICT: chris keep the old name?", "chris", { call: "ask", reason: "keep the old name?" }],
  ];
  for (const [text, name, want] of cases) {
    test(`a ${name} verdict is written and recorded`, async () => {
      const { runReview } = await import("./review.ts");
      const folder = held(`v-${name}`);
      process.env.ALEPH_REVIEW_CMD = fakeClaude(text);
      await runReview(folder);
      expect(readFileSync(join(folder, "call.md"), "utf8")).toContain(text);
      expect(await reviewAt(folder)).toEqual(want);
      expect(state(folder).review).toBeUndefined();
      expect(state(folder)).toMatchObject({ state: "awaiting", ask: { kind: "approval", reason: "held-path" } });
      expect(existsSync(join(folder, "review"))).toBe(false);
    });
  }

  test("recordReview puts the call on state.json: chris reads as ask, a pending or malformed review records none", async () => {
    const { runReview, recordReview } = await import("./review.ts");
    for (const [name, text, want] of [["land", "VERDICT: land", { call: "land" }], ["back", "VERDICT: back fix it", { call: "back", reason: "fix it" }], ["chris", "VERDICT: chris sure?", { call: "ask", reason: "sure?" }]] as const) {
      const folder = held(`rec-${name}`);
      process.env.ALEPH_REVIEW_CMD = fakeClaude(text);
      await runReview(folder);
      recordReview(folder);
      expect(state(folder).review).toEqual(want);
      expect((await import("./ledger.ts")).reviewOf({ id: "x", folder, run: state(folder) })).toEqual(want);
    }
    const bad = held("rec-bad");
    process.env.ALEPH_REVIEW_CMD = fakeClaude("VERDICT: maybe");
    await runReview(bad);
    recordReview(bad);
    expect(state(bad).review).toBeUndefined();
  });

  test("a malformed verdict records error and leaves the run held", async () => {
    const { runReview } = await import("./review.ts");
    const folder = held("bad");
    process.env.ALEPH_REVIEW_CMD = fakeClaude("VERDICT: maybe");
    await runReview(folder);
    expect((await reviewAt(folder))?.call).toBe("error");
    expect(state(folder)).toMatchObject({ state: "awaiting", ask: { kind: "approval", reason: "held-path" } });
  });

  test("a held run starts one review, a second pass none", async () => {
    const { startReview } = await import("./review.ts");
    process.env.ALEPH_REVIEW_CMD = fakeClaude("VERDICT: land");
    const folder = held("once");
    expect([startReview(folder), existsSync(join(folder, "call.md")) ? readFileSync(join(folder, "call.md"), "utf8") : ""]).toEqual([true, "PENDING\n"]);
    expect(startReview(folder)).toBe(false);
    for (let i = 0; i < 100 && (await reviewAt(folder))?.call === "pending"; i++) await Bun.sleep(100);
    expect(await reviewAt(folder)).toEqual({ call: "land" });
  });

  test("a drop that writes state.json while review runs loses no field", async () => {
    const { runReview } = await import("./review.ts");
    const { updateRun } = await import("./ledger.ts");
    const folder = held("race");
    const slow = join(base, "claude-slow");
    writeFileSync(slow, `#!/bin/bash\ncat > /dev/null\nsleep 1\nprintf '%s\\n' '${JSON.stringify({ type: "result", is_error: false, result: "VERDICT: land" })}'\n`, { mode: 0o755 });
    process.env.ALEPH_REVIEW_CMD = slow;
    const running = runReview(folder);
    await Bun.sleep(300);
    updateRun(folder, { state: "dropped", reason: "dropped by Chris" });
    await running;
    expect(state(folder)).toMatchObject({ state: "dropped", reason: "dropped by Chris", ask: expect.objectContaining({ reason: "held-path" }), branch: "job/x" });
    expect(await reviewAt(folder)).toEqual({ call: "land" });
  });

  test("a second review on a folder refuses while one runs", async () => {
    const { runReview } = await import("./review.ts");
    const folder = held("twice");
    const slow = join(base, "claude-slow2");
    writeFileSync(slow, `#!/bin/bash\ncat > /dev/null\nsleep 1\nprintf '%s\\n' '${JSON.stringify({ type: "result", is_error: false, result: "VERDICT: land" })}'\n`, { mode: 0o755 });
    process.env.ALEPH_REVIEW_CMD = slow;
    const first = runReview(folder);
    await Bun.sleep(300);
    await expect(runReview(folder)).rejects.toThrow("already running");
    await first;
    expect(await reviewAt(folder)).toEqual({ call: "land" });
  });

  test("a drop that removes the run folder does not throw from review", async () => {
    const { runReview } = await import("./review.ts");
    const folder = held("gone");
    const slow = join(base, "claude-slow3");
    writeFileSync(slow, `#!/bin/bash\ncat > /dev/null\nsleep 1\necho nothing\n`, { mode: 0o755 });
    process.env.ALEPH_REVIEW_CMD = slow;
    const running = runReview(folder);
    await Bun.sleep(300);
    rmSync(folder, { recursive: true, force: true });
    await running;
  });

  test("a run that is not held starts none", async () => {
    const { startReview } = await import("./review.ts");
    expect(startReview(held("passed", { state: "passed", ask: undefined }))).toBe(false);
    expect(startReview(held("manual", { ask: { kind: "input", reason: "manual", question: "check", options: [], why: [] } }))).toBe(false);
  });
});

describe("review under srt", () => {
  test("the profile reads the run folder, writes review/ and tmp/, and reaches the API and localhost", async () => {
    const { profile } = await import("./sandbox.ts");
    const { REVIEW_SANDBOX } = await import("./review.ts");
    const folder = held("profile");
    const s = JSON.parse(readFileSync(profile(folder, REVIEW_SANDBOX), "utf8"));
    expect(s.network).toEqual({ allowedDomains: ["api.anthropic.com", "localhost"], allowLocalBinding: true, deniedDomains: [] });
    expect(s.filesystem.allowRead).not.toContain(folder);
    expect(s.filesystem.allowRead).toContain(join(folder, "state.json"));
    expect(s.filesystem.allowRead).not.toContain(join(folder, "review"));
    expect(s.filesystem.allowRead).not.toContain(join(folder, "tmp"));
    expect(s.filesystem.allowRead).not.toContain(join(base));
    expect(s.filesystem.allowWrite).toEqual([join(folder, "review"), join(folder, "tmp")]);
  });

  test("the reviewer runs with its own home and the run folder as its only read", async () => {
    const { runReview } = await import("./review.ts");
    const folder = held("home");
    const seen = join(base, "seen");
    writeFileSync(join(base, "claude-home"), `#!/bin/bash\ncat > /dev/null\necho "$HOME|$PWD" > "${seen}"\necho '{"type":"result","is_error":false,"result":"VERDICT: land"}'\n`, { mode: 0o755 });
    process.env.ALEPH_REVIEW_CMD = join(base, "claude-home");
    await runReview(folder);
    const [home, cwd] = readFileSync(seen, "utf8").trim().split("|");
    expect(home).toBe(join(folder, "review", "home"));
    expect(cwd).toBe(join(folder, "review", "work"));
    expect(await reviewAt(folder)).toEqual({ call: "land" });
  });
});

describe("parseVerdict", () => {
  test("takes the last VERDICT line and needs a reason for back and chris", async () => {
    const { parseVerdict } = await import("./review.ts");
    expect(parseVerdict("VERDICT: back x\nVERDICT: land")).toEqual({ call: "land" });
    expect(parseVerdict("VERDICT: back")).toBeNull();
    expect(parseVerdict("nothing")).toBeNull();
  });
});

describe("review unit", () => {
  test("the systemd-run argv of review has CPUWeight=20 and --nice=10", () => {
    const folder = held("unit-argv");
    const log = join(base, "review-argv");
    mkdirSync(join(base, "bin"), { recursive: true });
    writeFileSync(join(base, "bin", "systemd-run"), `#!/bin/bash\necho "$@" > ${log}\n`, { mode: 0o755 });
    // A child process: Bun looks a command up in the PATH it started with.
    const env = { ...process.env, PATH: `${join(base, "bin")}:${process.env.PATH}`, ALEPH_JOB_FOREGROUND: "" };
    const p = Bun.spawnSync(["bun", "-e", `import { startReview } from "${join(import.meta.dir, "review.ts")}"; process.exit(startReview(${JSON.stringify(folder)}) ? 0 : 1);`], { env, stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(0);
    const argv = readFileSync(log, "utf8");
    expect(argv).toContain("--property=CPUWeight=20");
    expect(argv).toContain("--nice=10");
  });
});

/**
 * A stand-in for Chrome: answers CDP on fds 3 and 4, records its argv, fetches each page it is told to
 * navigate to (the answer of the harness's server, appended to `answers`), and throws on a page whose URL holds "boom".
 */
const FAKE_CHROME = (argvFile: string, answers: string) => `#!${process.execPath}
import { appendFileSync, createReadStream, createWriteStream, writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));
const out = createWriteStream("", { fd: 4 });
const send = (m) => out.write(JSON.stringify(m) + "\\0");
const widths = {}, urls = {};
let n = 0, buf = "";
createReadStream("", { fd: 3 }).on("data", async (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\\0")) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    const s = m.sessionId;
    let result = {};
    if (m.method === "Browser.getVersion") result = { product: "FakeChrome/1" };
    else if (m.method === "Target.createTarget") result = { targetId: "t" + ++n };
    else if (m.method === "Target.attachToTarget") result = { sessionId: "s" + n };
    else if (m.method === "Emulation.setDeviceMetricsOverride") widths[s] = m.params.width;
    else if (m.method === "Page.navigate") {
      urls[s] = m.params.url;
      appendFileSync(${JSON.stringify(answers)}, await fetch(m.params.url).then((r) => r.text(), (e) => JSON.stringify({ error: String(e) })) + "\\n");
    }
    else if (m.method === "Runtime.evaluate") {
      const e = m.params.expression;
      if (urls[s].includes("fail")) { send({ id: m.id, error: { message: "Cannot find context" }, sessionId: s }); continue; }
      const over = widths[s] === 390 && !urls[s].includes("boom");
      if (e.includes("scrollWidth")) result = { result: { value: JSON.stringify({ scrollWidth: over ? 412 : widths[s], clientWidth: widths[s] }) } };
      else result = { result: { value: JSON.stringify([{ selector: "div#wide.card", width: 412 }]) } };
    }
    else if (m.method === "Page.getLayoutMetrics") result = { cssContentSize: { width: widths[s], height: 1200 } };
    else if (m.method === "Page.captureScreenshot") result = { data: Buffer.from("PNG").toString("base64") };
    send({ id: m.id, result, ...(s ? { sessionId: s } : {}) });
    if (m.method === "Page.navigate") {
      if (urls[s].includes("boom")) send({ method: "Runtime.exceptionThrown", sessionId: s, params: { exceptionDetails: { exception: { description: "TypeError: x is undefined\\n    at view.js:1" } } } });
      if (urls[s].includes("boom")) send({ method: "Runtime.consoleAPICalled", sessionId: s, params: { type: "error", args: [{ value: "bad" }, { description: "Error: y" }] } });
      send({ method: "Page.loadEventFired", sessionId: s, params: {} });
    }
  }
});
`;

/** A reviewer that records whether the report was there when it started and what its prompt said, then exits with `code`. */
function reviewer(seenFile: string, code: number): string {
  const f = join(base, `claude-ui-${crypto.randomUUID()}`);
  writeFileSync(f, `#!/bin/bash
folder=$(dirname "$TMPDIR")
cat > /dev/null
[ -f "$folder/browser/report.md" ] && echo report > "${seenFile}" || echo none > "${seenFile}"
${code === 0 ? `echo '{"type":"result","is_error":false,"result":"Browser: seen\\nVERDICT: land"}'` : `echo boom >&2`}
exit ${code}
`, { mode: 0o755 });
  return f;
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe("review browser step", () => {
  for (const code of [0, 3]) {
    test(`a ui goal: the harness starts the server, Chrome loads the changed view from it, the server is gone after (reviewer exit ${code})`, async () => {
      const { runReview } = await import("./review.ts");
      const tag = `ui-${code}`;
      const argvFile = join(base, `argv-${tag}`), answers = join(base, `answers-${tag}`), seen = join(base, `seen-${tag}`);
      rmSync(process.env.TEST_SERVER_MARK!, { force: true });
      rmSync(join(base, "server-env"), { force: true });
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "real-token";
      writeFileSync(join(base, `chrome-${tag}`), FAKE_CHROME(argvFile, answers), { mode: 0o755 });
      process.env.ALEPH_REVIEW_CHROME = join(base, `chrome-${tag}`);
      process.env.ALEPH_REVIEW_CMD = reviewer(seen, code);
      const folder = held(tag, { todo: uiTodo });
      await runReview(folder);

      // The server answered on its port while Chrome ran, from the harness's process tree, on the merge result, with git on its PATH.
      const got = readFileSync(answers, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(got.length).toBe(8); // the front page (ui/server.ts changed) and #/status, four loads each
      const { pid, ppid, port, merged, git } = got[0];
      expect(port).toBeGreaterThanOrEqual(3002);
      expect(ppid).toBe(process.pid);
      expect(merged).toBe(true);
      expect(git).toBe(true);
      expect(new Set(got.map((g) => g.pid))).toEqual(new Set([pid]));
      expect(readFileSync(process.env.TEST_SERVER_MARK!, "utf8").trim()).toBe(String(port));
      // It runs on a clean env, not the harness's: the real ALEPH_* stores and tokens are not in it.
      const keys: string[] = JSON.parse(readFileSync(join(base, "server-env"), "utf8").trim().split("\n").pop()!);
      expect(keys).not.toContain("ALEPH_JOBS_DIR");
      expect(keys).not.toContain("ALEPH_REPOS");
      expect(keys).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");

      // The browser result is in the run folder, before the reviewer starts.
      expect(readFileSync(seen, "utf8").trim()).toBe("report");
      const report = readFileSync(join(folder, "browser/report.md"), "utf8");
      expect(report).toContain("FakeChrome/1");
      expect(report).toContain(`## 2. http://127.0.0.1:${port}/#/status`);
      expect(report).toContain(`| 390 | dark | overflow: 412 > 390 — div#wide.card (412px) | 0 | ${join(folder, "browser/1-390-dark.png")} |`);
      expect(report).toContain(`| 1440 | light | overflow: none | 0 | ${join(folder, "browser/1-1440-light.png")} |`);
      expect(readdirSync(join(folder, "browser")).filter((f) => f.endsWith(".png")).sort()).toEqual(["1-1440-dark.png", "1-1440-light.png", "1-390-dark.png", "1-390-light.png", "2-1440-dark.png", "2-1440-light.png", "2-390-dark.png", "2-390-light.png"]);
      const argv: string[] = JSON.parse(readFileSync(argvFile, "utf8"));
      expect(argv).toContain("--remote-debugging-pipe");
      expect(argv).not.toContain("--no-sandbox");

      // The server is gone, the scratch worktree too, and the reviewer's exit is what call.md says.
      expect(alive(pid)).toBe(false);
      expect(await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)).toBe(false);
      expect(existsSync(join(folder, "review"))).toBe(false);
      expect(await reviewAt(folder)).toEqual(code === 0 ? { call: "land" } : { call: "error", reason: expect.any(String) } as any);
    }, 30_000);
  }

  test("page errors and console errors land in the report, and a CDP failure on one view leaves the others reported", async () => {
    const { browserStep } = await import("./review-browser.ts");
    const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("{}") });
    try {
      writeFileSync(join(base, "chrome-cdp"), FAKE_CHROME(join(base, "argv-cdp"), join(base, "answers-cdp")), { mode: 0o755 });
      process.env.ALEPH_REVIEW_CHROME = join(base, "chrome-cdp");
      const folder = join(base, "cdp-run");
      mkdirSync(join(folder, "browser"), { recursive: true });
      const u = `http://127.0.0.1:${srv.port}`;
      await browserStep(folder, [`${u}/boom`, `${u}/fail`, `${u}/fine`]);
      const report = readFileSync(join(folder, "browser/report.md"), "utf8");
      // The view that throws: its exception and console.error are listed.
      expect(report).toContain("- 1440 light: TypeError: x is undefined");
      expect(report).toContain("- 390 dark: console.error: bad Error: y");
      // The view whose Runtime.evaluate fails: every size is a CDP-failed row, and no screenshot.
      expect(report.match(/ERROR: CDP failed: Cannot find context/g)?.length).toBe(4);
      expect(existsSync(join(folder, "browser/2-1440-light.png"))).toBe(false);
      // The view after it is still shot.
      expect(report).toContain(`| 1440 | light | overflow: none | 0 | ${join(folder, "browser/3-1440-light.png")} |`);
      expect(existsSync(join(folder, "browser/3-390-dark.png"))).toBe(true);
    } finally { srv.stop(true); }
  }, 30_000);

  test("the prompt of a ui goal sends the reviewer to the report and does not tell it to start a server or Chrome", async () => {
    const { runReview, REVIEW_SANDBOX } = await import("./review.ts");
    process.env.ALEPH_REVIEW_CHROME = join(base, "chrome-ui-0");
    process.env.ALEPH_REVIEW_CMD = reviewer(join(base, "seen-prompt"), 0);
    const folder = held("ui-prompt", { todo: uiTodo });
    await runReview(folder);
    const prompt = readFileSync(join(folder, "review-prompt.md"), "utf8");
    expect(prompt).not.toContain("bun ui/server.ts");
    expect(prompt).not.toContain("Start `bun");
    expect(prompt).toContain(join(folder, "browser/report.md"));
    expect(prompt).toContain("horizontal scroll");
    expect(REVIEW_SANDBOX).toEqual({ read: ["."], write: ["review", "tmp"], net: { domains: ["api.anthropic.com", "localhost"], localBinding: true } });
  }, 30_000);

  test("a goal that is not ui starts no server and no Chrome", async () => {
    const { runReview } = await import("./review.ts");
    rmSync(process.env.TEST_SERVER_MARK!, { force: true });
    const argvFile = join(base, "argv-plain");
    rmSync(argvFile, { force: true });
    writeFileSync(join(base, "chrome-plain"), FAKE_CHROME(argvFile, join(base, "answers-plain")), { mode: 0o755 });
    process.env.ALEPH_REVIEW_CHROME = join(base, "chrome-plain");
    process.env.ALEPH_REVIEW_CMD = reviewer(join(base, "seen-plain"), 0);
    const folder = held("plain", { todo: plainTodo });
    await runReview(folder);
    expect(existsSync(process.env.TEST_SERVER_MARK!)).toBe(false);
    expect(existsSync(argvFile)).toBe(false);
    expect(readdirSync(join(folder, "browser"))).toEqual([]);
    expect(readFileSync(join(base, "seen-plain"), "utf8").trim()).toBe("none");
    expect(readFileSync(join(folder, "review-prompt.md"), "utf8")).not.toContain("browser/report.md");
    expect(await reviewAt(folder)).toEqual({ call: "land" });
  }, 30_000);

  test("when Chrome's sandbox cannot start, the report says so with the log tail, the server is gone, and the review goes on", async () => {
    const { runReview } = await import("./review.ts");
    const { SANDBOX_ERROR } = await import("./review-browser.ts");
    rmSync(process.env.TEST_SERVER_MARK!, { force: true });
    writeFileSync(join(base, "chrome-nosandbox"), `#!/bin/bash\necho "[1:1:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! Update your kernel" >&2\nexit 1\n`, { mode: 0o755 });
    process.env.ALEPH_REVIEW_CHROME = join(base, "chrome-nosandbox");
    process.env.ALEPH_REVIEW_CMD = reviewer(join(base, "seen-nosandbox"), 0);
    const folder = held("ui-nosandbox", { todo: uiTodo });
    await runReview(folder);
    const report = readFileSync(join(folder, "browser/report.md"), "utf8");
    expect(report).toContain(SANDBOX_ERROR);
    expect(report).toContain("No usable sandbox!");
    expect(readdirSync(join(folder, "browser")).some((f) => f.endsWith(".png"))).toBe(false);
    const port = Number(readFileSync(process.env.TEST_SERVER_MARK!, "utf8").trim());
    expect(await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)).toBe(false);
    expect(await reviewAt(folder)).toEqual({ call: "land" });
  }, 30_000);

  test("the changed views are the routes of the views a diff touches", async () => {
    const { changedViews, chromeArgv } = await import("./review-browser.ts");
    expect(changedViews(["ui/views/jobs.js", "ui/views/sessions-turn.js", "ui/views/sessions.js", "README.md"], "http://127.0.0.1:3002")).toEqual(
      ["http://127.0.0.1:3002/#/jobs", "http://127.0.0.1:3002/#/sessions"]);
    expect(changedViews(["ui/lib.js"], "http://x")).toEqual(["http://x/"]);
    expect(changedViews(["a.txt"], "http://x")).toEqual([]);
    const a = chromeArgv("/p");
    expect(a).toContain("--remote-debugging-pipe");
    expect(a.join(" ")).not.toContain("--no-sandbox");
    expect(a.join(" ")).not.toContain("--remote-debugging-port");
  });
});
