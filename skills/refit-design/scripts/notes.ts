#!/usr/bin/env bun
/**
 * Adds each open finding of a refit-design run as an agent note on the page it audited, through `shelf note add`.
 * A note is the headline, the plain sentence, then `rule:`, `where:`, `from:` and the key, `finding: <lens>:<rule>:<unit>`.
 * The run's `f<n>` restarts each run, so the key is what tells a repeat: a finding whose key an unresolved note on its
 * page holds gets no second note.
 *
 * Usage: bun notes.ts <run dir>    (the store is ALEPH_ANNOTATIONS, else ~/.aleph/annotations.json)
 */
import { homedir } from "node:os";
import { join } from "node:path";

type Finding = { lens: string; rule: string; unit: string; url: string; selector: string; headline: string; plain: string; locations: string[]; status: string };
type Note = { url: string; note: string; status: string };

const file = process.env.ALEPH_ANNOTATIONS ?? join(homedir(), ".aleph/annotations.json");
const { findings } = (await Bun.file(join(process.argv[2], "findings.json")).json()) as { findings: Finding[] };

/** Runs `shelf note` on the store and returns its stdout. */
const shelf = (args: string[], stdin?: string) => {
  const run = Bun.spawnSync(["shelf", "note", ...args, "--file", file], { stdin: stdin === undefined ? "ignore" : Buffer.from(stdin) });
  if (run.exitCode !== 0) throw new Error(`shelf note ${args[0]}: ${run.stderr}`);
  return run.stdout.toString();
};

const key = (f: Finding) => `finding: ${f.lens}:${f.rule}:${f.unit}`;
// One page and key per entry, so a repeat within this run is caught too.
const held = new Set((JSON.parse(shelf(["list", "--all", "--json"])) as Note[])
  .filter((n) => n.status !== "resolved").map((n) => `${n.url} ${n.note.split("\n").find((l) => l.startsWith("finding: "))}`));

for (const f of findings.filter((f) => f.status === "open" || f.status === "reverted")) {
  const id = `${f.url} ${key(f)}`;
  if (held.has(id)) { console.log(`held  ${id}`); continue; }
  shelf(["add", "--selector", f.selector, "--url", f.url, "-"], [f.headline, f.plain, `rule: ${f.rule}`, `where: ${f.locations.join(", ")}`, "from: refit-design", key(f)].join("\n"));
  held.add(id);
  console.log(`added ${id}`);
}
