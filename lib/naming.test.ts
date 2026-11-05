import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as n from "./naming.ts";

beforeEach(() => n.setCodes({ aleph: "a", sidetone: "s", "btcx-tools": "b", cloudchamber: "cc" }));

describe("ids", () => {
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
    expect(n.word("state", "awaiting")).toBe("waiting");
    expect(n.word("ask", "proposal-claude-md")).toBe("proposal");
    expect(n.word("actor", "You")).toBe("human");
    expect(n.word("kind", "agent")).toBe("build");
    expect(n.word("state", "landed")).toBe("landed");
  });
  test("the credit wait reads as the hold word credit", () => {
    expect(n.word("gate", "credit-wait")).toBe("credit");
    expect(n.event({ by: "gate", subject: "aleph-1", action: "credit" }).action).toBe("credit");
  });
  test("credit is a sub", () => {
    expect(n.event({ by: "gate", subject: "aleph-1", action: "failed", sub: "credit" }).sub).toBe("credit");
  });
  test("a sent-back stuck job is returned, any other stuck job failed", () => {
    expect(n.jobState("stuck", "review")).toBe("returned");
    expect(n.jobState("stuck", "test")).toBe("returned");
    expect(n.jobState("stuck")).toBe("failed");
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
