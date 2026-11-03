// Archived goal tests from jobs/lib/factory-dispatch.spec-check.test.ts: `bun run accept` runs them, `bun run test` does not.
// The dispatch and the spec check before a goal starts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeList } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { dispatchIssues } from "../../../jobs/lib/factory.ts";
import { readHolds } from "../../../jobs/lib/factory-status.ts";
import { loadRegistry } from "../../../jobs/lib/ledger.ts";
import { decide, edit } from "../../../todo/lib/issues.ts";
import { planDetached } from "../../../jobs/lib/launch.ts";
import { runSpecCheck } from "../../../jobs/lib/spec-check.ts";
import { ctx, fakes, ask, setup, teardown } from "../../../jobs/lib/factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

describe("the spec check before a goal starts", () => {
  const authored = () => writeFileSync(join(ctx.base, "repos.json"), JSON.stringify({ fac: { path: join(ctx.base, "repo"), sandbox: true, autoland: false, author: true } }));
  const SPEC = "## Goal\nEnd state one.\n\n## Edit surface\n- a.ts\n\n## Oracle\nORACLE-TEXT\n";
  const specGoal = () => writeList({ key: "fac" }, "add a goal", (doc) => issues.add(doc, "checked goal", { spec: SPEC }).id, true)!.value;
  // A fake spec check: one line per call in spec.calls, the input in spec.in, the reply with a cost of 0.5.
  const fakeSpec = (reply: string) => {
    const f = join(ctx.base, "spec.sh");
    writeFileSync(f, `#!/bin/sh\ncat >> ${ctx.base}/spec.in\necho call >> ${ctx.base}/spec.calls\ncat <<'EOF'\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: reply, total_cost_usd: 0.5 })}\nEOF\n`);
    chmodSync(f, 0o755);
    process.env.ALEPH_SPECCHECK_CMD = f;
  };
  const calls = () => (existsSync(join(ctx.base, "spec.calls")) ? readFileSync(join(ctx.base, "spec.calls"), "utf8").trim().split("\n").length : 0);
  const repo = () => loadRegistry().fac;
  // The dispatch with a fake start and a fake launch port, which records each detached spec check it is asked to start.
  const run = async () => {
    const f = fakes();
    const launched: string[] = [];
    const out = await dispatchIssues(f.start, async () => null, f.land, f.rescue, undefined, planDetached, (r, ref) => { launched.push(`${r.key}-${ref}`); }, () => {});
    return { out, calls: f.calls, launched };
  };
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.ALEPH_SPECCHECK_CMD; authored(); });
  afterEach(() => { if (saved === undefined) delete process.env.ALEPH_SPECCHECK_CMD; else process.env.ALEPH_SPECCHECK_CMD = saved; });

  test("after a spec edit and a rerun, a pass starts the goal once its check ends; the fake ran once for each version", async () => {
    fakeSpec("VERDICT: hold vague");
    const id = specGoal();
    const name = `fac-${id}`;
    await runSpecCheck(repo(), id);
    expect(ask(id)).toMatchObject({ reason: "spec-check" });
    // Chris edits the spec and answers rerun: the Ask goes.
    edit({ key: "fac" }, id, { spec: SPEC.replace("End state one.", "Edited end state NEWSPEC.") });
    decide({ key: "fac" }, id, "rerun");
    fakeSpec("VERDICT: pass");
    const a = await run();
    expect(a.calls).toEqual([]);
    expect(a.launched).toEqual([name]);
    expect(await runSpecCheck(repo(), id)).toMatchObject({ verdict: "pass" });
    expect(readFileSync(join(ctx.base, "spec.in"), "utf8")).toContain("NEWSPEC");
    const b = await run();
    expect(b.launched).toEqual([]);
    expect(b.calls).toEqual([`start ${name}`]);
    expect(readHolds([name]).at(-1)).toMatchObject({ kind: "started" });
    expect(calls()).toBe(2);
  }, 30_000);
});
