import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, fakeLog, until, jobsDir, remote, sh, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];
  describe("the reviewer", () => {
    // These runs never meet review: a background review would rewrite the awaiting reason the assertions read.
    const rjob = (name: string, mark: string, action = `commit ${name}.txt`, extra: Record<string, string> = {}) =>
      aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name} ${mark}\nACTION: ${action}\n`)], { ALEPH_REVIEW_CMD: "/bin/false", ...extra });
    const calls = () => existsSync(join(fakeLog, "review-calls")) ? readFileSync(join(fakeLog, "review-calls"), "utf8").split("\n").length - 1 : 0;

    test("a pass lands; the prompt holds the item and the diff; the cost adds up", async () => {
      const r = await rjob("rpass", "REVIEW:pass");
      expect(state(r.json.run)).toMatchObject({ state: "passed", cost: 0.03 });
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      expect(p).toContain("Goal: rpass REVIEW:pass");
      expect(p).toContain("+++ b/rpass.txt");
      expect(runsLeft()).toEqual([]);
      expect(state((await aleph(["land", "rpass"])).json.run).state).toBe("landed");
    });

    test("a diff over ALEPH_REVIEW_DIFF_MAX is cut: the stat, the head of the diff, a line that says so", async () => {
      const r = await rjob("rbig", "REVIEW:pass", "commit-big rbig.txt", { ALEPH_REVIEW_DIFF_MAX: "200" });
      expect(state(r.json.run)).toMatchObject({ state: "passed" });
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      const m = p.match(/diff cut at 200 of (\d+) characters/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(200);
      expect(p).toContain("rbig.txt |");
      const body = p.slice(p.indexOf("diff --git"), p.indexOf("(diff cut at"));
      expect(body.trim().length).toBeLessThanOrEqual(200);
      expect(p).not.toContain("line 60 of the big file");
    });

    test("under the default cap the whole diff goes in and no line says it was cut", async () => {
      const r = await rjob("rwhole", "REVIEW:pass", "commit-big rwhole.txt");
      expect(state(r.json.run)).toMatchObject({ state: "passed" });
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      expect(p).toContain("line 60 of the big file");
      expect(p).not.toContain("diff cut");
    });

    const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

    test("a finding goes back to the worker as a fix round; the rerun passes", async () => {
      rmSync(join(fakeLog, "holdonce"), { force: true });
      await rjob("rback", "REVIEW:holdonce");
      const rs = runsOf("rback");
      expect(rs.map((x) => [x.state, x.failed])).toEqual([["stuck", "review"], ["passed", undefined], ["landed", undefined]]);
      expect(rs[0]).toMatchObject({ reason: "reviewer: the flag has no test", next: "worker", round: 0 });
      expect(rs[1].round).toBe(1);
      expect(readFileSync(join(fakeLog, "prompt"), "utf8")).toContain("The reviewer sent this branch back: reviewer: the flag has no test");
    }, 30_000);

    test("a finding after the last fix round needs Chris, and the row says why in one sentence", async () => {
      await rjob("rhold", "REVIEW:hold");
      const rs = runsOf("rhold");
      expect(rs.map((x) => x.state)).toEqual(["stuck", "stuck", "awaiting"]);
      expect(rs.at(-1)).toMatchObject({ ask: expect.objectContaining({ kind: "approval", reason: "review" }), reason: "the reviewer sent it back twice: tests do not cover the new flag" });
      expect(rs.at(-1).stat).toContain("rhold.txt");
      const before = remoteGit("rev-parse", "main");
      expect(before).toBe(remoteGit("rev-parse", "main"));
      expect(remoteGit("log", "-1", "--format=%s", "main")).not.toBe("add rhold.txt");
      const l = await aleph(["land", "rhold"]);
      expect(state(l.json.run)).toMatchObject({ state: "landed", held: true });
      expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain("Held-by: Chris");
    }, 30_000);

    test("a reviewer with no verdict is run again, once; its pass passes the run", async () => {
      rmSync(join(fakeLog, "noneonce"), { force: true });
      const n = calls();
      const r = await rjob("rretry", "REVIEW:noneonce");
      expect(state(r.json.run).state).toBe("passed");
      expect(runsOf("rretry").length).toBe(1);
      expect(calls() - n).toBe(2);
    }, 30_000);

    test("a second miss is a finding: with no fix rounds, no verdict line or an error result holds the run", async () => {
      const none = { ALEPH_FIX_ROUNDS: "0" };
      const n = calls();
      expect(state((await rjob("rnone", "REVIEW:none", "commit rnone.txt", none)).json.run)).toMatchObject({ state: "awaiting", ask: expect.objectContaining({ kind: "approval", reason: "review" }), reason: expect.stringMatching(/^reviewer: no verdict/) });
      expect(calls() - n).toBe(2);
      expect(state((await rjob("rerr", "REVIEW:error", "commit rerr.txt", none)).json.run)).toMatchObject({ state: "awaiting", reason: "reviewer: no verdict (API Error: 529)" });
      for (const n of ["rnone", "rerr"]) await aleph(["drop", n]);
    });

    test("a reviewer past the time box holds the run", async () => {
      const slow = join(base, "slow-reviewer");
      writeFileSync(slow, "#!/bin/bash\nsleep 60\n", { mode: 0o755 });
      const t = await aleph(["job", "fac", "rslow2", "--spec", specFile("Goal: g\nACTION: commit rslow2.txt\n")], { ALEPH_REVIEWER_CMD: slow, ALEPH_REVIEW_TIMEOUT: "1", ALEPH_FIX_ROUNDS: "0" });
      expect(state(t.json.run)).toMatchObject({ state: "awaiting", reason: "reviewer: no verdict (time box)" });
      await aleph(["drop", "rslow2"]);
    });

    test("with the default fix rounds, a reviewer with no verdict twice needs Chris and no worker runs again", async () => {
      const slow = join(base, "slow-reviewer");
      writeFileSync(slow, "#!/bin/bash\nsleep 60\n", { mode: 0o755 });
      const t = await aleph(["job", "fac", "rslow3", "--spec", specFile("Goal: g\nACTION: commit rslow3.txt\n")], { ALEPH_REVIEWER_CMD: slow, ALEPH_REVIEW_TIMEOUT: "1" });
      expect(state(t.json.run)).toMatchObject({ state: "awaiting", ask: expect.objectContaining({ kind: "approval", reason: "review" }), reason: "reviewer: no verdict (time box)" });
      expect(runsOf("rslow3").length).toBe(1);
      await aleph(["drop", "rslow3"]);
      await rjob("rnone2", "REVIEW:none");
      const rs = runsOf("rnone2");
      expect(rs.length).toBe(1);
      expect(rs[0]).toMatchObject({ state: "awaiting", ask: expect.objectContaining({ kind: "approval", reason: "review" }), reason: expect.stringMatching(/^reviewer: no verdict/) });
      await aleph(["drop", "rnone2"]);
    }, 30_000);

    test("a silent reviewer is stopped at ALEPH_STALL_SECONDS and holds the run with no worker rerun", async () => {
      const silent = join(base, "silent-reviewer");
      writeFileSync(silent, "#!/bin/bash\nexec sleep 60\n", { mode: 0o755 });
      const t = await aleph(["job", "fac", "rstall", "--spec", specFile("Goal: g\nACTION: commit rstall.txt\n")], { ALEPH_REVIEWER_CMD: silent, ALEPH_STALL_SECONDS: "2" });
      expect(state(t.json.run)).toMatchObject({ state: "awaiting", reason: "reviewer: no verdict (stalled: no output for 2 seconds)" });
      expect(runsOf("rstall").length).toBe(1);
      await aleph(["drop", "rstall"]);
    }, 30_000);

    test("the held review's end records review.call on state.json, and aleph jobs shows it (criterion 17)", async () => {
      const stub = (name: string, line: string) => {
        const f = join(base, `stub-${name}`);
        writeFileSync(f, `#!/bin/bash\ncat >/dev/null\necho '{"type":"result","is_error":false,"result":"Checked.\\n${line}"}'\n`, { mode: 0o755 });
        return f;
      };
      const cases: [string, string, { call: string; reason?: string }][] = [
        ["rcland", "VERDICT: land", { call: "land" }],
        ["rcback", "VERDICT: back r", { call: "back", reason: "r" }],
        ["rcask", "VERDICT: chris q", { call: "ask", reason: "q" }],
      ];
      for (const [name, line, want] of cases) {
        const r = await rjob(name, "REVIEW:pass", "commit held/" + name + ".txt", { ALEPH_REVIEW_CMD: stub(name, line), ALEPH_FIX_ROUNDS: "0" });
        const run = r.json.run;
        await until(() => state(run).review !== undefined);
        expect(state(run).review).toEqual(want);
        expect((await aleph(["jobs", name])).json.review).toEqual(want);
        await aleph(["drop", name]);
      }
    }, 60_000);

    test("a held path holds without a review", async () => {
      const n = calls();
      const r = await rjob("rheld", "REVIEW:pass", "commit held/r.txt");
      expect(state(r.json.run)).toMatchObject({ ask: expect.objectContaining({ kind: "approval", reason: "held-path" }) });
      expect(calls()).toBe(n);
      await aleph(["drop", "rheld"]);
    });
  });
});
