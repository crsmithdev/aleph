import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, itemsRemote, jobsDir, patchItem, sh, startScript, setup, teardown, until } from "./cli.helpers";

// Acceptance criterion 14 at the CLI seam: `aleph issue add <repo> "<title>" --goal -` files the issue and its goal `.1`
// in one store commit, with no triage, and starts the dispatch itself.
beforeAll(setup);
afterAll(teardown);

const GOAL = "## Goal\n\nAdd a line.\n\n## Oracle\n\n`bun test`\n\n## Time box\n\n10 minutes\n";
const commits = () => Number(sh(base, "git", "--git-dir", itemsRemote, "rev-list", "--count", "main"));
const file = (name: string) => sh(base, "git", "--git-dir", itemsRemote, "show", `main:fac/backlog/tasks/${name}.md`);
const triageRuns = () => (existsSync(jobsDir) ? readdirSync(jobsDir).filter((d) => d.endsWith("-triage")) : []);

describe("aleph issue add --goal -", () => {
  test("files the issue and goal .1 in one commit, starts no triage, and show reports the goal", async () => {
    const before = commits();
    const r = await aleph(["issue", "add", "fac", "Add a line", "--goal", "-"], {}, GOAL);
    expect(r.code, r.stderr).toBe(0);
    const n = r.json.added as number;
    expect(r.json.goal).toBe(`fac-${n}.1`);
    expect(commits()).toBe(before + 1);

    const issue = file(`fac-${n}`);
    expect(issue).toContain("kind: issue");
    expect(issue).toContain("source: chris");
    expect(issue).toContain(`goals: [fac-${n}.1]`);
    expect(issue).toContain(`## Request\n\n${GOAL.trim()}`);
    expect(issue).not.toMatch(/^(labels|waiting_on):/m);
    const goal = file(`fac-${n}.1`);
    expect(goal).toContain("kind: goal");
    expect(goal).toContain(`issue: fac-${n}`);
    expect(goal).toContain("after: []");
    expect(goal).toContain(GOAL.trim());
    expect(goal).not.toContain("## Request");

    await Bun.sleep(500);
    expect(triageRuns()).toEqual([]);
    const shown = await aleph(["issue", "show", "fac", String(n), "--json"]);
    expect(shown.json).toMatchObject({ kind: "issue", source: "chris", goals: [`fac-${n}.1`], areas: [] });
    expect(shown.json.body).toContain("## Request");
    const text = (await aleph(["issue", "show", "fac", String(n)])).stdout;
    expect(text).toContain(`goals ${n}.1`);
  });

  test("--after sets the goal's order; an issue id is refused and writes nothing", async () => {
    const first = (await aleph(["issue", "add", "fac", "First", "--goal", "-"], {}, GOAL)).json;
    const before = commits();
    const r = await aleph(["issue", "add", "fac", "Second", "--goal", "-", "--after", first.goal], {}, GOAL);
    expect(r.code, r.stderr).toBe(0);
    expect(file(`fac-${r.json.added}.1`)).toContain(`after: [${first.goal}]`);
    expect(commits()).toBe(before + 1);

    const bad = await aleph(["issue", "add", "fac", "Third", "--goal", "-", "--after", `fac-${first.added}`], {}, GOAL);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("is an issue");
    expect(commits()).toBe(before + 1);
    const none = await aleph(["issue", "add", "fac", "Fourth", "--goal", "-", "--after", "fac-9999.1"], {}, GOAL);
    expect(none.code).toBe(1);
    expect(commits()).toBe(before + 1);
  });

  test("a second goal gets the next number under its issue", async () => {
    const r = await aleph(["issue", "add", "fac", "Numbered", "--goal", "-"], {}, GOAL);
    expect(r.json.goal).toBe(`fac-${r.json.added}.1`);
  });

  test("it starts the dispatch itself: no explicit `aleph dispatch` follows", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const startLog = join(base, "issue-goal-start.log"), startCmd = join(base, "issue-goal-start-cmd"), gate = join(base, "issue-goal-gate");
    rmSync(startLog, { force: true });
    startScript(startCmd, jobsDir);
    const on = { ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog };
    const r = await aleph(["issue", "add", "fac", "Starts at once", "--goal", "-"], on, `ACTION: hold ${gate}\n`);
    expect(r.code, r.stderr).toBe(0);
    await until(() => existsSync(startLog) && readFileSync(startLog, "utf8").includes(`fac-${r.json.added}.1`));
    expect(readFileSync(startLog, "utf8").trim().split("\n")).toContain(`fac-${r.json.added}.1`);
    // Release the hold, and close the goal so later dispatches leave it alone.
    writeFileSync(gate, "");
    await until(() => readdirSync(jobsDir).filter((d) => d.includes(`-fac-fac-${r.json.added}.1-`)).every((d) => { try { return JSON.parse(readFileSync(join(jobsDir, d, "state.json"), "utf8")).state === "passed"; } catch { return false; } }));
    patchItem("fac", `${r.json.added}.1`, { status: "dropped" });
    await aleph(["issue", "drop", "fac", String(r.json.added), "test over"]);
  }, 60_000);
});

describe("the writers of the new shape", () => {
  test("aleph todo is gone", async () => {
    const r = await aleph(["todo", "add", "fac", "x"]);
    expect(r.code).toBe(1);
  });

  test("--labels writes areas, and never labels, waiting_on or goal", async () => {
    const r = await aleph(["issue", "add", "fac", "Audio thing", "--labels", "audio,goal,needs-chris"]);
    expect(r.code, r.stderr).toBe(0);
    const text = file(`fac-${r.json.added}`);
    expect(text).toContain("areas: [audio]");
    expect(text).not.toMatch(/^(labels|waiting_on):/m);
    expect(text).not.toMatch(/\b(goal|needs-chris)\b/);
    const shown = (await aleph(["issue", "show", "fac", String(r.json.added), "--json"])).json;
    expect(shown.areas).toEqual(["audio"]);
    expect(shown).not.toHaveProperty("labels");
    expect(shown).not.toHaveProperty("waiting_on");
    expect((await aleph(["issue", "list", "fac", "--label", "audio", "--json"])).json.map((i: any) => i.id)).toEqual([r.json.added]);
    await aleph(["issue", "drop", "fac", String(r.json.added), "test over"]);
  });

  test("--waiting-on is refused on add and edit", async () => {
    for (const args of [["add", "fac", "w", "--waiting-on", "fac-1"], ["edit", "fac", "1", "--waiting-on", "none"]]) {
      const r = await aleph(["issue", ...args]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("--waiting-on");
    }
  });
});
