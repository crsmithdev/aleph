/**
 * The keep-gate's second stage, run by bun in a clone of the head (see keepGate in checks.ts). It imports
 * nothing from aleph, because it runs in the target repo. The argument is a plan file: the new cases to judge,
 * the test files, the changed source lines and the mutants. A case earns its keep when it covers a changed line
 * that the other cases of the test files do not cover, or when it fails on a mutant that it passes without.
 * When the plan has no mutant, a case earns its keep when it runs a changed line that the load of the modules alone
 * does not run (bun marks such a line as run, with a count of 1, when no function ran): the line's count must beat the count with no case run.
 * The plan holds every mutant of the changed lines, and at most 10 run. The mutants of the lines that a new case runs beyond
 * the load come first, spread evenly; the mutants of the other changed lines, such as lines that only the load runs, fill the rest.
 * Each bun call has 60 seconds. After 300 seconds the stage stops and every case passes.
 * The last line of the output is `KEEP-EARN <json>`: the cases that did not earn their keep and the mutant count.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

export interface Plan {
  cases: { file: string; name: string }[];
  files: string[];
  /** Each changed source file and its changed line numbers on the head. */
  changed: Record<string, number[]>;
  mutants: { path: string; line: number; text: string }[];
}

const DEADLINE = Date.now() + 300_000;
const COV = ".keep-earn-cov";
const REPORT = ".keep-earn.xml";

const late = () => Date.now() > DEADLINE;
const bun = (args: string[]) => Bun.spawnSync(["timeout", "-k", "5", "60", "bun", "test", ...args], { stdout: "ignore", stderr: "ignore" });
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const id = (c: { file: string; name: string }) => `${c.file} > ${c.name}`;

/** The changed lines, as `path:line`, that one bun run of the test files with the name filter `filter` covers, with their counts. */
function covered(plan: Plan, filter: string): Map<string, number> {
  rmSync(COV, { recursive: true, force: true });
  bun(["--coverage", "--coverage-reporter=lcov", `--coverage-dir=${COV}`, "-t", filter, ...plan.files.map((f) => `./${f}`)]);
  const hit = new Map<string, number>();
  const lcov = `${COV}/lcov.info`;
  if (!existsSync(lcov)) return hit;
  let file = "";
  for (const l of readFileSync(lcov, "utf8").split("\n")) {
    if (l.startsWith("SF:")) file = l.slice(3);
    const m = /^DA:(\d+),(\d+)/.exec(l);
    if (m && Number(m[2]) > 0 && plan.changed[file]?.includes(Number(m[1]))) hit.set(`${file}:${m[1]}`, Number(m[2]));
  }
  return hit;
}

/** The cases that passed in bun's junit report, or null when a test file did not load: bun reports no case of such a file. */
function passed(files: string[]): Set<string> | null {
  if (!existsSync(REPORT)) return null;
  const xml = readFileSync(REPORT, "utf8");
  const reported = new Set([...xml.matchAll(/<testcase name="[^"]*"[^>]*?file="([^"]*)"/g)].map((m) => m[1]));
  if (files.some((f) => !reported.has(f))) return null;
  return new Set([...xml.matchAll(/<testcase name="([^"]*)"[^>]*?file="([^"]*)"[^>]*\/>/g)].map((m) => `${m[2]} > ${m[1]}`));
}

const plan: Plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const left = new Set(plan.cases.map(id));
const run = new Set<string>();
const loaded = covered(plan, "^$");
for (const c of plan.cases) {
  if (late()) break;
  // bun matches -t against the full name: the describe names and the case name, with spaces between.
  const name = `(?:^|.* )${esc(c.name)}$`;
  const alone = covered(plan, name);
  const others = covered(plan, `^(?!${name})`);
  const beyond = [...alone].filter(([l, n]) => n > (loaded.get(l) ?? 0)).map(([l]) => l);
  for (const l of beyond) run.add(l);
  if (plan.mutants.length ? [...alone.keys()].some((l) => !others.has(l)) : beyond.length) left.delete(id(c));
}
const spread = <T>(xs: T[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]));
const hit = spread(plan.mutants.filter((m) => run.has(`${m.path}:${m.line}`)), 10);
const picked = [...hit, ...spread(plan.mutants.filter((m) => !run.has(`${m.path}:${m.line}`)), 10 - hit.length)];
let ran = 0;
for (const m of picked) {
  if (!left.size || late()) break;
  const text = readFileSync(m.path, "utf8");
  const lines = text.split("\n");
  lines[m.line - 1] = m.text;
  writeFileSync(m.path, lines.join("\n"));
  rmSync(REPORT, { force: true });
  bun(["--reporter=junit", `--reporter-outfile=${REPORT}`, ...plan.files.map((f) => `./${f}`)]);
  writeFileSync(m.path, text);
  ran++;
  // A mutant that stops a test file from loading fails every case of it, so it shows nothing about one case.
  const ok = passed(plan.files);
  if (!ok) continue;
  for (const c of [...left]) if (!ok.has(c)) left.delete(c);
}
console.log(`KEEP-EARN ${JSON.stringify({ unearned: late() ? [] : [...left], mutants: ran })}`);
