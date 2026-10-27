import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOKS = import.meta.dir;
const OPTIONS = ["code_edit", "debug", "research", "writing", "planning", "ops", "chat", "other"];

describe("obs hook task type", () => {
  let langfuse: ReturnType<typeof Bun.serve>;
  let jev: ReturnType<typeof Bun.serve>;
  let dir: string;
  let posted: any[] = [];
  let asked: any[] = [];
  let reply: { status: number; body: unknown };
  let n = 0;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aleph-tasktype-"));
    langfuse = Bun.serve({ port: 0, fetch: async (req) => { posted.push(await req.json()); return new Response("{}"); } });
    jev = Bun.serve({ port: 0, fetch: async (req) => { asked.push(await req.json()); return Response.json(reply.body, { status: reply.status }); } });
  });
  afterAll(() => { langfuse.stop(true); jev.stop(true); rmSync(dir, { recursive: true, force: true }); });
  beforeEach(() => { posted = []; asked = []; });

  const answer = (choice: string, p: number) => ({
    status: 200,
    body: { model: "typesafe/jev-1.13", answers: { task_type: { type: "choice", choice, probabilities: { [choice]: p } } }, usage: { cost: 0 } },
  });

  async function stop(env: Record<string, string> = {}, prompt = "why does the build fail?") {
    const id = `tt${++n}`;
    const run = async (payload: Record<string, unknown>) => {
      const proc = Bun.spawn(["bun", join(HOOKS, "obs.ts")], {
        stdin: new TextEncoder().encode(JSON.stringify({ session_id: "s-tt", cwd: "/tmp/proj", prompt_id: id, ...payload })),
        env: {
          ...process.env, LANGFUSE_BASE_URL: `http://127.0.0.1:${langfuse.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk",
          ALEPH_SPOOL: dir, ALEPH_JEV_URL: `http://127.0.0.1:${jev.port}/`, OPENROUTER_API_KEY: "k-test", ALEPH_JUDGE_FILE: join(dir, "judge"), ...env,
        },
        stdout: "pipe", stderr: "pipe",
      });
      await proc.exited;
    };
    await run({ hook_event_name: "UserPromptSubmit", prompt });
    await run({ hook_event_name: "Stop", last_assistant_message: "a stale cache; cleared it" });
    const spans = posted.at(-1).resourceSpans[0].scopeSpans[0].spans;
    const turn = spans.find((s: any) => s.name === "turn");
    return (key: string) => turn.attributes.find((a: any) => a.key === key)?.value;
  }

  test("Jev gets one choice question with eight options over the prompt and final message, and its top option tags the trace", async () => {
    reply = answer("debug", 0.8);
    const attr = await stop();
    expect(asked).toHaveLength(1);
    expect(Object.keys(asked[0].questions)).toHaveLength(1);
    const q = Object.values<any>(asked[0].questions)[0];
    expect(q.type).toBe("choice");
    expect(Object.keys(q.criteria)).toEqual(OPTIONS);
    expect(asked[0].state).toEqual({ user_prompt: "why does the build fail?", final_message: "a stale cache; cleared it" });
    expect(attr("langfuse.trace.metadata.task_type")).toEqual({ stringValue: "debug" });
    expect(attr("langfuse.trace.metadata.task_type_p")?.doubleValue).toBe(0.8);
  });

  test("a Jev 500 posts the span without a task type", async () => {
    reply = { status: 500, body: { error: { message: "down" } } };
    const attr = await stop();
    expect(asked).toHaveLength(1);
    expect(attr("langfuse.observation.output")).toEqual({ stringValue: "a stale cache; cleared it" });
    expect(attr("langfuse.trace.metadata.task_type")).toBeUndefined();
    expect(attr("langfuse.trace.metadata.task_type_p")).toBeUndefined();
  });

  test("with ALEPH_JUDGE=haiku Jev is not asked and the span has no task type", async () => {
    reply = answer("debug", 0.8);
    const attr = await stop({ ALEPH_JUDGE: "haiku" });
    expect(asked).toEqual([]);
    expect(attr("langfuse.observation.output")).toEqual({ stringValue: "a stale cache; cleared it" });
    expect(attr("langfuse.trace.metadata.task_type")).toBeUndefined();
  });
});
