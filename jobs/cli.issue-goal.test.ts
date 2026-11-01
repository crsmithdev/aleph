import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, itemsRemote, jobsDir, sh, startScript, setup, teardown, until } from "./cli.helpers";

// Acceptance criterion 14 at the CLI seam: `aleph issue add <repo> "<title>" --goal -` files the issue and its goal `.1`
// in one store commit, with no triage, and starts the dispatch itself.
beforeAll(setup);
afterAll(teardown);

const GOAL = "## Goal\n\nAdd a line.\n\n## Oracle\n\n`bun test`\n\n## Time box\n\n10 minutes\n";
const commits = () => Number(sh(base, "git", "--git-dir", itemsRemote, "rev-list", "--count", "main"));
const file = (name: string) => sh(base, "git", "--git-dir", itemsRemote, "show", `main:fac/backlog/tasks/${name}.md`);
// A goal left open is one the next dispatch runs first: the dispatch test then waits on all of them.
const dropIssue = (n: number) => aleph(["issue", "drop", "fac", String(n), "test over"]);
const triageRuns = () => (existsSync(jobsDir) ? readdirSync(jobsDir).filter((d) => d.endsWith("-triage")) : []);

describe("aleph issue add --spec -", () => {
  test("files one issue with its spec in one commit, starts no triage, and show reports the spec", async () => {
    const before = commits();
    const r = await aleph(["issue", "add", "fac", "Add a line", "--spec", "-"], {}, GOAL);
    expect(r.code, r.stderr).toBe(0);
    const n = r.json.added as number;
    expect(commits()).toBe(before + 1);
    const issue = file(`fac-${n}`);
    expect(issue).toContain("source: chris");
    expect(issue).toContain(`<!-- spec -->\n${GOAL.trim()}`);
    expect(issue).not.toMatch(/^(labels|waiting_on|kind|goals|status):/m);
    await Bun.sleep(500);
    expect(triageRuns()).toEqual([]);
    const shown = await aleph(["issue", "show", "fac", String(n), "--json"]);
    expect(shown.json).toMatchObject({ source: "chris", areas: [] });
    expect(shown.json.spec).toContain("## Oracle");
    await dropIssue(n);
  });

  test("--request - reads the request from stdin and leaves the title alone", async () => {
    const r = await aleph(["issue", "add", "fac", "a plain title", "--request", "-"], { ALEPH_DISPATCH: "off" }, "The request text.\n");
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.title).toBe("a plain title");
    expect((await aleph(["issue", "show", "fac", String(r.json.added), "--json"])).json.request).toContain("The request text.");
    await aleph(["issue", "drop", "fac", String(r.json.added), "test over"]);
  });

  test("--after takes a plain or a dotted ref; an absent id is refused and writes nothing", async () => {
    const first = (await aleph(["issue", "add", "fac", "First", "--spec", "-"], {}, GOAL)).json.added;
    const before = commits();
    const r = await aleph(["issue", "add", "fac", "Second", "--spec", "-", "--after", `fac-${first}`], {}, GOAL);
    expect(r.code, r.stderr).toBe(0);
    expect(file(`fac-${r.json.added}`)).toContain(`after: [fac-${first}]`);
    expect(commits()).toBe(before + 1);
    expect((await aleph(["issue", "add", "fac", "Fourth", "--spec", "-", "--after", "fac-9999.1"], {}, GOAL)).code).toBe(1);
    expect(commits()).toBe(before + 1);
    await dropIssue(first);
    await dropIssue(r.json.added);
  });

  test("it starts the dispatch itself: no explicit `aleph dispatch` follows", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const startLog = join(base, "issue-goal-start.log"), startCmd = join(base, "issue-goal-start-cmd"), gate = join(base, "issue-goal-gate");
    rmSync(startLog, { force: true });
    startScript(startCmd, jobsDir);
    const on = { ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog };
    const r = await aleph(["issue", "add", "fac", "Starts at once", "--spec", "-"], on, `ACTION: hold ${gate}\n`);
    expect(r.code, r.stderr).toBe(0);
    await until(() => existsSync(startLog) && readFileSync(startLog, "utf8").includes(`fac-${r.json.added}`));
    expect(readFileSync(startLog, "utf8").trim().split("\n")).toContain(`fac-${r.json.added}`);
    // Release the hold, and close the issue so later dispatches leave it alone.
    writeFileSync(gate, "");
    await until(() => readdirSync(jobsDir).filter((d) => d.includes(`-fac-fac-${r.json.added}-`)).every((d) => { try { return JSON.parse(readFileSync(join(jobsDir, d, "state.json"), "utf8")).condition !== "running"; } catch { return false; } }));
    await aleph(["issue", "drop", "fac", String(r.json.added), "test over"]);
  }, 60_000);
});

describe("the writers of the new shape", () => {

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
