import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "voice-reminder.ts");

async function run(env: Record<string, string> = {}) {
  const p = Bun.spawn(["bun", HOOK], {
    stdin: new Blob([JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hello" })]),
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, ALEPH_AGENT: "", ...env },
  });
  const out = await new Response(p.stdout).text();
  return { out, code: await p.exited };
}

test("a normal prompt gets the reminder as additionalContext", async () => {
  const r = await run();
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out)).toEqual({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: readFileSync(join(import.meta.dir, "..", "identity", "voice-reminder.md"), "utf8").trim(),
    },
  });
});

test("a factory agent gets nothing", async () => {
  expect(await run({ ALEPH_AGENT: "1" })).toEqual({ out: "", code: 0 });
});
