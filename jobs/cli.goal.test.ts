import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderItem } from "../todo/lib/todo.ts";
import { aleph, base, items, itemsRemote, patchItem, sh, setup, teardown } from "./cli.helpers";

// `aleph goal ...` and acceptance criterion 6 at the CLI seam.
beforeAll(setup);
afterAll(teardown);

const GOAL = "## Goal\n\nAdd a line.\n\n## Oracle\n\n`bun test`\n\n## Time box\n\n10 minutes\n";
const add = async (title = "t") => (await aleph(["issue", "add", "fac", title, "--goal", "-"], { ALEPH_DISPATCH: "off" }, GOAL)).json.added as number;
const show = async (n: number) => (await aleph(["issue", "show", "fac", String(n), "--json"])).json;

describe("aleph goal drop (criterion 6)", () => {
  test("dropping the only open goal sets the part-dropped Ask, and status says awaiting", async () => {
    const n = await add();
    const r = await aleph(["goal", "drop", "fac", `${n}.1`, "not needed"]);
    expect(r.code, r.stderr).toBe(0);
    const issue = await show(n);
    expect(issue.ask).toMatchObject({ kind: "input", reason: "part-dropped", question: `Goal fac-${n}.1 was dropped: not needed. What now?` });
    expect(issue.ask.options.map((o: any) => o.label)).toEqual(["Close with what landed", "Plan the missing part"]);
    expect((await aleph(["status", `fac-${n}`])).stdout).toContain("awaiting");
  });

  test("a second open goal means no Ask", async () => {
    const n = await add();
    // Seed fac-<n>.2 by hand: a goal of the issue, listed in its goals.
    sh(items, "git", "pull", "-q", "origin", "main");
    const second = { id: n, sub: 2, title: "second", fm: { id: `${n}.2`, status: "open", created: "2026-10-30", updated: "2026-10-30", priority: "medium", kind: "goal", issue: `fac-${n}`, after: [] }, body: "Second.", notes: [], legacy: false };
    writeFileSync(join(items, "fac", "backlog", "tasks", `fac-${n}.2.md`), renderItem("fac", second as any));
    sh(items, "git", "add", "-A");
    sh(items, "git", "commit", "-qm", "seed second goal");
    sh(items, "git", "push", "-q", "origin", "main");
    patchItem("fac", n, { goals: [`fac-${n}.1`, `fac-${n}.2`] });
    const r = await aleph(["goal", "drop", "fac", `${n}.1`, "not needed"]);
    expect(r.code, r.stderr).toBe(0);
    expect((await show(n)).ask).toBeNull();
    expect((await aleph(["status", `fac-${n}`])).stdout).not.toContain("awaiting");
  });
});

describe("aleph goal verbs", () => {
  test("hidden writes under the goal id on the store's main and lists it; an issue id for --after exits 1", async () => {
    const n = await add();
    const f = join(base, "g.test.ts");
    writeFileSync(f, 'import { test } from "bun:test";\ntest("g", () => {});\n');
    const w = await aleph(["goal", "hidden", "fac", `${n}.1`, f]);
    expect(w.code, w.stderr).toBe(0);
    expect(sh(base, "git", "--git-dir", itemsRemote, "show", `main:fac/hidden/fac-${n}.1/g.test.ts`)).toContain('test("g"');
    expect((await aleph(["goal", "hidden", "fac", `${n}.1`])).stdout.trim()).toBe("g.test.ts");
    const bad = await aleph(["goal", "edit", "fac", `${n}.1`, "--after", `fac-${n}`]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("is an issue");
    expect((await aleph(["issue", "hidden", "fac", String(n)])).code).toBe(1);
  });

  test("list, show --json, note, and edit", async () => {
    const n = await add("Listed");
    const m = await add("Other");
    const list = (await aleph(["goal", "list", "fac", "--status", "open", "--json"])).json;
    expect(list.map((g: any) => g.ref)).toEqual(expect.arrayContaining([`${n}.1`, `${m}.1`]));
    expect(list.every((g: any) => g.kind === "goal")).toBe(true);
    expect((await aleph(["goal", "note", "fac", `${n}.1`, "a worker note"])).code).toBe(0);
    const e = await aleph(["goal", "edit", "fac", `${n}.1`, "--title", "Renamed", "--priority", "high", "--after", `fac-${m}.1`]);
    expect(e.code, e.stderr).toBe(0);
    const shown = (await aleph(["goal", "show", "fac", `${n}.1`, "--json"])).json;
    expect(shown).toMatchObject({ title: "Renamed", priority: "high", after: [`fac-${m}.1`] });
    expect(shown.body).toContain("## Goal");
    expect(shown.notes.join("\n")).toContain("a worker note");
    const text = (await aleph(["goal", "show", "fac", `${n}.1`])).stdout;
    expect(text).toContain(`## ${n}.1. Renamed`);
    expect(text).toContain(`issue ${n}   after ${m}.1   priority`);
    expect(text).not.toContain("fac-");
    const rows = (await aleph(["goal", "list", "fac", "--status", "open"])).stdout;
    expect(rows).toContain(`${n}.1  open    Renamed  (after ${m}.1)`);
    expect(rows).not.toContain("fac-");
    const issueText = (await aleph(["issue", "show", "fac", String(n)])).stdout;
    expect(issueText).toContain(`goals ${n}.1 `);
    expect(issueText).not.toContain("fac-");
    expect((await aleph(["goal", "edit", "fac", `${n}.1`, "--after", "none"])).code).toBe(0);
    expect((await aleph(["goal", "show", "fac", `${n}.1`, "--json"])).json.after).toEqual([]);
    expect((await aleph(["goal", "show", "fac", String(n)])).code).toBe(1);
  });
});
