import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, fakeLog, jobRuns, other, state, setup, teardown } from "../../cli.testkit";
import { allRuns } from "../records/record.ts";
import { jobFolder } from "../records/run-files.ts";
import { drop, job } from "../../flow.testkit.ts";
import { readModels } from "../routing/models.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  describe("the reviewer", () => {
    const rjob = (name: string, mark: string, action = `commit ${name}.txt`, extra: Record<string, string> = {}) =>
      job("fac", name, `Goal: ${name} ${mark}\nACTION: ${action}\n`, {}, extra);
    const calls = () => existsSync(join(fakeLog, "review-calls")) ? readFileSync(join(fakeLog, "review-calls"), "utf8").split("\n").length - 1 : 0;

    // The build runs of a work: its reviewer jobs are runs of their own, left out here.
    const runsOf = (name: string) => jobRuns(name).map((d) => ({ id: d, ...state(d) })).filter((x) => x.role !== "review");
    /** The `review.json` of the build's reviewer job; its path is undefined when no reviewer job has one. */
    const reviewJson = (run: string) => allRuns().filter((e) => e.run.role === "review" && e.run.prev === run).map((e) => join(e.folder, "review.json")).find(existsSync);

    test("a silent reviewer is stopped at ALEPH_STALL_SECONDS and holds the run with no worker rerun", async () => {
      const silent = join(base, "silent-reviewer");
      writeFileSync(silent, "#!/bin/bash\nexec tail -f /dev/null\n", { mode: 0o755 });
      const t = await job("fac", "rstall", "Goal: g\nACTION: commit rstall.txt\n", {}, { ALEPH_REVIEWER_CMD: silent, ALEPH_STALL_SECONDS: "2" });
      expect(state(t.json.run)).toMatchObject({ state: "waiting", reason: "reviewer: no verdict (stalled: no output for 2 seconds)" });
      expect(runsOf("rstall").length).toBe(1);
      expect(reviewJson(t.json.run)).toBeUndefined();
      await drop("rstall");
    }, 30_000);

    test("the reviewer runs without ANTHROPIC_BASE_URL from the job's env", async () => {
      const r = await rjob("rbase", "REVIEW:pass", undefined, { ANTHROPIC_BASE_URL: "https://openrouter.ai/api" });
      expect(state(r.json.run).state).not.toBe("failed");
      expect(readFileSync(join(fakeLog, "review-env"), "utf8")).not.toContain("ANTHROPIC_BASE_URL");
      await drop("rbase");
    });

    // v6 phase 6: no second review. A held diff is reviewed once, then waits with one held-path Ask.
    const noSecondReview = (run: string) => {
      expect(existsSync(join(jobFolder(run), "call.md"))).toBe(false);
      expect(existsSync(join(jobFolder(run), "call-prompt.md"))).toBe(false);
    };

    test("a security path gets the reviewer, then one held-path Ask, and no second review", async () => {
      const n = calls();
      const r = await rjob("rsec", "REVIEW:pass", "commit hooks/r.txt");
      expect(state(r.json.run)).toMatchObject({ state: "waiting", ask: expect.objectContaining({ reason: "held-path" }), reason: "held path hooks/r.txt" });
      expect(calls()).toBe(n + 1);
      noSecondReview(r.json.run);
      await drop("rsec");
    });

    test("a held path that passes review sets one held-path Ask, starts no second review, and does not land", async () => {
      const n = calls();
      const r = await job("fac", "rheld", "Goal: rheld REVIEW:pass\nACTION: commit held/r.txt\n", { land: true });
      const s = state(r.json.run);
      expect(s).toMatchObject({ state: "waiting", ask: expect.objectContaining({ reason: "held-path" }), reason: "held path held/r.txt" });
      expect(s.next).toBeUndefined();
      expect(s.review).toMatchObject({ call: "passed", model: expect.any(String) });
      expect(calls()).toBe(n + 1);
      expect(JSON.parse(readFileSync(reviewJson(r.json.run)!, "utf8"))).toMatchObject({ verdict: "pass" });
      noSecondReview(r.json.run);
      // One run, one Ask: no land run, and nothing on origin/main.
      expect(runsOf("rheld").map((x) => [x.role, x.state])).toEqual([["build", "waiting"]]);
      await drop("rheld");
    });

    test("a returned build keeps its size, and a build with no size stays on the default", async () => {
      rmSync(join(fakeLog, "holdonce"), { force: true });
      await job("fac", "rsize", "Goal: rsize REVIEW:holdonce\nACTION: commit rsize.txt\n", { model: "medium" });
      const rs = runsOf("rsize");
      expect(rs[0]).toMatchObject({ state: "returned", failed: "review", size: "medium" });
      expect(rs[1]).toMatchObject({ size: "medium", model: readModels().medium.model });
      await drop("rsize");
      rmSync(join(fakeLog, "holdonce"), { force: true });
      await job("fac", "rnosize", "Goal: rnosize REVIEW:holdonce\nACTION: commit rnosize.txt\n");
      const ns = runsOf("rnosize");
      expect(ns[0]).toMatchObject({ state: "returned", failed: "review" });
      expect(ns[1].size).toBeUndefined();
      expect(ns[1].model).not.toBe(readModels().medium.model);
      await drop("rnosize");
    }, 60_000);

    test("a returned merge round starts a round on the size of the build before it", async () => {
      // Call 1 passes the build and pushes a clash on rmerge.txt, so the land conflicts; call 2 holds the merge round.
      // The worker is the fake one, which gives no result on a merge prompt: this one adds it.
      const rv = join(base, "merge-reviewer"), n = join(base, "merge-reviews"), wk = join(base, "merge-worker");
      const pass = `'{"type":"result","is_error":false,"result":"","structured_output":{"verdict":"pass","summary":"Fine.","failures":[]}}'`;
      const hold = `'{"type":"result","is_error":false,"result":"","structured_output":{"verdict":"hold","summary":"Looked.","failures":[{"clause":"merge","observed":"seen"}]}}'`;
      writeFileSync(rv, `#!/bin/bash\ncat > /dev/null\necho x >> ${n}\nc=$(wc -l < ${n})\n` +
        `if [ $c = 1 ]; then (cd ${other} && git pull -q --rebase origin main && echo theirs > rmerge.txt && git add rmerge.txt && git -c user.name=t -c user.email=t@t commit -qm clash && git push -q origin main); echo ${pass}\n` +
        `elif [ $c = 2 ]; then echo ${hold}\nelse echo ${pass}; fi\n`, { mode: 0o755 });
      writeFileSync(wk, `#!/bin/bash\np=$(cat)\nprintf '%s' "$p" | ${join(base, "fake-worker")} "$@"\n` +
        `if printf '%s' "$p" | grep -q '^# Merge '; then echo '{"type":"result","is_error":false,"result":"","structured_output":{"summary":"merged","defaults":[],"followups":[],"flakes":[],"already_met":null,"question":null}}'; fi\n`, { mode: 0o755 });
      await job("fac", "rmerge", "Goal: rmerge\nACTION: commit rmerge.txt\n", { land: true, model: "medium" }, { ALEPH_REVIEWER_CMD: rv, ALEPH_WORKER_CMD: wk });
      const rs = runsOf("rmerge");
      expect(rs[1]).toMatchObject({ role: "land", reason: "merge conflict" });
      expect(rs[2]).toMatchObject({ merge: true, state: "returned", failed: "review" });
      expect(rs[3].merge).toBeUndefined();
      expect(rs[3]).toMatchObject({ size: "medium", model: readModels().medium.model });
      await drop("rmerge");
    }, 60_000);

    test("a held path the reviewer holds is a fix round, not an Ask", async () => {
      rmSync(join(fakeLog, "holdonce"), { force: true });
      await job("fac", "rheldhold", "Goal: rheldhold REVIEW:holdonce\nACTION: commit held/h.txt\n");
      const rs = runsOf("rheldhold");
      expect(rs[0]).toMatchObject({ state: "returned", failed: "review" });
      expect(rs.at(-1)).toMatchObject({ state: "waiting", ask: expect.objectContaining({ reason: "held-path" }) });
      for (const x of rs) noSecondReview(x.id);
      await drop("rheldhold");
    }, 30_000);

    test("a round after a review hold resumes the held build's session and sends the hold note alone", async () => {
      rmSync(join(fakeLog, "holdonce"), { force: true });
      await rjob("rresume", "REVIEW:holdonce", undefined, { ALEPH_CLAUDE_PROJECTS: join(base, "projects") });
      const rs = runsOf("rresume");
      expect(rs[0]).toMatchObject({ state: "returned", failed: "review" });
      expect(rs[1]).toMatchObject({ session: rs[0].session, resumed: true });
      const args = readFileSync(join(fakeLog, "args"), "utf8");
      expect(args).toContain(`--resume ${rs[0].session}`);
      expect(args).not.toContain("--session-id");
      const prompt = readFileSync(join(jobFolder(rs[1].id), "prompt.md"), "utf8");
      expect(prompt).toContain("the flag has no test");
      expect(prompt).not.toContain("## Spec");
      await drop("rresume");
    }, 30_000);

    test("the reviewer's prompt lists the changed files outside the Edit surface", async () => {
      await job("fac", "rsurf", "## Goal\nrsurf REVIEW:pass\nACTION: commit-all in/a.txt out/b.txt\n\n## Edit surface\n- in/ (the change)\n\n## Oracle\nIt ships.\n");
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      const section = p.slice(p.indexOf("## Changes outside the Edit surface"), p.indexOf("## Issue"));
      expect(section).toContain("- out/b.txt");
      expect(section).not.toContain("in/a.txt");
      await drop("rsurf");
    });
  });
});
