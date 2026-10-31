/**
 * `aleph sandbox probe`: criterion 11 of the seed spec, run from inside the
 * same profile a worker gets. Each private place must be out of reach, and
 * `claude -p` and the repo's tests must work.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetchOrigin, git } from "./git.ts";
import { type Repo } from "./ledger.ts";
import { makeRunFolder, removeRunFolder, sandboxed, workerToken } from "./sandbox.ts";
import { saveProbe, type Probe } from "./factory.ts";
import { clockStart, SKEW_LIMIT_MS, STEP_LIMIT_MS, wallStepSince, windowsSkew } from "./clock.ts";

function tailnet(): string {
  const p = Bun.spawnSync(["tailscale", "ip", "-4"], { stdout: "pipe", stderr: "ignore" });
  return p.exitCode === 0 ? p.stdout.toString().trim().split("\n")[0] : process.env.ALEPH_PROBE_TAILNET ?? "100.68.96.43";
}

/** Each must fail inside the sandbox. */
function denied(): [string, string][] {
  const h = homedir();
  const net = tailnet();
  return [
    ["read ~/.ssh", `ls ${h}/.ssh`],
    ["read ~/.claude", `ls ${h}/.claude`],
    // srt shows ~/.aleph as the empty mount points of the run's own allowed paths,
    // so the probe reads the folders that hold data.
    ["read ~/.aleph", `ls ${h}/.aleph/secrets || ls ${h}/.aleph/jobs || ls ${h}/.aleph/items || ls ${h}/.aleph/issues || ls ${h}/.aleph/vault`],
    ["docker socket", "curl -sf --max-time 3 --unix-socket /var/run/docker.sock http://x/version"],
    ["cmd.exe", "timeout 5 /mnt/c/Windows/System32/cmd.exe /c echo hi"],
    ["127.0.0.1:3010", "curl -sf --max-time 3 http://127.0.0.1:3010"],
    ["172.17.0.1:8421", "curl -sf --max-time 3 http://172.17.0.1:8421"],
    // Port 80 on the tailnet address answers the host (checked 27 Oct); 3010 does not.
    [`tailnet ${net}`, `curl -sf --max-time 3 http://${net}/`],
    // The proxy answers a denied host with 403, so -f is what makes it fail.
    ["https://example.com", "curl -sf --max-time 5 https://example.com"],
  ];
}

export interface ProbeResult extends Probe { results: { name: string; ok: boolean }[] }

/**
 * The probe's failed list. A suite run under a stepped clock fails for the clock, so when the clock
 * fault is set a failed `bun test` is reported as that fault and not as a test failure.
 */
export function failedChecks(results: { name: string; ok: boolean }[], expected: number, clockFault: string | null): string[] {
  const failed = results.filter((r) => !r.ok).map((r) => clockFault && r.name === "bun test" ? clockFault : r.name);
  if (results.length < expected) failed.push(`${expected - results.length} checks gave no answer`);
  return failed;
}

/** What the clocks did during the probe: a wall clock step against the monotonic clock, or Windows time apart from WSL. */
function clockFault(start: { wall: number; mono: number }): string | null {
  const step = wallStepSince(start);
  if (Math.abs(step) > STEP_LIMIT_MS) return `clock stepped ${Math.round(step)} ms during the probe`;
  const skew = windowsSkew();
  if (skew !== null && Math.abs(skew) > SKEW_LIMIT_MS) return `clock ${Math.round(skew / 1000)} s from Windows time`;
  return null;
}

export async function probe(repo: Repo, log: string): Promise<ProbeResult> {
  // Test hook: ALEPH_PROBE_FAKE=pass|fail records that result without running the sandbox.
  const fake = process.env.ALEPH_PROBE_FAKE;
  if (fake === "pass" || fake === "fail") {
    const failed = fake === "pass" ? [] : ["faked"];
    const p = { at: new Date().toISOString(), ok: !failed.length, failed };
    saveProbe(p);
    return { ...p, results: [] };
  }
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  const started = clockStart();
  const dir = makeRunFolder(`probe-${Date.now()}`);
  try {
    fetchOrigin(repo.path);
    git(repo.path, "bundle", "create", join(dir, "in.bundle"), `refs/remotes/origin/${repo.main}`);
    const main = `refs/remotes/origin/${repo.main}`;
    writeFileSync(log, "");
    const script = [
      ...denied().map(([name, cmd]) => `if ( ${cmd} ) >/dev/null 2>&1; then echo "FAIL ${name}: reachable"; else echo "PASS ${name}: denied"; fi`),
      `if claude -p 'say ok' --output-format json 2>/dev/null | grep -q '"is_error":false'; then echo "PASS claude -p: ok"; else echo "FAIL claude -p: no result"; fi`,
      `git init -q . && git fetch -q ../in.bundle ${q(`+${main}:${main}`)} && git switch -q -c probe ${q(`origin/${repo.main}`)} >&2`,
      `${repo.setup.join(" && ") || "true"} >&2`,
      `if bun test >&2; then echo "PASS bun test: passed"; else echo "FAIL bun test: failed"; fi`,
    ].join("\n");
    await sandboxed(dir, script, {
      read: ["in.bundle"], write: ["home", "work", "tmp"], cwd: "work", env: { CLAUDE_CODE_OAUTH_TOKEN: workerToken() },
      stdout: log, stderr: `${log}.stderr`, limit: 1200,
    });
    const results = readFileSync(log, "utf8").split("\n").filter((l) => /^(PASS|FAIL) /.test(l))
      .map((l) => ({ name: l.slice(5, l.lastIndexOf(": ")), ok: l.startsWith("PASS") }));
    const expected = denied().length + 2;
    const failed = failedChecks(results, expected, clockFault(started));
    const p = { at: new Date().toISOString(), ok: !failed.length, failed };
    saveProbe(p);
    return { ...p, results };
  } finally {
    removeRunFolder(dir);
  }
}
