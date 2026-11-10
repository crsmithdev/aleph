import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { aleph, base, dispatched, itemsRemote, jobsDir, sh, setup, teardown } from "./cli.helpers";
import { issueAdd, issueClose, issueShow } from "./flow.testkit.ts";

// Acceptance criterion 14 at the CLI seam: `aleph issue add <repo> "<title>" --goal -` files the issue and its part `.1`
// in one store commit, with no intake, and starts the dispatch itself. The first case is the CLI test of
// `aleph issue add`; the others call the verb in-process.
beforeAll(setup);
afterAll(teardown);

const SPEC = "## Goal\n\nAdd a line.\n\n## Oracle\n\n`bun test`\n\n## Time box\n\n10 minutes\n";
const commits = () => Number(sh(base, "git", "--git-dir", itemsRemote, "rev-list", "--count", "main"));
const file = (name: string) => sh(base, "git", "--git-dir", itemsRemote, "show", `main:fac/backlog/tasks/${name}.md`);
// An issue left open is one the next dispatch runs first: the dispatch test then waits on all of them.
const dropIssue = (n: number) => issueClose("fac", n, "drop", "test over");
const intakeRuns = () => (existsSync(jobsDir) ? readdirSync(jobsDir).filter((d) => d.includes("-intake-")) : []);

describe("aleph issue add --spec -", () => {
  test("files one issue with its spec in one commit, starts no intake, and show reports the spec", async () => {
    const before = commits();
    const r = await aleph(["issue", "add", "fac", "Add a line", "--spec", "-"], {}, SPEC);
    expect(r.code, r.stderr).toBe(0);
    const n = r.json.added as number;
    expect(commits()).toBe(before + 1);
    const issue = file(`fac-${n}`);
    expect(issue).toContain("source: chris");
    expect(issue).toContain(`<!-- spec -->\n${SPEC.trim()}`);
    expect(issue).not.toMatch(/^(labels|waiting_on|goals|status):/m);
    // An intake would run as a detached `aleph intake`: wait until none is alive, then look for its run.
    await dispatched();
    expect(intakeRuns()).toEqual([]);
    const shown = await aleph(["issue", "show", "fac", String(n), "--json"]);
    expect(shown.json).toMatchObject({ source: "chris", areas: [] });
    expect(shown.json.spec).toContain("## Oracle");
    await dropIssue(n);
  });

  test("--request - reads the request from stdin and leaves the title alone", async () => {
    const r = await issueAdd("fac", "a plain title", { request: "The request text.\n".trim() }, { ALEPH_DISPATCH: "off" });
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.title).toBe("a plain title");
    expect((await issueShow("fac", r.json.added)).json.request).toContain("The request text.");
    await dropIssue(r.json.added);
  });

  test("--after takes a plain or a dotted ref; an absent id is refused and writes nothing", async () => {
    const first = (await issueAdd("fac", "First", { spec: SPEC.trim() })).json.added;
    const before = commits();
    const r = await issueAdd("fac", "Second", { spec: SPEC.trim(), after: [`fac-${first}`] });
    expect(r.code, r.stderr).toBe(0);
    expect(file(`fac-${r.json.added}`)).toContain(`after: [fac-${first}]`);
    expect(commits()).toBe(before + 1);
    expect((await issueAdd("fac", "Fourth", { spec: SPEC.trim(), after: ["fac-9999.1"] })).code).toBe(1);
    expect(commits()).toBe(before + 1);
    await dropIssue(first);
    await dropIssue(r.json.added);
  });
});
