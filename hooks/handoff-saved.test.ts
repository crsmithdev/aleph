import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "handoff-saved.ts");
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aleph-saved-"));
  mkdirSync(join(root, "projects"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(file_path: string, env: Record<string, string | undefined> = {}) {
  const r = Bun.spawnSync(["bun", HOOK], {
    stdin: Buffer.from(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path } })),
    env: { ...process.env, ALEPH_HANDOFFS_DIR: root, HERDR_ENV: undefined, HERDR_PANE_ID: undefined, HC_RUNTIME: undefined, HC_TERMINAL_ID: undefined, ...env },
    stdout: "pipe", stderr: "pipe",
  });
  expect(r.exitCode).toBe(0);
  return r.stdout.toString().trim();
}

test("a project handoff ends the turn and names the path and /clear", () => {
  const path = join(root, "projects", "proj.md");
  const out = JSON.parse(run(path));
  expect(out.continue).toBe(false);
  expect(out.stopReason).toContain("Handoff saved to");
  expect(out.stopReason).toContain(path);
  expect(out.stopReason).toContain("/clear");
});

test("a named handoff and a path outside the folder print nothing", () => {
  expect(run(join(root, "sidetone.md"))).toBe("");
  expect(run(join(tmpdir(), "projects", "proj.md"))).toBe("");
});

test("hooks.json runs the hook after a Write", () => {
  const hooks = JSON.parse(readFileSync(join(import.meta.dir, "hooks.json"), "utf8")).hooks.PostToolUse;
  const entry = hooks.find((h: any) => h.matcher === "Write");
  expect(JSON.stringify(entry)).toContain("hooks/handoff-saved.ts");
});

test("a pane's handoff in the repo's folder ends the turn, a deeper file prints nothing", () => {
  const path = join(root, "projects", "proj", "p7.md");
  const out = JSON.parse(run(path));
  expect(out.continue).toBe(false);
  expect(out.stopReason).toContain(path);
  expect(run(join(root, "projects", "proj", "sub", "x.md"))).toBe("");
});

describe("the clear and pickup cycle", () => {
  // The fake herdr logs each call, holds `agent wait` until the test opens the gate fifo, and
  // signals the done fifo after the last prompt, so the test waits on events and not on timers.
  const fake = () => {
    mkdirSync(join(root, "bin"));
    for (const f of ["gate", "done"]) Bun.spawnSync(["mkfifo", join(root, f)]);
    writeFileSync(join(root, "bin", "herdr"), `#!/bin/sh\necho "$@" >> "${root}/log"\n[ "$2" = wait ] && cat "${root}/gate" > /dev/null\ncase "$4" in /aleph:pickup*) echo > "${root}/done";; esac\nexit 0\n`, { mode: 0o755 });
    return { HERDR_ENV: "1", HERDR_PANE_ID: "p7", PATH: `${join(root, "bin")}:${process.env.PATH}` };
  };
  const log = () => (existsSync(join(root, "log")) ? readFileSync(join(root, "log"), "utf8") : "");

  test("this pane's handoff clears and picks up after the hook exits even with HC_TERMINAL_ID set, and outside Herdr no process starts", async () => {
    const env = { ...fake(), HC_TERMINAL_ID: "t12" };
    writeFileSync(join(root, "bin", "hc"), `#!/bin/sh\necho "hc $@" >> "${root}/log"\n`, { mode: 0o755 });
    const plain = join(root, "projects", "proj.md");
    const stop = JSON.parse(run(plain, { ...env, HERDR_ENV: undefined })).stopReason;
    expect(stop).toContain("Run /clear");
    expect(stop).toContain(plain);
    expect(log()).toBe("");
    const path = join(root, "projects", "proj", "p7.md");
    mkdirSync(join(root, "projects", "proj"));
    writeFileSync(path, "# Handoff\n\n## Intent\n\nFix the gauge\n");
    const out = JSON.parse(run(path, env));
    expect(out.continue).toBe(false);
    expect(out.stopReason).toContain("on its own");
    expect(out.stopReason).toContain("do not run /clear");
    expect(log()).not.toContain("/clear");
    await Bun.spawn(["sh", "-c", `echo go > ${join(root, "gate")}`]).exited;
    await Bun.file(join(root, "done")).text();
    expect(log().trim().split("\n")).toEqual(["agent wait p7 --until idle --until done", "agent prompt p7 /clear --wait", "agent prompt p7 /rename Fix the gauge --wait", `agent prompt p7 /aleph:pickup ${path} --wait`]);
  });

  test("in the desktop app this terminal's hc file runs the hc cycle, and another terminal's file or the flat file starts nothing", async () => {
    mkdirSync(join(root, "bin"));
    Bun.spawnSync(["mkfifo", join(root, "done")]);
    writeFileSync(join(root, "bin", "hc"), `#!/bin/sh\necho "$@" >> "${root}/log"\n[ "$1" = send ] && echo "\${HC_TERMINAL_ID-unset}" >> "${root}/ids"\ncase "$3" in /aleph:pickup*) echo > "${root}/done";; esac\nexit 0\n`, { mode: 0o755 });
    const env = { HC_TERMINAL_ID: "t12", PATH: `${join(root, "bin")}:${process.env.PATH}` };
    for (const path of [join(root, "projects", "proj.md"), join(root, "projects", "proj", "hc-t99.md")]) {
      expect(JSON.parse(run(path, env)).stopReason).toContain("Run /clear");
    }
    expect(log()).toBe("");
    const path = join(root, "projects", "proj", "hc-t12.md");
    mkdirSync(join(root, "projects", "proj"));
    writeFileSync(path, "# Handoff\n\n## Intent\n\nFix the gauge\n");
    const out = JSON.parse(run(path, env));
    expect(out.stopReason).toContain("on its own");
    expect(out.stopReason).toContain("do not run /clear");
    await Bun.file(join(root, "done")).text();
    expect(log().trim().split("\n")).toEqual(["wait t12", "send t12 /clear", "wait t12", "send t12 /rename Fix the gauge", "wait t12", `send t12 /aleph:pickup ${path}`]);
    expect(readFileSync(join(root, "ids"), "utf8").trim().split("\n")).toEqual(["unset", "unset", "unset"]);
  });
});
