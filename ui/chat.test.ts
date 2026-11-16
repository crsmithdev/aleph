import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer } from "./server.testkit.ts";
import { add, mark } from "../lib/annotations.ts";

let base: string, at: Awaited<ReturnType<typeof withServer>>["at"], stop: () => void, restoreEnv: () => void;

// The fake agent is a long-lived process, as `claude -p --input-format stream-json` is: for each user line on stdin it says
// its argv and the prompt back as stream-json events and ends the turn with a `result` whose text is its pid. A prompt that
// starts with `slow` waits for the fifo in `FAKE_GATE`, and one that starts with `die` ends the process with no result.
const FAKE = `#!/usr/bin/env bash
args="$*"
for a in "$@"; do [[ $prev == --session-id || $prev == --resume ]] && sid=$a; prev=$a; done
while IFS= read -r line; do
  prompt=$(jq -r '.message.content' <<<"$line")
  [[ $prompt == die* ]] && exit 3
  [[ $prompt == slow* ]] && read -r _ < "$FAKE_GATE"
  jq -cn --arg s "$sid" '{type:"system",subtype:"init",session_id:$s}'
  jq -cn --arg t "$prompt" --arg a "$args" --arg s "$sid" '{type:"assistant",session_id:$s,message:{content:[{type:"text",text:$t},{type:"tool_use",name:"Bash",input:{command:$a}}]}}'
  jq -cn --arg s "$sid" --arg p "$$" '{type:"result",subtype:"success",is_error:false,result:$p,session_id:$s,total_cost_usd:0.25}'
done
`;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-chat-"));
  writeFileSync(join(base, "claude"), FAKE);
  chmodSync(join(base, "claude"), 0o755);
  restoreEnv = withEnv({ ALEPH_CHAT_CMD: join(base, "claude"), FAKE_GATE: join(base, "gate"), ALEPH_SESSIONS_DIR: join(base, "sessions"), ALEPH_ANNOTATIONS: join(base, "annotations.json"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_ITEMS: join(base, "issues") });
  mkdirSync(join(base, "issues", "ideas", "1"), { recursive: true });
  writeFileSync(join(base, "issues", "ideas", "1", "idea.md"), "---\ntitle: Issue history\nstatus: exploring\n---\nx\n");
  Bun.spawnSync(["mkfifo", join(base, "gate")]);
  ({ at, stop } = await withServer({ warm: false }));
});

afterAll(() => { stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });
// Each test adds the notes it reads.
beforeEach(() => rmSync(join(base, "annotations.json"), { force: true }));

const turn = async (body: unknown) => {
  const r = await at("/api/chat", { method: "POST", headers: { "X-Aleph-UI": "1", "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  const data = [...text.matchAll(/^data: (.*)$/gm)].map((m) => JSON.parse(m[1]));
  return { status: r.status, text, data };
};
/** The pid that answered the turn, and its session. */
const who = (t: Awaited<ReturnType<typeof turn>>) => { const r = t.data.find((e) => e.type === "result"); return { pid: Number(r.result), session: r.session_id as string }; };
const argv = (t: Awaited<ReturnType<typeof turn>>) => t.data[1].message.content[1].input.command as string;
/** Waits for the process `pid` to end, with no timer: `tail` returns when it does. */
const ended = (pid: number) => Bun.spawn(["tail", `--pid=${pid}`, "-f", "/dev/null"]).exited;

test("a turn with no session starts a conversation: it streams the agent's events up to the result, then ends", async () => {
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
  // The server names the new session, and the stream says it.
  expect(argv(t)).toMatch(/--session-id [0-9a-f-]{36}/);
  expect(argv(t)).not.toContain("--resume");
  expect(t.text).toMatch(/event: end\ndata: \{\}\n\n$/);
});

test("the notes a message points at come first, once, from any page and in any state", async () => {
  add("h1", "fix this title", { url: "http://x/#/now" });
  const one = mark(add("p1", "this one", { url: "http://x/#/jobs" }).id, "resolved"), two = add("p2", "here and open", { url: "http://x/#/now" });
  const said = (await turn({ text: "look", page: "http://x/#/now", annotations: [one.id, two.id] })).data[1].message.content[0].text as string;
  expect(said).toStartWith("look\n\nChris points at these annotations:\n- ");
  const [pointed, rest] = said.split("Open annotations on this page");
  expect(pointed).toContain("(resolved) on `p1`");
  expect(pointed).toContain("here and open");
  // The pointed note of this page is not listed twice; the page's other open note still comes.
  expect(rest).not.toContain("here and open");
  expect(rest).toContain("fix this title");
});

test("the turns of one session go to one process, with the session the first turn named", async () => {
  const first = who(await turn({ text: "first" }));
  const second = await turn({ text: "second", session: first.session });
  expect(who(second)).toEqual(first);
  // The process has its argv from the first turn: a second turn on the open process does not resume.
  expect(argv(second)).toContain(`--session-id ${first.session}`);
  expect(who(await turn({ text: "other" })).pid).not.toBe(first.pid);
});

test("a turn makes the folder of its session, and a refused turn makes none", async () => {
  const { session } = who(await turn({ text: "hello" }));
  expect(existsSync(join(base, "sessions", session))).toBe(true);
  expect((await turn({ text: "", session: "refused" })).status).toBe(400);
  expect(existsSync(join(base, "sessions", "refused"))).toBe(false);
});

test("after the idle time the process ends, and the next turn on the session resumes it in a new process", async () => {
  const restore = withEnv({ ALEPH_CHAT_IDLE_MS: "0" });
  try {
    const first = who(await turn({ text: "first" }));
    await ended(first.pid);
    const again = await turn({ text: "again", session: first.session });
    expect(who(again).session).toBe(first.session);
    expect(who(again).pid).not.toBe(first.pid);
    expect(argv(again)).toContain(`--resume ${first.session}`);
  } finally { restore(); }
});

test("a turn on a session that has a turn running is refused", async () => {
  const session = who(await turn({ text: "start" })).session;
  // The response head comes when the turn is running, so the agent holds the turn at the gate.
  const slow = await at("/api/chat", { method: "POST", headers: { "X-Aleph-UI": "1", "content-type": "application/json" }, body: JSON.stringify({ text: "slow", session }) });
  expect((await turn({ text: "now", session })).status).toBe(409);
  writeFileSync(join(base, "gate"), "go\n");
  expect(await slow.text()).toMatch(/event: end\ndata: \{\}/);
});

test("a process that ends before the result ends the turn with an error", async () => {
  const t = await turn({ text: "die" });
  expect(t.text).toMatch(/event: end\ndata: \{"error":"the chat agent exited/);
});

test("the chat agent runs like a terminal session: no agent settings and skills on, but its prompt and permission mode", async () => {
  const a = argv(await turn({ text: "hi" }));
  for (const s of ["--disable-slash-commands", "ALEPH_AGENT", "claudeMdExcludes"]) expect(a).not.toContain(s);
  expect(a).toContain("--append-system-prompt");
  expect(a).toContain("--permission-mode bypassPermissions");
  expect(a).toContain("--input-format stream-json");
});

test("an empty text is refused", async () => {
  expect((await turn({ text: " " })).status).toBe(400);
});

test("a turn on an idea gets its path, the idea commands and the build steps; an unknown idea is refused", async () => {
  const prompt = (t: Awaited<ReturnType<typeof turn>>) => t.data[1].message.content[0].text as string;
  const on = prompt(await turn({ text: "build it", idea: "1" }));
  expect(on).toContain(join(base, "issues", "ideas", "1", "idea.md"));
  expect(on).toContain("aleph idea built 1");
  expect(on).toMatch(/aleph issue add.*--after/);
  expect(on).toContain("File nothing before Chris says yes");
  const off = prompt(await turn({ text: "hi" }));
  for (const s of ["idea.md", "aleph idea built", "--after", "File nothing"]) expect(off).not.toContain(s);
  expect((await turn({ text: "hi", idea: "99" })).status).toBe(400);
});

test("a pasted image is saved in the session's folder and the prompt names its path; a bad one is refused", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const t = await turn({ text: "see", images: [{ name: "pasted.png", data: png.toString("base64") }] });
  const said = t.data[1].message.content[0].text as string;
  const path = /^- (.*\.png)$/m.exec(said)?.[1];
  expect(said).toContain("Chris attached these screenshots");
  expect(path).toStartWith(join(base, "sessions", who(t).session, "images"));
  expect(path && readFileSync(path)).toEqual(png);
  expect((await turn({ text: "see", images: [{ name: "x.exe", data: "AA==" }] })).status).toBe(400);
});

test("a throw while the prompt is built answers an error and starts no process", async () => {
  writeFileSync(join(base, "annotations.json"), "{ not json");
  const t = await turn({ text: "hello", page: "http://x/#/now" });
  expect(t.status).toBe(500);
});
