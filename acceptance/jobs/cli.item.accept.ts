// Archived goal tests from jobs/cli.item.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as verbs from "../../todo/lib/issues.ts";
import { aleph, base, env, itemsRemote, job, sh, specFile, state, setup, teardown } from "../../jobs/cli.helpers";

// The issue verbs run in this process; the store reads its paths from the environment, as the child's `env()` sets them.
const STORE_KEYS = ["ALEPH_ISSUES", "ALEPH_REPOS", "ALEPH_DISPATCH"];
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  setup();
  const e = env();
  for (const k of STORE_KEYS) { saved[k] = process.env[k]; process.env[k] = e[k]; }
});
afterAll(() => {
  for (const k of STORE_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  teardown();
});

const add = async (key: string, title: string, fields: verbs.Fields = {}) => (await verbs.add({ key }, title, fields)).result.added;

describe("a job tied to a to-do item", () => {
  const list = () => sh(base, "git", "--git-dir", itemsRemote, "rev-parse", "main");
  beforeAll(async () => {
    await add("demo", "ship the widget");
    await add("demo", "paint the shed");
  });

  test("--on takes the repo-prefixed form, and refuses another repo's prefix", async () => {
    const id = await add("demo", "prefixed");
    const j = await aleph(["job", "demo", "prefixed", "--spec", specFile("Goal: prefixed\nACTION: commit prefixed.txt\n"), "--on", `demo-${id}`]);
    expect(j.code).toBe(0);
    expect(state(j.json.run).on).toBe(`demo-${id}`);
    const bad = await aleph(["job", "demo", "otherrepo", "--spec", specFile("x"), "--on", `other-${id}`]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("--on takes an issue number");
  });

  test("a job without --on records none and leaves the list alone", async () => {
    const before = list();
    const j = await job("plainjob", "commit plainjob.txt");
    expect(state(j.json.run).on).toBeUndefined();
    const r = await aleph(["land", "plainjob"]);
    expect(state(r.json.run)).toMatchObject({ condition: "landed" });
    expect(state(r.json.run).on).toBeUndefined();
    expect(list()).toBe(before);
  });
});
