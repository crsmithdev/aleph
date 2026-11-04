// The dispatch and the spec check before a goal starts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { dispatchIssues } from "./factory.ts";
import { readHolds, runsToday, spentToday } from "./factory-status.ts";
import { loadRegistry, lock } from "./ledger.ts";
import { planDetached } from "./launch.ts";
import { runSpecCheck } from "./spec-check.ts";
import { ctx, fakes, ask, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

describe("the spec check before a goal starts", () => {
  const authored = () => writeFileSync(join(ctx.base, "repos.json"), JSON.stringify({ fac: { path: join(ctx.base, "repo"), sandbox: true, autoland: false, author: true } }));
  const SPEC = "## Goal\nEnd state one.\n\n## Edit surface\n- a.ts\n\n## Oracle\nORACLE-TEXT\n";
  const specGoal = () => writeList({ key: "fac" }, "add a goal", (doc) => issues.add(doc, "checked goal", { spec: SPEC }).id, true)!.value;
  // A fake spec check: one line per call in spec.calls, the input in spec.in, the reply with a cost of 0.5.
  const fakeSpec = (reply: object | string) => {
    const f = join(ctx.base, "spec.sh");
    writeFileSync(f, `#!/bin/sh\ncat >> ${ctx.base}/spec.in\necho call >> ${ctx.base}/spec.calls\ncat <<'EOF'\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, ...(typeof reply === "string" ? { result: reply } : { result: "", structured_output: reply }), total_cost_usd: 0.5 })}\nEOF\n`);
    chmodSync(f, 0o755);
    process.env.ALEPH_SPECCHECK_CMD = f;
  };
  const calls = () => (existsSync(join(ctx.base, "spec.calls")) ? readFileSync(join(ctx.base, "spec.calls"), "utf8").trim().split("\n").length : 0);
  const repo = () => loadRegistry().fac;
  // The dispatch with a fake start and a fake launch port, which records each detached spec check it is asked to start.
  const run = async () => {
    const f = fakes();
    const launched: string[] = [];
    const out = await dispatchIssues(f.start, f.land, f.rescue, undefined, planDetached, (r, ref) => { launched.push(`${r.key}-${ref}`); });
    return { out, calls: f.calls, launched };
  };
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.ALEPH_SPECCHECK_CMD; authored(); });
  afterEach(() => { if (saved === undefined) delete process.env.ALEPH_SPECCHECK_CMD; else process.env.ALEPH_SPECCHECK_CMD = saved; });

  test("with no verdict, the dispatch starts one detached check and not the goal; a second dispatch while the lock is held starts none", async () => {
    fakeSpec({ verdict: "pass", blocks: [], notes: [] });
    const id = specGoal();
    const name = `fac-${id}`;
    const a = await run();
    expect(calls()).toBe(0);
    expect(a.calls).toEqual([]);
    expect(a.launched).toEqual([name]);
    expect(a.out.skipped).toContain(`${name}: spec check running`);
    expect(readHolds([name]).at(-1)).toMatchObject({ kind: "not-ready", text: "spec check running" });
    const release = (await lock(`spec-check-${name}`, 0))!;
    try {
      const b = await run();
      expect(b.launched).toEqual([]);
      expect(b.calls).toEqual([]);
      expect(calls()).toBe(0);
      expect(readHolds([name]).at(-1)).toMatchObject({ kind: "not-ready", text: "spec check running" });
    } finally {
      release();
    }
  }, 30_000);

  test("a hold sets the Ask and the hold record, counts in the day's spend and not in its runs, and the goal is not started", async () => {
    fakeSpec({ verdict: "hold", blocks: ["the Oracle names needHead, which is outside the Edit surface"], notes: [] });
    const id = specGoal();
    const name = `fac-${id}`;
    const r = await runSpecCheck(repo(), id);
    expect(r.verdict).toBe("hold");
    expect(ask(id)).toMatchObject({ reason: "spec-check" });
    expect(readHolds([name]).at(-1)).toMatchObject({ kind: "not-ready", text: expect.stringContaining("the Oracle names needHead") });
    expect(spentToday()).toBeGreaterThanOrEqual(0.5);
    expect(runsToday()).toEqual([]);
    const d = await run();
    expect(d.calls).toEqual([]);
    expect(d.launched).toEqual([]);
    expect(readHolds([name]).at(-1)).toMatchObject({ kind: "not-ready", text: expect.stringContaining("the Oracle names needHead") });
    expect(calls()).toBe(1);
  }, 30_000);

  test("an error starts the goal, as the unit did", async () => {
    fakeSpec("no verdict line here");
    const id = specGoal();
    expect(await runSpecCheck(repo(), id)).toMatchObject({ verdict: "error" });
    const b = await run();
    expect(b.calls).toEqual([`start fac-${id}`]);
  }, 30_000);
});
