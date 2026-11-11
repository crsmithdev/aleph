import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, CLI, env, setup, teardown } from "./cli.helpers";

// The wiring in jobs/commands.ts of the verbs whose logic is tested in-process: always, judge, annotation, monitor and doc-claims.
beforeAll(setup);
afterAll(teardown);

describe("always", () => {
  test("grant, timeout and revoke each print the rules after the change; a bad reason or minute count exits 1", async () => {
    expect((await aleph(["always", "list"])).json).toEqual({});
    const g = await aleph(["always", "grant", "review", "land"]);
    expect(g.code).toBe(0);
    expect(g.json).toEqual({ review: { action: "land", at: expect.any(String) } });
    expect((await aleph(["always"])).json).toEqual(g.json);
    const bad = await aleph(["always", "grant", "nonsense", "land"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("unknown reason nonsense; known: ");
    expect((await aleph(["always", "timeout", "held-path", "30"])).json).toEqual({ "held-path": 30 });
    expect((await aleph(["always", "timeout"])).json).toEqual({ "held-path": 30 });
    const late = await aleph(["always", "timeout", "review", "-1"]);
    expect(late.code).toBe(1);
    expect(late.stderr).toContain("minutes must be a whole number of at least 0, not -1");
    expect((await aleph(["always", "revoke", "review"])).json).toEqual({});
  });
});

describe("judge", () => {
  // env() pins ALEPH_JUDGE, which wins over the stored choice: these runs leave it out.
  const judge = async (...args: string[]) => {
    const { ALEPH_JUDGE: _, ...rest } = env({ ALEPH_JUDGE_FILE: join(base, "judge") });
    const p = Bun.spawn(["bun", CLI, "judge", ...args], { cwd: base, env: rest, stdout: "pipe", stderr: "pipe" });
    return { code: await p.exited, out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text() };
  };

  test("prints the choice, stores a new one, and refuses a judge it does not know", async () => {
    expect(JSON.parse((await judge()).out)).toEqual({ judge: "jev" });
    expect(JSON.parse((await judge("haiku")).out)).toEqual({ judge: "haiku" });
    expect(readFileSync(join(base, "judge"), "utf8")).toBe("haiku\n");
    expect(JSON.parse((await judge()).out)).toEqual({ judge: "haiku" });
    const bad = await judge("gpt");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("usage: aleph judge");
    expect(readFileSync(join(base, "judge"), "utf8")).toBe("haiku\n");
  });
});

describe("annotation", () => {
  test("reply, reopen and drop change the stored note; a missing id or an unknown --by exits 1", async () => {
    const e = { ALEPH_ANNOTATIONS: join(base, "annotations.json") };
    const a = await aleph(["annotation", "add", "--selector", "#title", "--url", "/issues", "--", "too", "long"], e);
    expect(a.json).toMatchObject({ selector: "#title", url: "/issues", note: "too long", status: "open", by: "agent", replies: [] });
    const id = a.json.id;
    const r = await aleph(["annotation", "reply", id, "--by", "you", "-"], e, "shorter then\n");
    expect(r.json.replies).toEqual([expect.objectContaining({ text: "shorter then", by: "you" })]);
    expect((await aleph(["annotation", "resolve", id], e)).json.status).toBe("resolved");
    expect((await aleph(["annotation", "list", "--json"], e)).json).toEqual([]);
    expect((await aleph(["annotation", "reopen", id], e)).json.status).toBe("open");
    expect((await aleph(["annotation", "list", "--json", "--url", "/issues"], e)).json.map((n: any) => n.id)).toEqual([id]);
    expect((await aleph(["annotation", "list", "--json", "--url", "/jobs"], e)).json).toEqual([]);
    expect((await aleph(["annotation", "drop", id], e)).json).toEqual({ dropped: id });
    expect((await aleph(["annotation", "list", "--json", "--all"], e)).json).toEqual([]);
    const none = await aleph(["annotation", "reply"], e);
    expect([none.code, none.stderr]).toEqual([1, expect.stringContaining("usage: aleph annotation")]);
    const who = await aleph(["annotation", "list", "--by", "bot"], e);
    expect([who.code, who.stderr.trim()]).toEqual([1, "--by takes you or agent"]);
  });
});

describe("monitor", () => {
  test("--dry prints the day's table; a bad day exits 1", async () => {
    const d = await aleph(["monitor", "--dry", "--day", "2026-11-01"]);
    expect(d.code).toBe(0);
    expect(d.stdout).toStartWith("# Factory monitor 2026-11-01\n");
    expect(d.stdout).toContain("## Stages");
    const bad = await aleph(["monitor", "--dry", "--day", "yesterday"]);
    expect([bad.code, bad.stderr]).toEqual([1, expect.stringContaining("usage: aleph monitor")]);
  });
});

describe("doc-claims", () => {
  test("prints the report of this repo and exits 1 only when a claim is not backed", async () => {
    const r = await aleph(["doc-claims"]);
    const last = r.stdout.trim().split("\n").at(-1)!;
    expect(last).toMatch(/^(every checked doc claim matches the code|\d+ doc claims? the code does not back)$/);
    expect(r.code).toBe(last.startsWith("every") ? 0 : 1);
  });
});
