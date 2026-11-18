import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session } from "../../hooks/lib/handshake.ts";
import { jscpd, scan } from "./clones.ts";
import { accepted, changed, history, holes, rules, seed, wilson } from "./cochange.ts";

const HOOK = join(import.meta.dir, "hook.ts");
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let root: string;

const sh = (...args: string[]) => {
  const p = Bun.spawnSync(args, { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
};
const write = (file: string, text: string) => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
};

/** A repo on main where a.ts and b.ts change together in 12 commits, and c.ts alone in 12. */
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "refit-"));
  process.env.ALEPH_SPOOL = join(root, ".spool");
  sh("git", "init", "-q", "-b", "main");
  for (let i = 0; i < 12; i++) {
    write("a.ts", `export const a = ${i};\n`);
    write("b.ts", `export const b = ${i};\n`);
    write("a.test.ts", `// ${i}\n`);
    sh("git", "add", "-A");
    sh("git", "commit", "-qm", `pair ${i}`);
    write("c.ts", `export const c = ${i};\n`);
    sh("git", "add", "-A");
    sh("git", "commit", "-qm", `alone ${i}`);
  }
  sh("git", "checkout", "-qb", "work");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function stop(input: object): string {
  const p = Bun.spawnSync(["bun", HOOK], { cwd: root, env: { ...process.env }, stdin: new TextEncoder().encode(JSON.stringify(input)), stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString().trim();
}

test("the Wilson bound ranks 40 of 44 above 3 of 3", () => {
  expect(wilson(40, 44)).toBeGreaterThan(wilson(3, 3));
  expect(wilson(0, 0)).toBe(0);
});

test("a pair that always changes together is a rule; a file that changes alone and test files are not", () => {
  const all = rules(history(root));
  expect(all.get("a.ts")!.map((r) => r.b)).toEqual(["b.ts"]);
  expect(all.has("c.ts")).toBe(false);
  expect(all.has("a.test.ts")).toBe(false);
});

test("the seed counts a file renamed mid-history under the new path, and never names the old one", () => {
  for (let i = 0; i < 12; i++) {
    write("old.ts", `export const o = ${i};\n`);
    write("comp.ts", `export const c = ${i};\n`);
    sh("git", "add", "-A");
    sh("git", "commit", "-qm", `fix old ${i}`);
  }
  sh("git", "mv", "old.ts", "new.ts");
  sh("git", "commit", "-qm", "rename old.ts to new.ts");
  for (let i = 0; i < 12; i++) {
    write("new.ts", `export const o = ${100 + i};\n`);
    write("comp.ts", `export const c = ${100 + i};\n`);
    sh("git", "add", "-A");
    sh("git", "commit", "-qm", `fix new ${i}`);
  }
  const s = seed(root);
  expect(Object.fromEntries(s.fixes.map((f) => [f.file, f.count]))).toEqual({ "new.ts": 24, "comp.ts": 24 });
  expect(s.pairs.some((p) => p.a === "old.ts" || p.b === "old.ts")).toBe(false);
  const pair = s.pairs.find((p) => p.a === "new.ts" && p.b === "comp.ts");
  expect([pair?.co, pair?.n]).toEqual([24, 25]);
});

test("a change to a.ts alone leaves b.ts as a hole; a change to both leaves none", () => {
  write("a.ts", "export const a = 99;\n");
  const all = rules(history(root));
  expect(holes(root, changed(root), all, []).map((h) => h.b)).toEqual(["b.ts"]);
  write("b.ts", "export const b = 99;\n");
  expect(holes(root, changed(root), all, [])).toEqual([]);
});

test("a pair recorded in .refit.json is not a hole", () => {
  write(".refit.json", JSON.stringify({ accepted: [{ copies: ["a.ts:1", "b.ts"], reason: "two ways on purpose" }] }));
  write("a.ts", "export const a = 99;\n");
  expect(holes(root, changed(root), rules(history(root)), accepted(root))).toEqual([]);
});

test("the hook blocks once per session for the same findings", () => {
  write("a.ts", "export const a = 99;\n");
  const input = { hook_event_name: "Stop", session_id: "s1", cwd: root };
  session("s1").set({ start: 1 });
  const first = JSON.parse(stop(input));
  expect(first.decision).toBe("block");
  expect(first.reason).toContain("b.ts changed with it in 12 of 12 commits");
  expect(stop(input)).toBe("");
});

test("the hook checks a stop that another hook already continued, and blocks it once", () => {
  write("a.ts", "export const a = 99;\n");
  const input = { hook_event_name: "Stop", session_id: "s2", cwd: root, stop_hook_active: true };
  session("s2").set({ start: 1 });
  expect(JSON.parse(stop(input)).reason).toContain("b.ts changed with it in 12 of 12 commits");
  expect(stop(input)).toBe("");
});

test("the hook blocks at most 3 times per session across different findings, and the cap is per session", () => {
  sh("git", "checkout", "-q", "main");
  for (let i = 0; i < 12; i++) {
    write("d.ts", `export const d = ${i};\n`);
    write("e.ts", `export const e = ${i};\n`);
    sh("git", "add", "-A");
    sh("git", "commit", "-qm", `second pair ${i}`);
  }
  sh("git", "checkout", "-q", "work");
  sh("git", "rebase", "-q", "main");
  session("cap").set({ start: 1 });
  session("other").set({ start: 1 });
  const input = { hook_event_name: "Stop", session_id: "cap", cwd: root };
  const outputs = ["a.ts", "b.ts", "d.ts", "e.ts"].map((file) => {
    sh("git", "checkout", "--", ".");
    write(file, `export const x = "${file}";\n`);
    return stop(input);
  });
  expect(outputs.slice(0, 3).map((o) => JSON.parse(o).decision)).toEqual(["block", "block", "block"]);
  expect(new Set(outputs.slice(0, 3)).size).toBe(3);
  expect(outputs[3]).toBe("");
  expect(JSON.parse(stop({ ...input, session_id: "other" })).decision).toBe("block");
});

test("a hook that throws while checking prints a systemMessage with the error, and does not block", () => {
  write(".refit.json", "{");
  write("a.ts", "export const a = 99;\n");
  session("s-crash").set({ start: 1 });
  const out = JSON.parse(stop({ hook_event_name: "Stop", session_id: "s-crash", cwd: root }));
  const parse = (() => { try { JSON.parse("{"); } catch (e) { return (e as Error).message; } })();
  expect(out.systemMessage).toContain("refit-code");
  expect(out.systemMessage).toContain(parse!);
  expect(out).not.toHaveProperty("decision");
});

test("a git that fails makes history throw with its message, not return no commits", () => {
  const bare = mkdtempSync(join(tmpdir(), "refit-bare-"));
  try { expect(() => history(bare)).toThrow(/git log failed: .*not a git repository/); }
  finally { rmSync(bare, { recursive: true, force: true }); }
});

test("the hook skips a session with no start record", () => {
  write("a.ts", "export const a = 99;\n");
  expect(stop({ hook_event_name: "Stop", session_id: "s0", cwd: root })).toBe("");
});

test("the hook skips a change from before the session started", () => {
  write("a.ts", "export const a = 99;\n");
  const input = { hook_event_name: "Stop", session_id: "s3", cwd: root };
  session("s3").set({ start: 4e12 });
  expect(stop(input)).toBe("");
  session("s3").set({ start: 1 });
  expect(JSON.parse(stop(input)).decision).toBe("block");
});

test("a copy of code a boundary protects, in a changed file, blocks with the owner", () => {
  const body = "export function settle(total: number, rate: number): number {\n  const fee = total * rate;\n  const tax = fee * 0.2;\n  const net = total - fee - tax;\n  if (net < 0) throw new Error(\"negative\");\n  return Math.round(net * 100) / 100;\n}\n";
  write("lib/money.ts", body);
  write(".jscpd.json", JSON.stringify({ boundaries: [{ name: "money", code: ["lib/money.ts"], notIn: ["**"], allow: ["lib/money.ts"], disable: ["semantic"] }] }));
  sh("git", "add", "-A");
  sh("git", "commit", "-qm", "money");
  sh("git", "checkout", "-qb", "copy");
  write("ui/pay.ts", body);
  session("s3").set({ start: 1 });
  const out = JSON.parse(stop({ hook_event_name: "Stop", session_id: "s3", cwd: root }));
  expect(out.reason).toContain('ui/pay.ts:1 (settle) copies lib/money.ts:1 (settle), which boundary "money" keeps in its owner');
});

const SETTLE = "export function settle(total: number, rate: number): number {\n  const fee = total * rate;\n  const tax = fee * 0.2;\n  const net = total - fee - tax;\n  if (net < 0) throw new Error(\"negative\");\n  return Math.round(net * 100) / 100;\n}\n";
const RENAMED = SETTLE.replaceAll("settle", "payout").replaceAll("fee", "cut").replaceAll("0.2", "0.25");
const RENAMES = { ignoreIdentifiers: true, ignoreLiterals: true };

test("a renamed copy that the base did not have blocks as a new copy", () => {
  write("lib/money.ts", SETTLE);
  write(".jscpd.json", JSON.stringify(RENAMES));
  write("ui/pay.ts", RENAMED);
  session("s4").set({ start: 1 });
  const out = JSON.parse(stop({ hook_event_name: "Stop", session_id: "s4", cwd: root }));
  expect(out.reason).toMatch(/lib\/money\.ts:1-\d+ \(\d+ lines\), a copy the base did not have|ui\/pay\.ts:1-\d+ \(\d+ lines\), a copy the base did not have/);
});

const IMPORTS = 'import { a, b, c, d } from "./a.ts";\nimport type { e, f, g, h } from "./b.ts";\nimport {\n  i,\n  j,\n  k,\n  l,\n} from "./c.ts";\nexport * from "./d.ts";\nexport { m, n, o, p } from "./e.ts";\nimport "./f.ts";\n';
const LOGIC = "export function total(items: number[], rate: number): number {\n  const sum = items.reduce((acc, n) => acc + n, 0);\n  const tax = sum * rate;\n  if (tax < 0) throw new Error(\"negative\");\n  const net = sum - tax;\n  return Math.round(net * 100) / 100;\n}\n";

test("a copy of import lines alone does not block, and imports with 6 lines of logic still block", () => {
  write(".jscpd.json", JSON.stringify(RENAMES));
  write("lib/one.ts", IMPORTS);
  write("lib/two.ts", IMPORTS);
  session("i1").set({ start: 1 });
  expect(scan(root).clones).toEqual([]);
  expect(stop({ hook_event_name: "Stop", session_id: "i1", cwd: root })).toBe("");
  write("lib/one.ts", IMPORTS + LOGIC);
  write("lib/two.ts", IMPORTS + LOGIC);
  session("i2").set({ start: 1 });
  expect(JSON.parse(stop({ hook_event_name: "Stop", session_id: "i2", cwd: root })).reason).toContain("a copy the base did not have");
});

test("a copy the base already had does not block, and an accepted pair does not block", () => {
  sh("git", "checkout", "-q", "main");
  write("lib/money.ts", SETTLE);
  write("ui/pay.ts", RENAMED);
  write(".jscpd.json", JSON.stringify(RENAMES));
  sh("git", "add", "-A");
  sh("git", "commit", "-qm", "two copies");
  sh("git", "checkout", "-qb", "edit");
  write("ui/pay.ts", RENAMED + "export const unit = 1;\n");
  for (const id of ["s5", "s6", "s7"]) session(id).set({ start: 1 });
  expect(stop({ hook_event_name: "Stop", session_id: "s5", cwd: root })).toBe("");
  write("ui/web.ts", RENAMED.replaceAll("payout", "webPay"));
  expect(stop({ hook_event_name: "Stop", session_id: "s6", cwd: root })).toContain("a copy the base did not have");
  write(".refit.json", JSON.stringify({ accepted: [{ copies: ["ui/web.ts", "lib/money.ts", "ui/pay.ts"], reason: "web needs its own" }] }));
  expect(stop({ hook_event_name: "Stop", session_id: "s7", cwd: root })).toBe("");
});

test("the hook keeps its jscpd result for a tree, and runs jscpd again when the tree changes", () => {
  process.env.ALEPH_SPOOL = mkdtempSync(join(tmpdir(), "refit-spool-"));
  write("lib/money.ts", SETTLE);
  write(".jscpd.json", JSON.stringify(RENAMES));
  write("ui/pay.ts", RENAMED);
  for (const id of ["k1", "k2", "k3"]) session(id).set({ start: 1 });
  const first = JSON.parse(stop({ hook_event_name: "Stop", session_id: "k1", cwd: root })).reason;
  const cached = () => readdirSync(process.env.ALEPH_SPOOL!).filter((f) => f.startsWith("jscpd-"));
  expect(cached().length).toBe(1);
  const at = () => statSync(join(process.env.ALEPH_SPOOL!, cached()[0])).mtimeMs;
  const kept = at();
  expect(JSON.parse(stop({ hook_event_name: "Stop", session_id: "k2", cwd: root })).reason).toBe(first);
  expect(at()).toBe(kept);
  write("ui/web.ts", RENAMED.replaceAll("payout", "webPay"));
  expect(JSON.parse(stop({ hook_event_name: "Stop", session_id: "k3", cwd: root })).reason).toContain("ui/web.ts");
  rmSync(process.env.ALEPH_SPOOL!, { recursive: true, force: true });
});

test("the hook runs jscpd again when an untracked file moves with the same content", () => {
  process.env.ALEPH_SPOOL = mkdtempSync(join(tmpdir(), "refit-spool-"));
  write("lib/money.ts", SETTLE);
  write(".jscpd.json", JSON.stringify(RENAMES));
  write("ui/pay.ts", RENAMED);
  for (const id of ["m1", "m2"]) session(id).set({ start: 1 });
  const kept = () => {
    const [file] = readdirSync(process.env.ALEPH_SPOOL!).filter((f) => f.startsWith("jscpd-"));
    return JSON.parse(readFileSync(join(process.env.ALEPH_SPOOL!, file), "utf8")).key;
  };
  expect(JSON.parse(stop({ hook_event_name: "Stop", session_id: "m1", cwd: root })).reason).toContain("ui/pay.ts");
  const before = kept();
  sh("mv", "ui/pay.ts", "ui/cash.ts");
  expect(JSON.parse(stop({ hook_event_name: "Stop", session_id: "m2", cwd: root })).reason).toContain("ui/cash.ts");
  expect(kept()).not.toBe(before);
  rmSync(process.env.ALEPH_SPOOL!, { recursive: true, force: true });
});

test("scan throws with jscpd's stderr when jscpd writes no report", () => {
  write(".jscpd.json", "{}");
  expect(() => scan(root, "no-such-ref")).toThrow(/wrote no report: [\s\S]*\S/);
});

test("scan throws with jscpd's stderr when jscpd exits non-zero with a report but no violation", () => {
  write("lib/money.ts", SETTLE);
  write("ui/pay.ts", SETTLE);
  write(".jscpd.json", JSON.stringify({ threshold: 0 }));
  expect(() => scan(root)).toThrow(/jscpd exited 1: [\s\S]*over threshold/);
});

test("a checkout with no node_modules finds the jscpd of a parent folder's node_modules", () => {
  write("node_modules/.bin/jscpd", "");
  mkdirSync(join(root, ".worktrees/w"), { recursive: true });
  expect(jscpd(join(root, ".worktrees/w"))).toBe(join(root, "node_modules/.bin/jscpd"));
});
