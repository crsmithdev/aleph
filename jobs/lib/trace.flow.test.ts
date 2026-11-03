import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { file, lf, lfPosts, resetLf, setLfStatus, state, setup, teardown } from "../cli.helpers";
import { actionJob } from "../inproc.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own and posts the trace.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}) => actionJob(name, action, extra, "fac");

  describe("its Langfuse trace", () => {
    const langfuse = () => ({ LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });
    const spans = () => lfPosts.flatMap((p) => p.resourceSpans.flatMap((r: any) => r.scopeSpans.flatMap((x: any) => x.spans)));
    beforeEach(resetLf);

    test("one trace is posted, its session id the job id", async () => {
      const r = await fjob("ftrace", "commit ftrace.txt", langfuse());
      expect(state(r.json.run).condition).toBe("passed");
      const all = spans();
      expect(all.length).toBeGreaterThan(0);
      const root = all.find((s: any) => !s.parentSpanId);
      expect(root.name).toBe("worker");
      expect(new Set(all.map((s: any) => s.traceId)).size).toBe(1);
      const a = (k: string) => root.attributes.find((x: any) => x.key === k)?.value.stringValue;
      expect(a("langfuse.session.id")).toBe(state(r.json.run).job);
      expect(a("langfuse.trace.name")).toBe("factory ftrace");
      expect(a("langfuse.trace.metadata.state")).toBe("passed");
    });

    test("with Langfuse answering 500 the verdict is unchanged and one line is logged", async () => {
      setLfStatus(500);
      const r = await fjob("ftrace500", "commit ftrace500.txt", langfuse());
      expect(state(r.json.run).condition).toBe("passed");
      expect(file(r.json.run, "trace.log").trim().split("\n").length).toBe(1);
    });

    test("with no Langfuse config nothing is posted", async () => {
      await fjob("ftracenone", "commit ftracenone.txt");
      expect(lfPosts).toEqual([]);
    });
  });
});
