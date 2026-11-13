import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as n from "./naming.ts";

beforeEach(() => n.setCodes({ aleph: "a", sidetone: "s", "btcx-tools": "b", cloudchamber: "cc" }));
// The codes are global: the files that run after this one start with none.
afterAll(() => n.setCodes({}));

describe("ids", () => {
  test("an issue's page link comes from its full or short ID", () => {
    expect(n.issueHref("aleph-1430")).toBe("#/issues/aleph/1430");
    expect(n.issueHref("b3.1")).toBe("#/issues/btcx-tools/3.1");
    expect(n.issueHref("monitor")).toBe("");
  });

  test("short and full forms map both ways", () => {
    expect(n.shortId("aleph-1430")).toBe("a1430");
    expect(n.shortId("aleph-1359.1")).toBe("a1359.1");
    expect(n.shortId("btcx-tools-3")).toBe("b3");
    expect(n.fullId("a1430")).toBe("aleph-1430");
    expect(n.fullId("cc12")).toBe("cloudchamber-12");
    expect(n.fullId("aleph-1430")).toBe("aleph-1430");
  });
  test("a project with no code keeps its full form", () => expect(n.shortId("koans-4")).toBe("koans-4"));
  test("a short ID needs a known code", () => {
    expect(n.parseId("z12")).toBeNull();
    expect(n.parseId("a12")).toEqual({ repo: "aleph", n: 12, sub: undefined });
  });
  test("job IDs", () => {
    expect(n.jobId("aleph-1430", 2)).toBe("a1430#2");
    expect(n.jobId("monitor", 14)).toBe("monitor#14");
    expect(n.parseJob("a1430#2")).toEqual({ subject: "aleph-1430", n: 2 });
    expect(n.parseJob("a1430-2")).toEqual({ subject: "aleph-1430", n: 2 });
    expect(n.parseJob("aleph-1430#2")).toEqual({ subject: "aleph-1430", n: 2 });
    expect(n.parseJob("monitor#14")).toEqual({ subject: "monitor", n: 14 });
    expect(n.parseJob("aleph-1430")).toBeNull();
    expect(n.fileSafe("a1430#2")).toBe("a1430-2");
  });
  test("a run's subject is its issue, else the routine, else its name", () => {
    expect(n.subjectOf({ on: "aleph-1430", kind: "build", name: "a1430" })).toBe("aleph-1430");
    expect(n.subjectOf({ kind: "monitor", name: "monitor" })).toBe("monitor");
    expect(n.subjectOf({ kind: "build", name: "a1430" })).toBe("a1430");
  });
  test("free text yields full IDs only, never a sha", () => {
    expect(n.refs("waits for aleph-1372 and btcx-tools-3; sha a143077 and a1372")).toEqual(["aleph-1372", "btcx-tools-3"]);
    expect(n.shortText("after aleph-1372, see 4240d76")).toBe("after a1372, see 4240d76");
  });
});

describe("words", () => {
  test("old words read as new", () => {
    expect(n.word("ask", "proposal-claude-md")).toBe("proposal");
    expect(n.word("actor", "You")).toBe("human");
    expect(n.word("act", "land")).toBe("landed");
    expect(n.word("act", "landed")).toBe("landed");
  });
  test("OLD keeps only the sets that live code still writes", () => {
    expect(Object.keys(n.OLD).sort()).toEqual(["act", "actor", "ask", "gate"]);
  });
  test("the credit wait reads as the hold word credit", () => {
    expect(n.word("gate", "credit-wait")).toBe("credit");
    expect(n.event({ by: "gate", subject: "aleph-1", action: "credit" }).action).toBe("credit");
  });
  test("credit is a sub", () => {
    expect(n.event({ by: "gate", subject: "aleph-1", action: "failed", sub: "credit" }).sub).toBe("credit");
  });
  test("every set is lower case with no separator marks", () => {
    const sets = [n.STATUSES, n.ACTIONS, n.SUBS, n.ACTORS, n.KINDS, n.STAGES, n.LANES, n.SPEEDS];
    for (const w of sets.flat()) expect(w).toMatch(/^[a-z][a-z-]*$/);
    for (const map of Object.values(n.OLD)) for (const w of Object.values(map)) expect(sets.flat()).toContain(w);
  });
});

describe("events", () => {
  test("content joins the fields", () => {
    expect(n.contentText({ on: ["aleph-1372"], file: "ui/views/issues.js" })).toBe("a1372 → issues.js");
    expect(n.contentText({ on: ["a1421#6"], result: "dropped" })).toBe("a1421#6 → dropped");
    expect(n.contentText({ file: "hooks/lib/docclaims.ts", to: "human" })).toBe("docclaims.ts → human");
    expect(n.contentText({ file: "tests" })).toBe("→ tests");
    expect(n.contentText({ count: "3 / 1h" })).toBe("3 / 1h");
  });
  test("a word outside its set throws", () => {
    expect(() => n.event({ by: "gate", subject: "aleph-1", action: "not-ready" })).toThrow(/action/);
    expect(() => n.event({ by: "You", subject: "aleph-1", action: "changed" })).toThrow(/by/);
    expect(n.event({ at: "t", by: "gate", subject: "aleph-1", action: "busy", on: ["aleph-2"] })).toEqual({ at: "t", by: "gate", subject: "aleph-1", action: "busy", on: ["aleph-2"] });
  });
  test("clip cuts at a word end", () => expect(n.clip("the hold is right on the letter", 16)).toBe("the hold is…"));
});

describe("lane", () => {
  test("a job state maps to its report lane", () => {
    expect(n.lane("returned")).toBe("failed");
    expect(n.lane("passed")).toBe("other");
  });
});

const ROOT = join(import.meta.dir, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f.startsWith(".")) return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|js)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });

/** Copies that later phases move onto lib/naming.js; each phase deletes its entries here. */
const LEFT = new Set<string>([]);

test("no other file defines a state list", () => {
  const hits = ["jobs", "issues", "ui", "hooks"].flatMap((d) => files(join(ROOT, d)))
    .filter((p) => /export const STATES\s*=/.test(readFileSync(p, "utf8")))
    .map((p) => p.slice(ROOT.length + 1))
    .filter((p) => !LEFT.has(p));
  expect(hits).toEqual([]);
});

test("the name table gives one display name for each step and role", () => {
  expect([n.NAMES.build, n.NAMES["spec-check"], n.NAMES.planner]).toEqual(["Implement", "Spec Check", "Planner"]);
  for (const k of Object.keys(n.NAMES)) expect(k).toMatch(/^[a-z][a-z-]*$/);
});

test("no file outside lib/naming.ts reads an issue ID with its own regex", () => {
  // The fixed list of non-ID uses of `-\d+`, `-(\d+` or `-(?:\d+`: file and the text on the line.
  const OK: [string, string][] = [
    ["hooks/lib/docclaims.ts", ":\\d+(?:-\\d+)?"], ["hooks/lib/docclaims.ts", "(\\d+)(?:-\\d+)?"], ["hooks/lib/scan.ts", "@@ -\\d+"],
    ["jobs/lib/gates/doc-claims.ts", "(?::\\d+(?:-\\d+)?)?"], ["jobs/lib/gates/doc-claims.ts", ":(\\d+)(?:-(\\d+))?"], ["ui/decision.js", ":\\d+(?:-\\d+)?"], ["ui/decision.js", "lines? \\d+(?:-\\d+)?"],
    ["ui/lib.js", "(-\\d+)+(\\[.*\\])?$"], ["jobs/cli.helpers.ts", "-fac-${id}-\\\\d+$"],
  ];
  const root = join(import.meta.dir, "..");
  const files = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return f === "node_modules" || f === "vendor" || f.startsWith(".") ? [] : statSync(p).isDirectory() ? files(p) : /\.(ts|js)$/.test(f) && !f.includes(".test.") ? [p] : [];
  });
  const hits = ["jobs", "issues", "ui", "hooks"].flatMap((d) => files(join(root, d))).flatMap((p) => {
    const rel = p.slice(root.length + 1);
    return readFileSync(p, "utf8").split("\n").filter((l) => /-\(?(?:\?:)?\\{1,2}d\+/.test(l) && !OK.some(([f, t]) => f === rel && l.includes(t))).map((l) => `${rel}: ${l.trim()}`);
  });
  expect(hits).toEqual([]);
});

test("sayText says an event in the active voice, its job or issue first, the sub's cause after a colon", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ subject: "aleph-1868", action: "landed", on: ["a1868#2"] }, "a1868#2 landed"],
    [{ subject: "aleph-1749", action: "failed", sub: "conflict", on: ["a1749#6"] }, "a1749#6 failed: merge conflict"],
    [{ subject: "aleph-3", action: "returned", sub: "review", on: ["a3#1"] }, "a3#1 returned by review"],
    [{ subject: "aleph-3", action: "waiting", to: "human" }, "a3 waits for you"],
    [{ subject: "aleph-3", action: "after", on: ["aleph-2"] }, "a3 waits for a2"],
    [{ subject: "aleph-3", action: "filed", by: "human" }, "a3 filed by you"],
    [{ subject: "aleph-3", action: "filed", by: "claude" }, "a3 filed by Claude Code"],
    [{ subject: "aleph-3", action: "filed", by: "worker" }, "a3 filed by a worker"],
  ];
  for (const [ev, text] of cases) expect(n.sayText(ev)).toBe(text);
});
