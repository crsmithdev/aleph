#!/usr/bin/env bun
/**
 * The one-way Stop hook. It asks two questions of the current change, with no model:
 *
 *   co-change   a file that history says changes with a changed file (confidence ≥ 0.7) is left out
 *   boundaries  a changed file holds a copy of code that `.jscpd.json` keeps inside its owner
 *
 * A finding blocks the stop once per session, with the evidence, so the agent changes the companion, calls the
 * owner, or records the second way in `.one-way.json`. The same findings do not block twice, and a stop that a
 * Stop hook already continued is never blocked.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { peek, put } from "../../hooks/lib/handshake.ts";
import { accepted, changed, history, holes, rules } from "./cochange.ts";

const JSCPD = join(import.meta.dir, "../../node_modules/.bin/jscpd");

type Copy = { rule: string; copy: string; owner: string };

/** The boundary violations whose copy lies in a changed file. */
export function violations(root: string, change: Set<string>): Copy[] {
  const config = join(root, ".jscpd.json");
  if (!existsSync(config) || !JSON.parse(readFileSync(config, "utf8")).boundaries) return [];
  const out = mkdtempSync(join(tmpdir(), "one-way-"));
  try {
    Bun.spawnSync([JSCPD, "--reporters", "json", "--output", out, "--silent", "."], { cwd: root, stdout: "ignore", stderr: "ignore" });
    const report = JSON.parse(readFileSync(join(out, "jscpd-report.json"), "utf8"));
    return (report.boundaries ?? []).flatMap((b: any) =>
      b.violations
        .filter((v: any) => change.has(v.copy.name))
        .map((v: any) => ({ rule: b.name, copy: `${v.copy.name}:${v.copy.start}`, owner: `${v.protected.name}:${v.protected.start}${v.protected.function ? ` (${v.protected.function})` : ""}` })));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** The block reason for the findings, or null when there are none. */
export function reason(root: string): string | null {
  const change = changed(root);
  if (!change.size) return null;
  const left = holes(root, change, rules(history(root)), accepted(root));
  const copies = violations(root, change);
  if (!left.length && !copies.length) return null;
  const lines = [
    ...left.map((h) => `- ${h.a} changed; ${h.b} changed with it in ${h.co} of ${h.n} commits (confidence ${h.conf.toFixed(2)}, e.g. ${h.shas.join(" ")}). Change ${h.b} too, or record the pair in .one-way.json.`),
    ...copies.map((c) => `- ${c.copy} copies ${c.owner}, which boundary "${c.rule}" keeps in its owner. Call the owner instead.`),
  ];
  return `One way: this change may add a second way or leave a copy behind.\n${lines.join("\n")}\nA second way on purpose goes in .one-way.json as {"copies": [...], "reason": "..."} under "accepted".`;
}

if (import.meta.main) {
  const input = JSON.parse(await Bun.stdin.text());
  if (input.hook_event_name !== "Stop" || input.stop_hook_active === true) process.exit(0);
  const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: input.cwd ?? process.cwd(), stdout: "pipe", stderr: "ignore" });
  if (top.exitCode !== 0) process.exit(0);
  const text = reason(top.stdout.toString().trim());
  if (!text) process.exit(0);
  const key = `oneway:${input.session_id}:${createHash("sha1").update(text).digest("hex").slice(0, 12)}`;
  if (peek(key)) process.exit(0);
  put(key, { start: Date.now() });
  console.log(JSON.stringify({ decision: "block", reason: text }));
}
