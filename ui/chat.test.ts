import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer } from "./test-server.ts";
import { add } from "../lib/annotations.ts";
import { allRuns } from "../jobs/lib/records/ledger.ts";

let base: string, at: Awaited<ReturnType<typeof withServer>>["at"], stop: () => void, restoreEnv: () => void;

// The fake agent says its argv and its prompt back as stream-json, as `claude -p --output-format stream-json` does.
const FAKE = `#!/usr/bin/env bash
prompt=$(cat)
args="$*"
echo '{"type":"system","subtype":"init","session_id":"s1"}'
jq -cn --arg t "$prompt" --arg a "$args" '{type:"assistant",session_id:"s1",message:{content:[{type:"text",text:$t},{type:"tool_use",name:"Bash",input:{command:$a}}]}}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s1","total_cost_usd":0.25}'
`;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-chat-"));
  writeFileSync(join(base, "claude"), FAKE);
  chmodSync(join(base, "claude"), 0o755);
  restoreEnv = withEnv({ ALEPH_CHAT_CMD: join(base, "claude"), ALEPH_ANNOTATIONS: join(base, "annotations.json"), ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_ISSUES: join(base, "issues") });
  ({ at, stop } = await withServer({ warm: false }));
});

afterAll(() => { stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });

const turn = async (body: unknown) => {
  const r = await at("/api/chat", { method: "POST", headers: { "X-Aleph-UI": "1", "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  const data = [...text.matchAll(/^data: (.*)$/gm)].map((m) => JSON.parse(m[1]));
  return { status: r.status, text, data };
};

test("a turn streams the agent's events, ends, and is a chat run with its cost", async () => {
  add("h1", "fix this title", { url: "http://x/#/now" });
  add("h2", "elsewhere", { url: "http://x/#/jobs" });
  const t = await turn({ text: "hello", page: "http://x/#/now" });
  expect(t.status).toBe(200);
  expect(t.data.map((e) => e.type)).toEqual(["system", "assistant", "result", undefined]);
  const said = t.data[1].message.content;
  // The prompt carries the open note of the page and not the other page's.
  expect(said[0].text).toStartWith("hello\n\nOpen annotations on this page (http://x/#/now):\n- ");
  expect(said[0].text).toContain("fix this title");
  expect(said[0].text).not.toContain("elsewhere");
  expect(said[1].input.command).not.toContain("--resume");
  expect(t.text).toMatch(/event: end\ndata: \{\}\n\n$/);
  const runs = allRuns().filter((e) => e.run.kind === "chat");
  expect(runs.map((e) => [e.run.condition, e.run.cost])).toEqual([["done", 0.25]]);
});

test("a session resumes the conversation", async () => {
  const t = await turn({ text: "again", session: "s1" });
  expect(t.data[1].message.content[1].input.command).toContain("--resume s1");
});

test("an empty text is refused", async () => {
  expect((await turn({ text: " " })).status).toBe(400);
});
