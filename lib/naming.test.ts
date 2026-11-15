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
    expect(n.issueHref("issue.1430", "aleph")).toBe("#/issues/aleph/1430");
    expect(n.issueHref("issue.1430")).toBe("");
    expect(n.issueHref("job.5", "aleph")).toBe("");
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
  test("keys", () => {
    expect(n.key("job", 6802)).toBe("job.6802");
    expect(n.parseKey("issue.12")).toEqual({ kind: "issue", n: 12 });
    expect(n.parseKey("a1430#2")).toBeNull();
    expect(n.shownId("job.6802")).toBe(n.shownKey("job.6802"));
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
    expect(Object.keys(n.OLD).sort()).toEqual(["act", "actor", "ask"]);
  });
  test("an issue hold is one held event, and the hold actions of old events are no longer written", () => {
    expect(n.event({ subject: "gate", action: "held", object: "issue.3", detail: "credit: job.1 hit the API credit error" }).action).toBe("held");
    for (const action of n.OLD_HOLDS) expect(() => n.event({ subject: "gate", action, object: "issue.3" })).toThrow(/action/);
    expect(n.OLD_HOLDS).toContain("looping");
  });
  test("credit is a cause with a phrase", () => expect(n.because("credit")).toBe("out of credit"));
  test("every set is lower case with no separator marks", () => {
    const sets = [n.STATUSES, n.ACTIONS, n.ACTORS, n.ROLES, n.STAGES, n.LANES, n.SPEEDS];
    for (const w of sets.flat()) expect(w).toMatch(/^[a-z][a-z-]*$/);
    for (const map of Object.values(n.OLD)) for (const w of Object.values(map)) expect(sets.flat()).toContain(w);
  });
});

describe("events", () => {
  test("content is the detail with each issue ID short", () => {
    expect(n.contentText({ detail: "waits for aleph-1372" })).toBe("waits for a1372");
    expect(n.contentText({})).toBe("");
  });
  test("a subject or action outside its set throws", () => {
    expect(() => n.event({ subject: "gate", action: "not-ready", object: "aleph-1" })).toThrow(/action/);
    expect(() => n.event({ subject: "You", action: "changed", object: "aleph-1" })).toThrow(/subject/);
    expect(() => n.event({ subject: "gate", action: "refused", object: "aleph-1" })).toThrow(/action/);
    expect(n.event({ time: "t", subject: "job.6802", action: "stalled", object: "issue.2072", detail: "no output" })).toEqual({ time: "t", subject: "job.6802", action: "stalled", object: "issue.2072", detail: "no output" });
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

test("sayText says an event in the active voice, its object first, the detail after a colon or in place", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ subject: "gate", action: "landed", object: "job.6802" }, "j-06802 landed"],
    [{ subject: "gate", action: "landed", object: "job.6802", detail: "over review" }, "j-06802 landed: over review"],
    [{ subject: "gate", action: "failed", object: "job.6802", detail: "merge conflict" }, "j-06802 failed: merge conflict"],
    [{ subject: "job.6803", subject_role: "review", action: "returned", object: "job.6802" }, "j-06802 returned by review"],
    [{ subject: "gate", action: "returned", object: "job.6802" }, "j-06802 returned"],
    [{ subject: "gate", action: "waiting", object: "issue.3" }, "i-00003 waits for you"],
    [{ subject: "gate", action: "after", object: "issue.3", detail: "issue.2" }, "i-00003 waits for i-00002"],
    [{ subject: "gate", action: "held", object: "issue.2994", detail: "after: issue.2985 issue.2993" }, "i-02994 held: after i-02985 i-02993"],
    [{ subject: "gate", action: "waiting", object: "issue.3", project: "aleph" }, "a-00003 waits for you"],
    [{ subject: "gate", action: "busy", object: "issue.3", detail: "job.6802 holds src/x.ts" }, "i-00003 waits: j-06802 holds src/x.ts"],
    [{ subject: "gate", action: "red", object: "issue.3", detail: "at abc1234" }, "i-00003 waits: main is red: at abc1234"],
    [{ subject: "human", action: "filed", object: "issue.3" }, "i-00003 filed by you"],
    [{ subject: "claude", action: "filed", object: "issue.3" }, "i-00003 filed by Claude Code"],
    [{ subject: "job.6801", subject_role: "intake", action: "filed", object: "issue.3" }, "i-00003 filed by intake"],
    [{ subject: "rule", action: "stalled", object: "job.6802" }, "j-06802 stalled"],
    [{ subject: "human", action: "changed", object: "settings", detail: "the factory is paused" }, "settings changed: the factory is paused"],
  ];
  for (const [ev, text] of cases) expect(n.sayText(ev)).toBe(text);
});

test("say links the keys in the detail", () => {
  expect(n.say({ subject: "gate", action: "busy", object: "issue.3", detail: "job.6802 holds src/x.ts" })).toEqual([{ id: "issue.3" }, " waits: ", { id: "job.6802" }, " holds src/x.ts"]);
});

describe("keys", () => {
  test("a key builds and parses", () => {
    expect(n.key("job", 6802)).toBe("job.6802");
    expect(n.parseKey("issue.2072")).toEqual({ kind: "issue", n: 2072 });
    expect(n.parseKey("project.1")).toEqual({ kind: "project", n: 1 });
    expect(n.parseKey("aleph-2072")).toBeNull();
    expect(n.parseKey("issue.x")).toBeNull();
  });
  test("a shown key pads to 5 digits and parses back, leading zeros included", () => {
    expect(n.shownKey("job.6802")).toBe("j-06802");
    expect(n.shownKey("issue.2")).toBe("i-00002");
    expect(n.shownKey("idea.7")).toBe("d-00007");
    expect(n.shownKey("project.3")).toBe("p-00003");
    expect(n.shownKey("issue.1234", "a")).toBe("a-01234");
    expect(n.shownKey("settings")).toBe("settings");
    for (const k of ["job.6802", "issue.2", "idea.7", "project.3", "job.123456"]) expect(n.parseKey(n.shownKey(k))).toEqual(n.parseKey(k));
  });
  test("a project code reads as an issue", () => {
    expect(n.parseKey("a-01234")).toEqual({ kind: "issue", n: 1234 });
    expect(n.parseKey("z-01234")).toBeNull();
  });
  test("a project code i is the issue letter, and a code p, d or j is refused", () => {
    n.setCodes({ interview: "i" });
    expect(n.shownKey("issue.5", "i")).toBe("i-00005");
    expect(n.parseKey("i-00005")).toEqual({ kind: "issue", n: 5 });
    for (const c of ["p", "d", "j"]) expect(() => n.setCodes({ jam: c })).toThrow(/another kind/);
  });
});
