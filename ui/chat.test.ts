import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer } from "./server.testkit.ts";
import { kit } from "./kit.ts";

// What aleph gives the kit's chat handler (ui/chat-hooks.ts). The handler's own behaviour is tested in aleph-tools.
let base: string, at: Awaited<ReturnType<typeof withServer>>["at"], stop: () => void, restoreEnv: () => void, notes: string;

// The fake agent says its argv and the prompt back as stream-json events, then ends the turn with a `result`.
const FAKE = `#!/usr/bin/env bash
args="$*"
while IFS= read -r line; do
  prompt=$(jq -r '.message.content' <<<"$line")
  jq -cn --arg t "$prompt" --arg a "$args" '{type:"assistant",message:{content:[{type:"text",text:$t},{type:"tool_use",name:"Bash",input:{command:$a}}]}}'
  jq -cn '{type:"result",subtype:"success",is_error:false,result:"ok"}'
done
`;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-chat-"));
  notes = join(base, "annotations.json");
  writeFileSync(join(base, "claude"), FAKE);
  chmodSync(join(base, "claude"), 0o755);
  restoreEnv = withEnv({ ALEPH_CHAT_CMD: join(base, "claude"), ALEPH_ANNOTATIONS: notes });
  ({ at, stop } = await withServer({ warm: false }));
});

afterAll(() => { stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });
// Each test adds the notes it reads.
let seeded: object[] = [];
beforeEach(() => { rmSync(notes, { force: true }); seeded = []; });

/** Writes one note of the kit's v2 shape to the notes file and returns its id. */
const seed = (id: string, note: string, url: string, status = "open") => {
  seeded.push({ v: 2, id, url, selector: id, text: "", html: "", note, status, by: "you", at: "2026-11-19T00:00:00Z", replies: [] });
  writeFileSync(notes, JSON.stringify(seeded));
  return id;
};

const turn = async (body: unknown, headers: Record<string, string> = { "X-Aleph-UI": "1" }) => {
  const r = await at("/api/chat", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  const data = [...text.matchAll(/^data: (.*)$/gm)].map((m) => JSON.parse(m[1]));
  return { status: r.status, data };
};
const said = (t: Awaited<ReturnType<typeof turn>>) => t.data[0].message.content[0].text as string;
const argv = (t: Awaited<ReturnType<typeof turn>>) => t.data[0].message.content[1].input.command as string;
const kitTest = kit ? test : test.skip;

kitTest("the prompt carries the open notes of the page and not those of another page", async () => {
  seed("h1", "fix this title", "http://x/#/now");
  seed("h2", "elsewhere", "http://x/#/jobs");
  const t = await turn({ text: "hello", page: "http://x/#/now" });
  expect(said(t)).toStartWith("hello\n\nOpen annotations on this page (http://x/#/now):\n- ");
  expect(said(t)).toContain("fix this title");
  expect(said(t)).not.toContain("elsewhere");
});

kitTest("the notes a message points at come first, once, from any page and in any state", async () => {
  seed("h1", "fix this title", "http://x/#/now");
  const one = seed("p1", "this one", "http://x/#/jobs", "resolved"), two = seed("p2", "here and open", "http://x/#/now");
  const text = said(await turn({ text: "look", page: "http://x/#/now", annotations: [one, two] }));
  expect(text).toStartWith("look\n\nChris points at these annotations:\n- ");
  const [pointed, rest] = text.split("Open annotations on this page");
  expect(pointed).toContain("(resolved) on `p1`");
  expect(pointed).toContain("here and open");
  expect(rest).not.toContain("here and open");
  expect(rest).toContain("fix this title");
});

kitTest("the agent runs like a terminal session with its prompt and permission mode, and the prompt names shelf note on the notes file", async () => {
  const a = argv(await turn({ text: "hi" }));
  for (const s of ["--disable-slash-commands", "ALEPH_AGENT", "claudeMdExcludes"]) expect(a).not.toContain(s);
  expect(a).toContain("--permission-mode bypassPermissions");
  expect(a).toContain("--input-format stream-json");
  expect(a).toContain(`shelf note reply|resolve --file ${notes}`);
});

kitTest("a turn without the UI header is refused", async () => {
  expect((await turn({ text: "hi" }, {})).status).toBe(403);
});

test.skipIf(kit)("without aleph-tools /api/chat and /api/annotations answer 404", async () => {
  expect((await turn({ text: "hi" })).status).toBe(404);
  expect((await at("/api/annotations")).status).toBe(404);
});
