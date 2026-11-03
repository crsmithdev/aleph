/**
 * Git fixtures for tests. A test process builds each named fixture once, the first time a test asks for it, and each
 * test then gets its own copy. In the copy, each git config that names the template's path (a clone's origin URL)
 * names the copy's path, so a clone in the copy pushes to the copy's remote.
 *
 * `bun test --parallel` runs several test files in one process, but gives each file new globals and never fires
 * `process.on("exit")`. So the templates are on disk, in a folder named by the process id and its start time, and
 * the first build in a process removes the folders of processes that are gone.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

const PREFIX = "aleph-fixture-";
/** The id of process `pid`: its pid and start time, so a new process that gets an old pid has another id. */
export function procId(pid: number | string): string | null {
  try {
    const st = readFileSync(`/proc/${pid}/stat`, "utf8");
    return `${pid}-${st.slice(st.lastIndexOf(")") + 2).split(" ")[19]}`;
  } catch {
    return null;
  }
}
const root = join(tmpdir(), PREFIX + procId(process.pid));

function sweep(): void {
  for (const name of readdirSync(tmpdir()).filter((n) => n.startsWith(PREFIX))) {
    const id = name.slice(PREFIX.length);
    if (procId(id.split("-")[0]) !== id) rmSync(join(tmpdir(), name), { recursive: true, force: true });
  }
}

/**
 * Copies the fixture `name` into `dest` (made if missing; files already in it stay). `build` makes the fixture in the
 * empty folder it gets; it runs once per test process, so every caller of one name must pass the same `build`.
 */
export function fixture(name: string, build: (dir: string) => void, dest: string): void {
  const dir = join(root, name);
  // The paths of the configs in the template that name the template, written next to it once it is complete.
  const list = `${dir}.configs.json`;
  if (!existsSync(list)) {
    if (!existsSync(root)) { sweep(); mkdirSync(root, { recursive: true }); }
    const tmp = mkdtempSync(join(root, `.${name}-`));
    build(tmp);
    const files = (readdirSync(tmp, { recursive: true }) as string[]).map((f) => join(tmp, f));
    // The sample hooks git puts in each repo do nothing; without them a copy has a third fewer files to write.
    for (const f of files.filter((f) => f.endsWith(".sample"))) rmSync(f);
    const configs = files.filter((f) => basename(f) === "config" && readFileSync(f, "utf8").includes(tmp));
    for (const f of configs) writeFileSync(f, readFileSync(f, "utf8").replaceAll(tmp, dir));
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
    writeFileSync(list, JSON.stringify(configs.map((f) => relative(tmp, f))));
  }
  const configs: string[] = JSON.parse(readFileSync(list, "utf8"));
  // `cp`, not fs.cpSync: as fast, and a test that empties PATH to make a setup fail still sees the setup fail.
  const p = Bun.spawnSync(["cp", "-r", `${dir}/.`, dest], { env: process.env, stdout: "ignore", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`cp ${dir} ${dest}: ${p.stderr}`);
  for (const f of configs) {
    const copy = join(dest, f);
    writeFileSync(copy, readFileSync(copy, "utf8").replaceAll(dir, dest));
  }
}

/** The empty work store in `dest`: `items.git` with its clone `items` (one empty commit "start" on main). */
export const storeRepos = (dest: string): void => fixture("store", buildStore, dest);
function buildStore(dir: string): void {
  sh(dir, "git", "init", "-q", "--bare", "-b", "main", join(dir, "items.git"));
  sh(dir, "git", "clone", "-q", join(dir, "items.git"), join(dir, "items"));
  sh(join(dir, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(dir, "items"), "git", "push", "-q", "origin", "main");
}

/** The factory's repos in `dest`: `repo.git` with its clone `repo` (one empty commit "init" on main), and the store of `storeRepos`. */
export const factoryRepos = (dest: string): void => fixture("factory", (dir) => {
  sh(dir, "git", "init", "-q", "--bare", "-b", "main", join(dir, "repo.git"));
  sh(dir, "git", "clone", "-q", join(dir, "repo.git"), join(dir, "repo"));
  sh(join(dir, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "init");
  sh(join(dir, "repo"), "git", "push", "-q", "origin", "main");
  buildStore(dir);
}, dest);

/** A new vault at `dest`, as `vault init` lays it out and commits it. */
export const vault = (dest: string): void => fixture("vault", (dir) => {
  const p = Bun.spawnSync(["bun", join(import.meta.dir, "..", "vault", "cli.ts"), "init"], { env: { ...process.env, ...gitEnv, ALEPH_VAULT: dir }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`vault init: ${p.stderr}`);
}, dest);
