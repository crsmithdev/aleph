import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";

// No fetch and no port here: the fake reviewer only names URLs, and the fake Chrome answers over its pipe.
let base: string, jobs: string, todo: number;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(a, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${a.join(" ")}: ${p.stderr}`);
};

/** A stand-in for Chrome: answers CDP on fds 3 and 4, records its argv, and throws on a page whose URL holds "boom". */
const FAKE_CHROME = (argvFile: string) => `#!${process.execPath}
import { createReadStream, createWriteStream, writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));
const out = createWriteStream("", { fd: 4 });
const send = (m) => out.write(JSON.stringify(m) + "\\0");
const widths = {}, urls = {};
let n = 0, buf = "";
createReadStream("", { fd: 3 }).on("data", (d) => {
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
    else if (m.method === "Page.navigate") urls[s] = m.params.url;
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
      send({ method: "Page.loadEventFired", sessionId: s, params: {} });
    }
  }
});
`;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "review2-browser-"));
  jobs = join(base, "jobs");
  const repo = join(base, "repo");
  mkdirSync(join(repo, "node_modules", "typescript"), { recursive: true });
  sh(repo, "git", "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  writeFileSync(join(repo, "tsconfig.json"), "{}\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules\n");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-qm", "init");
  sh(repo, "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  sh(repo, "git", "branch", "job/x");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ demo: { path: repo, main: "main", checks: [{ name: "t", run: "true" }] } }));
  // The work store, with one goal labelled ui.
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  Object.assign(process.env, {
    ALEPH_JOBS_DIR: jobs, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: join(base, "items"), ALEPH_RUNS_DIR: join(base, "runs"), ALEPH_JOB_FOREGROUND: "1",
  });
  todo = writeList({ key: "demo" }, "add", (doc) => todos.add(doc, "a view", { labels: ["goal", "ui"], body: "b" }).id, true)!.value;
  // The stand-in for srt: the clean environment, as review2.test.ts has it.
  writeFileSync(join(base, "pass"), `#!/bin/bash\nshift\nexec env -i "$@"\n`, { mode: 0o755 });
  process.env.ALEPH_SANDBOX_CMD = join(base, "pass");
  process.env.ALEPH_REVIEW2_SETTLE_MS = "0";
});
afterAll(() => {
  delete process.env.ALEPH_SANDBOX_CMD;
  delete process.env.ALEPH_REVIEW2_CHROME;
  delete process.env.ALEPH_REVIEW2_SETTLE_MS;
  rmSync(base, { recursive: true, force: true });
});

function held(id: string): string {
  const folder = join(jobs, id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "spec.md"), "Goal: g\n");
  writeFileSync(join(folder, "state.json"), JSON.stringify({
    kind: "agent", job: id, name: id, repo: "demo", branch: "job/x", todo, state: "needs-you", needs: "held", reason: "held", told: false, started: "2026-10-28T10:00:00Z",
  }));
  return folder;
}

/**
 * A stand-in for the sandboxed reviewer: it writes its browse request where the recipe says, in $TMPDIR (the
 * run folder's tmp/, the one place in the folder REVIEW2_SANDBOX lets it write besides review2/), waits for the
 * harness's report, and lands only when it came.
 */
function fakeReviewer(urls: string[]): string {
  const f = join(base, `claude-${crypto.randomUUID()}`);
  writeFileSync(f, `#!/bin/bash
cat > /dev/null
folder=$(dirname "$TMPDIR")
printf '%s\\n' ${urls.map((u) => `'${u}'`).join(" ")} > "$TMPDIR/views.part"
mv "$TMPDIR/views.part" "$TMPDIR/views.txt"
for i in $(seq 300); do [ -f "$folder/browser/report.md" ] && break; sleep 0.1; done
[ -f "$folder/browser/report.md" ] && v=land || v="back no report"
printf '{"type":"result","is_error":false,"result":"Browser: seen\\\\nVERDICT: %s"}\\n' "$v"
`, { mode: 0o755 });
  return f;
}

describe("review2 browser step", () => {
  test("only http URLs on localhost are loaded", async () => {
    const { parseViews } = await import("./review2-browser.ts");
    expect(parseViews("http://127.0.0.1:4100/status\nhttps://example.com/\nfile:///etc/passwd\nhttp://localhost:3/x\n\nnot a url\n")).toEqual({
      urls: ["http://127.0.0.1:4100/status", "http://localhost:3/x"], dropped: 3,
    });
  });

  test("Chrome joins the sandbox's namespaces with its own sandbox and a pipe, never a port or --no-sandbox", async () => {
    const { chromeArgv } = await import("./review2-browser.ts");
    const a = chromeArgv(process.pid, "/p");
    expect(a.slice(0, 4)).toEqual(["nsenter", "-t", String(process.pid), "--preserve-credentials"]);
    expect(a).toContain("-n");
    expect(a).toContain("--remote-debugging-pipe");
    expect(a.join(" ")).not.toContain("--no-sandbox");
    expect(a.join(" ")).not.toContain("--remote-debugging-port");
    expect(chromeArgv(null, "/p")[0]).not.toBe("nsenter");
  });

  test("the browse request sits in a folder the reviewer may write, the report in one it only reads", async () => {
    const { VIEWS, BROWSER } = await import("./review2-browser.ts");
    const { REVIEW2_SANDBOX } = await import("./review2.ts");
    expect(REVIEW2_SANDBOX.write).toContain(VIEWS.split("/")[0]);
    expect(REVIEW2_SANDBOX.write).not.toContain(BROWSER.split("/")[0]);
    expect(REVIEW2_SANDBOX.read).toEqual(["."]);
  });

  test("a ui review: the reviewer's views.txt in tmp/ gets screenshots at 1440 and 390, light and dark, and a report", async () => {
    const { runReview2 } = await import("./review2.ts");
    const argvFile = join(base, "argv-ok");
    writeFileSync(join(base, "chrome-ok"), FAKE_CHROME(argvFile), { mode: 0o755 });
    process.env.ALEPH_REVIEW2_CHROME = join(base, "chrome-ok");
    const folder = held("ui-ok");
    process.env.ALEPH_REVIEW2_CMD = fakeReviewer(["http://127.0.0.1:4100/status", "http://127.0.0.1:4100/boom", "https://example.com/"]);
    await runReview2(folder);
    expect(readFileSync(join(folder, "review2.md"), "utf8")).toContain("VERDICT: land");
    const prompt = readFileSync(join(folder, "review2-prompt.md"), "utf8");
    expect(prompt).toContain(join(folder, "tmp/views.txt"));
    expect(prompt).toContain("bunx tsc --noEmit");
    const report = readFileSync(join(folder, "browser/report.md"), "utf8");
    expect(report).toContain("FakeChrome/1");
    expect(report).toContain("## 1. http://127.0.0.1:4100/status");
    expect(report).toContain(`| 390 | dark | overflow: 412 > 390 — div#wide.card (412px) | 0 | ${join(folder, "browser/1-390-dark.png")} |`);
    expect(report).toContain(`| 1440 | light | overflow: none | 0 | ${join(folder, "browser/1-1440-light.png")} |`);
    expect(report).toContain("- 1440 light: TypeError: x is undefined");
    expect(report).toContain("1 line(s) of tmp/views.txt dropped");
    expect(report).not.toContain("example.com");
    expect(readdirSync(join(folder, "browser")).filter((f) => f.endsWith(".png")).sort()).toEqual(
      ["1-1440-dark.png", "1-1440-light.png", "1-390-dark.png", "1-390-light.png", "2-1440-dark.png", "2-1440-light.png", "2-390-dark.png", "2-390-light.png"]);
    expect(readFileSync(join(folder, "browser/1-390-dark.png"), "utf8")).toBe("PNG");
    expect(existsSync(join(folder, "tmp/views.txt"))).toBe(false);
    const argv: string[] = JSON.parse(readFileSync(argvFile, "utf8"));
    expect(argv).toContain("--remote-debugging-pipe");
    expect(argv).not.toContain("--no-sandbox");
  }, 30_000);

  test("a CDP failure on one view is written for that view and the others go on", async () => {
    const { runReview2 } = await import("./review2.ts");
    writeFileSync(join(base, "chrome-fail"), FAKE_CHROME(join(base, "argv-fail")), { mode: 0o755 });
    process.env.ALEPH_REVIEW2_CHROME = join(base, "chrome-fail");
    const folder = held("ui-fail");
    process.env.ALEPH_REVIEW2_CMD = fakeReviewer(["http://127.0.0.1:4100/fail", "http://127.0.0.1:4100/status"]);
    await runReview2(folder);
    const report = readFileSync(join(folder, "browser/report.md"), "utf8");
    const [first, second] = report.split("## 2.");
    expect(first).toContain("CDP failed: Cannot find context");
    expect(second).toContain("overflow: 412 > 390");
    expect(second).toContain("overflow: none");
  }, 30_000);

  test("when Chrome's sandbox cannot start, the report says so with the log tail and the review goes on", async () => {
    const { runReview2 } = await import("./review2.ts");
    const { SANDBOX_ERROR } = await import("./review2-browser.ts");
    writeFileSync(join(base, "chrome-nosandbox"), `#!/bin/bash\necho "[1:1:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! Update your kernel" >&2\nexit 1\n`, { mode: 0o755 });
    process.env.ALEPH_REVIEW2_CHROME = join(base, "chrome-nosandbox");
    const folder = held("ui-nosandbox");
    process.env.ALEPH_REVIEW2_CMD = fakeReviewer(["http://127.0.0.1:4100/status"]);
    await runReview2(folder);
    const report = readFileSync(join(folder, "browser/report.md"), "utf8");
    expect(report).toContain(SANDBOX_ERROR);
    expect(report).toContain("No usable sandbox!");
    expect(readdirSync(join(folder, "browser")).some((f) => f.endsWith(".png"))).toBe(false);
    expect(readFileSync(join(folder, "review2.md"), "utf8")).toContain("VERDICT: land");
  }, 30_000);
});
