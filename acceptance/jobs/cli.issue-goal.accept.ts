// Archived goal tests from jobs/cli.issue-goal.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, itemsRemote, jobsDir, sh, startScript, setup, teardown, until } from "../../jobs/cli.helpers";

// Acceptance criterion 14 at the CLI seam: `aleph issue add <repo> "<title>" --goal -` files the issue and its goal `.1`
// in one store commit, with no triage, and starts the dispatch itself.
beforeAll(setup);
afterAll(teardown);
const file = (name: string) => sh(base, "git", "--git-dir", itemsRemote, "show", `main:fac/backlog/tasks/${name}.md`);

describe("aleph issue add --spec -", () => {

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
});
