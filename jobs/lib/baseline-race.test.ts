/**
 * baseline.json is rewritten whole by baseline() (factory.ts) and recordGreen() (landing.ts), each under a lock of
 * its own repo only. In one process the read and the write are synchronous and cannot race, so this test starts
 * P separate bun processes, half through each function, each for its own repo key, and in each of N rounds has them
 * all write at the same moment. It counts the rounds in which baseline.json lacks a key.
 * The same file is the worker when RACE_WORKER is set.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const P = 6, N = 200;

async function worker(): Promise<void> {
  const { baseline } = await import("./factory.ts");
  const { recordGreen } = await import("./landing.ts");
  const { loadRegistry } = await import("./ledger.ts");
  const [mode, key, path] = [process.env.RACE_WORKER!, process.env.RACE_KEY!, process.env.RACE_REPO!];
  const repo = { key, path, main: "main", setup: [], checks: [], manual: [], autoland: false, sandbox: false, held: [] } as unknown as Awaited<ReturnType<typeof loadRegistry>>[number];
  const spinTo = (t: number) => { while (Date.now() < t) { /* spin */ } };
  const { git } = await import("./git.ts");
  const commit = git(path, "rev-parse", "HEAD").out;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of Bun.stdin.stream()) {
    buf += decoder.decode(chunk);
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const t = Number(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (mode === "baseline") await baseline(repo, async () => { spinTo(t); return null; });
      else { spinTo(t); await recordGreen(repo, commit, () => {}); }
      process.stdout.write("done\n");
    }
  }
}

if (process.env.RACE_WORKER) {
  await worker();
} else {
  const { afterAll, beforeAll, expect, test } = await import("bun:test");
  const sh = (cwd: string, ...args: string[]) => {
    const p = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  };
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aleph-baseline-race-"));
    sh(dir, "git", "init", "-q", "--bare", "-b", "main", "origin.git");
    sh(dir, "git", "clone", "-q", "origin.git", "seed");
    sh(join(dir, "seed"), "git", "commit", "-q", "--allow-empty", "-m", "init");
    sh(join(dir, "seed"), "git", "push", "-q", "origin", "main");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test(`${P} processes write baseline.json at once for ${N} rounds and no entry is lost`, async () => {
    const env = {
      ...process.env, ALEPH_FACTORY_DIR: join(dir, "factory"), XDG_RUNTIME_DIR: join(dir, "run"),
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    };
    mkdirSync(env.ALEPH_FACTORY_DIR, { recursive: true });
    const file = join(env.ALEPH_FACTORY_DIR, "baseline.json");
    const keys = Array.from({ length: P }, (_, i) => `${i < P / 2 ? "baseline" : "green"}-${i}`);
    const procs = keys.map((key) => {
      sh(dir, "git", "clone", "-q", "origin.git", key);
      return Bun.spawn(["bun", import.meta.path], {
        env: { ...env, RACE_WORKER: key.startsWith("baseline") ? "baseline" : "green", RACE_KEY: key, RACE_REPO: join(dir, key) },
        stdin: "pipe", stdout: "pipe", stderr: "inherit",
      });
    });
    const readers = procs.map((p) => p.stdout.getReader());
    const lines = readers.map(() => "");
    const next = async (i: number) => { while (!lines[i].includes("\n")) { const r = await readers[i].read(); if (r.done) throw new Error(`worker ${keys[i]} ended`); lines[i] += new TextDecoder().decode(r.value); } lines[i] = lines[i].slice(lines[i].indexOf("\n") + 1); };
    let lossy = 0, lost = 0;
    try {
      for (let round = 0; round < N; round++) {
        writeFileSync(file, "{}\n");
        const at = Date.now() + 150;
        for (const p of procs) { p.stdin.write(`${at}\n`); p.stdin.flush(); }
        await Promise.all(procs.map((_, i) => next(i)));
        let have: Record<string, unknown> = {};
        try { have = JSON.parse(readFileSync(file, "utf8")); } catch { /* a torn file has lost every entry */ }
        const missing = keys.filter((k) => !(k in have));
        if (missing.length) { lossy++; lost += missing.length; }
      }
    } finally {
      for (const p of procs) { p.stdin.end(); p.kill(); }
    }
    console.log(`rounds with a lost entry: ${lossy} of ${N} (${lost} entries lost)`);
    expect(lossy).toBe(0);
  }, 300_000);
}
