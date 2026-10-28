/**
 * The nightly dependency sweep: `bun outdated` in a fresh clone of each
 * factory repo's origin/main, inside the sandbox. Each package whose latest
 * version is newer than the lockfile's becomes one item labelled
 * `proposal,deps` and never `goal`, so no run starts until Chris relabels it.
 * deps.json in the factory directory records what was proposed, and what the
 * report has not yet told. See docs/specs/2026-10-25-goal-to-shipped.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { file, readList } from "../../todo/lib/store.ts";
import { fetchOrigin, git } from "./git.ts";
import { factoryDir } from "./factory.ts";
import { type Repo } from "./ledger.ts";
import { makeRunFolder, removeRunFolder, sandboxed } from "./sandbox.ts";

export interface Proposal { name: string; current: string; latest: string }

/** The proposals in a `bun outdated` table: a package whose Latest is newer than its Current. */
export function parseOutdated(text: string): Proposal[] {
  const out: Proposal[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!/^[|│]/.test(t)) continue;
    const cells = t.split(/[|│]/).slice(1, -1).map((c) => c.trim());
    if (cells.length < 4 || cells[0] === "Package" || /^[-─┼├┤\s]*$/.test(cells[0])) continue;
    const name = cells[0].replace(/\s*\((dev|peer|optional)\)$/, "");
    const [current, latest] = [cells[1], cells[3]];
    if (name && newer(latest, current)) out.push({ name, current, latest });
  }
  return out;
}

/** Whether version `a` is newer than `b`, by their numeric parts; a pre-release tag is older than its release. */
function newer(a: string, b: string): boolean {
  const parts = (v: string) => v.replace(/^[^\d]*/, "").split(/[.+-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

interface Record_ { proposed: Record<string, number>; fresh: string[] }
const recordFile = () => join(factoryDir(), "deps.json");
function load(): Record_ {
  try { return { proposed: {}, fresh: [], ...JSON.parse(readFileSync(recordFile(), "utf8")) }; } catch { return { proposed: {}, fresh: [] }; }
}
function save(r: Record_): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(recordFile(), JSON.stringify(r, null, 2) + "\n");
}

/** `bun outdated` for `repo`'s origin/main, in a fresh clone in the sandbox. Null when it did not run. */
async function outdated(repo: Repo): Promise<string | null> {
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  const dir = makeRunFolder(`deps-${repo.key}`);
  const log = join(dir, "out", "outdated.log");
  try {
    const main = `refs/remotes/origin/${repo.main}`;
    fetchOrigin(repo.path);
    if (!git(repo.path, "bundle", "create", join(dir, "in.bundle"), main).ok) return null;
    writeFileSync(log, "");
    const script = [
      `git init -q . && git fetch -q ../in.bundle ${q(`+${main}:${main}`)} && git switch -q -c deps ${q(`origin/${repo.main}`)} >&2 || exit 1`,
      `${repo.setup.join(" && ") || "true"} >&2`,
      process.env.ALEPH_OUTDATED_CMD ?? "bun outdated",
    ].join("\n");
    const step = await sandboxed(dir, script, { read: ["in.bundle"], write: ["home", "work", "tmp"], cwd: "work", stdout: log, stderr: `${log}.stderr`, limit: 600 });
    // bun outdated exits 0 whether or not packages are stale; a failure is no answer.
    return step.code === 0 && !step.timedOut ? readFileSync(log, "utf8") : null;
  } finally {
    removeRunFolder(dir);
  }
}

/** Files the proposals for one repo that were not proposed before; returns their titles. */
export function propose(repo: Repo, found: Proposal[]): string[] {
  const rec = load();
  const fresh = found.filter((p) => !(`${repo.key}:${p.name}@${p.latest}` in rec.proposed));
  if (!fresh.length) return [];
  const titleOf = (p: Proposal) => `Update ${p.name} ${p.current} to ${p.latest}`;
  const list = readList(repo);
  if (!list) throw new Error(`the work store has no list for ${repo.key}`);
  const had = new Map(list.items.map((i) => [i.title, i.id]));
  const missing = fresh.filter((p) => !had.has(titleOf(p)));
  const made = file(repo, "dependency proposals", missing.map((p) => ({
    title: titleOf(p), priority: "low", labels: ["proposal", "deps"],
    body: `Proposed by the nightly dependency sweep: \`bun outdated\` shows ${p.name} at ${p.current} in the lockfile and ${p.latest} as the latest.\nRelabel it \`goal\` to have the factory update it.\n`,
  })));
  if (made.length !== missing.length) return [];
  missing.forEach((p, i) => had.set(titleOf(p), made[i]));
  const titles: string[] = [];
  for (const p of fresh) {
    const id = had.get(titleOf(p))!;
    rec.proposed[`${repo.key}:${p.name}@${p.latest}`] = id;
    titles.push(`${repo.key}-${id} ${titleOf(p)}`);
  }
  rec.fresh.push(...titles);
  save(rec);
  return titles;
}

/**
 * The sweep over `repos`: what is new, filed. A repo whose `bun outdated` did not run is left for the next night.
 * A repo that throws is reported to `onError` as `deps <key>: <message>`, and the sweep goes on.
 */
export async function sweep(repos: Repo[], onError: (line: string) => void = () => {}): Promise<string[]> {
  const all: string[] = [];
  for (const repo of repos) {
    try {
      const text = await outdated(repo);
      if (text !== null) all.push(...propose(repo, parseOutdated(text)));
    } catch (e) {
      onError(`deps ${repo.key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return all;
}

/** The proposals the report has not told; each is then marked told. */
export function takeFresh(): string[] {
  const rec = load();
  if (!rec.fresh.length) return [];
  const lines = rec.fresh;
  save({ ...rec, fresh: [] });
  return lines;
}
