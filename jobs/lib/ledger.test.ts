import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allJobs, issue, stateOf, view } from "./job.ts";
import { askOf, isAwaiting, isBuild, isOpen, newsLine, onOf, OPEN, reviewOf, writeRun, type Run } from "./ledger.ts";

let base: string;
let saved: string | undefined;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ledger-"));
  saved = process.env.ALEPH_JOBS_DIR;
  process.env.ALEPH_JOBS_DIR = base;
});

afterEach(() => {
  if (saved === undefined) delete process.env.ALEPH_JOBS_DIR;
  else process.env.ALEPH_JOBS_DIR = saved;
  rmSync(base, { recursive: true, force: true });
});

function write(id: string, extra: Partial<Run>, files: Record<string, string> = {}): void {
  const folder = join(base, id);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { job: id, name: "n", repo: "fac", told: true, started: "2026-10-30T00:00:00Z", ...extra } as Run);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
}

const ask = { kind: "approval" as const, reason: "held-path", question: "", options: [], why: [] };

function pair() {
  write("20261030-000001-old", { kind: "agent", state: "needs-you", needs: "held", todo: 7 }, { "review2.md": "VERDICT: chris sure?\n" });
  write("20261030-000002-new", { kind: "build", state: "awaiting", ask, on: "fac-7", review: { call: "ask", reason: "sure?" } });
  const [o, n] = allJobs();
  return { o, n };
}

describe("both run shapes", () => {
  test("an old and a new run give the same answers", () => {
    const { o, n } = pair();
    expect(isOpen(o)).toBe(true);
    expect(isOpen(n)).toBe(true);
    expect(stateOf(o)).toBe(stateOf(n));
    expect(issue(o)).toBe(7);
    expect(issue(n)).toBe(7);
    expect(onOf(o[0].run)).toBe(onOf(n[0].run));
    expect(askOf(o[0].run)).toMatchObject({ kind: "approval", reason: "held-path" });
    expect(askOf(n[0].run)).toMatchObject({ kind: "approval", reason: "held-path" });
    expect(reviewOf(o[0])).toEqual({ call: "ask", reason: "sure?" });
    expect(reviewOf(n[0])).toEqual(reviewOf(o[0]));
    const { job: _a, run: ro, started: _b, name: _c, ...vo } = view(o);
    const { job: _d, run: rn, started: _e, name: _f, ...vn } = view(n);
    expect(vn).toEqual(vo);
    expect(vn.state).toBe("needs-you");
    expect(vn.needs).toBe("held");
    expect(rn.kind).toBe("build");
    expect(ro.kind).toBe("agent");
  });

  test("news line reads the new shape as the old", () => {
    const { o, n } = pair();
    expect(newsLine(n[0].run)).toBe(newsLine(o[0].run));
    expect(newsLine(n[0].run)).toBe("fac/n needs-you held");
  });
});

describe("accessors", () => {
  test("predicates", () => {
    expect(OPEN).toContain("awaiting");
    expect(isAwaiting("awaiting") && isAwaiting("needs-you") && !isAwaiting("passed")).toBe(true);
    expect(isBuild("build") && isBuild("agent") && !isBuild("land")).toBe(true);
  });

  test("onOf: the number for the run's repo; a dotted or foreign on gives none", () => {
    const r = { repo: "fac", todo: 4 } as Run;
    expect(onOf({ ...r, on: "fac-7" })).toBe(7);
    expect(onOf({ ...r, on: "aleph-577.1" })).toBeUndefined();
    expect(onOf({ ...r, on: "oth-7" })).toBeUndefined();
    expect(onOf(r)).toBe(4);
  });

  test("askOf builds approval for held and review, input for question and manual", () => {
    expect(askOf({ needs: "review" } as Run)).toMatchObject({ kind: "approval", reason: "review" });
    expect(askOf({ needs: "question", question: "which?" } as Run)).toMatchObject({ kind: "input", reason: "question", question: "which?" });
    expect(askOf({ needs: "manual", stat: "1 file" } as Run)).toMatchObject({ kind: "input", reason: "manual", why: ["1 file"] });
    expect(askOf({} as Run)).toBeUndefined();
  });
});
