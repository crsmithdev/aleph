import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session } from "../../hooks/lib/handshake.ts";
import { scan } from "./clones.ts";
import { accepted, changed, history, holes, rules, wilson } from "./cochange.ts";

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

test("the hook blocks once per session for the same findings, and never a stop a hook already continued", () => {
  write("a.ts", "export const a = 99;\n");
  const input = { hook_event_name: "Stop", session_id: "s1", cwd: root };
  const first = JSON.parse(stop(input));
  expect(first.decision).toBe("block");
  expect(first.reason).toContain("b.ts changed with it in 12 of 12 commits");
  expect(stop(input)).toBe("");
  expect(stop({ ...input, session_id: "s2", stop_hook_active: true })).toBe("");
});

test("the hook skips a change from before the session started", () => {
  write("a.ts", "export const a = 99;\n");
  const input = { hook_event_name: "Stop", session_id: "s3", cwd: root };
  session("s3").set({ start: Date.now() + 60_000 });
  expect(stop(input)).toBe("");
  session("s3").set({ start: Date.now() - 60_000 });
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
  const out = JSON.parse(stop({ hook_event_name: "Stop", session_id: "s4", cwd: root }));
  expect(out.reason).toMatch(/lib\/money\.ts:1-\d+ \(\d+ lines\), a copy the base did not have|ui\/pay\.ts:1-\d+ \(\d+ lines\), a copy the base did not have/);
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
  expect(stop({ hook_event_name: "Stop", session_id: "s5", cwd: root })).toBe("");
  write("ui/web.ts", RENAMED.replaceAll("payout", "webPay"));
  expect(stop({ hook_event_name: "Stop", session_id: "s6", cwd: root })).toContain("a copy the base did not have");
  write(".refit.json", JSON.stringify({ accepted: [{ copies: ["ui/web.ts", "lib/money.ts", "ui/pay.ts"], reason: "web needs its own" }] }));
  expect(stop({ hook_event_name: "Stop", session_id: "s7", cwd: root })).toBe("");
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
