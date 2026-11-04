/**
 * `aleph sandbox probe`: criterion 11 of the seed spec, run from inside the
 * same profile a worker gets. Each private place must be out of reach, and
 * `claude -p` and the repo's tests must work.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gitPrelude, q } from "./agent-call.ts";
import { fetchOrigin, git } from "./git.ts";
import { type Repo } from "./ledger.ts";
import { makeRunFolder, removeRunFolder, sandboxed, workerToken } from "./sandbox.ts";
import { saveProbe, type Probe } from "./factory-status.ts";
import { clockStart, SKEW_LIMIT_MS, STEP_LIMIT_MS, wallStepSince, windowsSkew } from "./clock.ts";

function tailnet(): string {
  // Bun.spawnSync throws when the command is not on PATH, as on CI.
  const p = Bun.which("tailscale") ? Bun.spawnSync(["tailscale", "ip", "-4"], { stdout: "pipe", stderr: "ignore" }) : null;
  return p?.exitCode === 0 ? p.stdout.toString().trim().split("\n")[0] : process.env.ALEPH_PROBE_TAILNET ?? "100.68.96.43";
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
    // The probe runs with Unix sockets allowed, as the Chrome steps do: the host's own sockets must stay out of reach.
    [`user D-Bus socket`, `bun -e ${q(`const s=require("net").connect({path:"/run/user/${process.getuid?.() ?? 1000}/bus"});s.on("connect",()=>process.exit(0));s.on("error",()=>process.exit(1));setTimeout(()=>process.exit(1),3000)`)}`],
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

/** The last non-empty lines of a stderr text, at most `max` characters, cut from the front. */
export function lastLines(text: string, max = 300): string {
  const t = text.split("\n").map((l) => l.trim()).filter(Boolean).join(" | ");
  return t.length > max ? "…" + t.slice(t.length - max + 1) : t;
}

/** What the clocks did during the probe: a wall clock step against the monotonic clock, or Windows time apart from WSL. */
function clockFault(start: { wall: number; mono: number }): string | null {
  const step = wallStepSince(start);
  if (Math.abs(step) > STEP_LIMIT_MS) return `clock stepped ${Math.round(step)} ms during the probe`;
  const skew = windowsSkew();
  if (skew !== null && Math.abs(skew) > SKEW_LIMIT_MS) return `clock ${Math.round(skew / 1000)} s from Windows time`;
  return null;
}

/** `fault` reads the clocks at the end of the probe; the tests pass one that does not read the real clocks. */
export async function probe(repo: Repo, log: string, fault: typeof clockFault = clockFault): Promise<ProbeResult> {
  // Test hook: ALEPH_PROBE_FAKE=pass|fail records that result without running the sandbox.
  const fake = process.env.ALEPH_PROBE_FAKE;
  if (fake === "pass" || fake === "fail") {
    const failed = fake === "pass" ? [] : ["faked"];
    const commit = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
    const p = { at: new Date().toISOString(), ok: !failed.length, failed, repo: repo.key, ...(commit ? { commit } : {}) };
    saveProbe(p);
    return { ...p, results: [] };
  }
  const started = clockStart();
  const dir = makeRunFolder(`probe-${Date.now()}`);
  try {
    fetchOrigin(repo.path);
    git(repo.path, "bundle", "create", join(dir, "in.bundle"), `refs/remotes/origin/${repo.main}`);
    const main = `refs/remotes/origin/${repo.main}`;
    const commit = git(repo.path, "rev-parse", main).out;
    writeFileSync(log, "");
    writeFileSync(`${log}.stderr`, "");
    const script = [
      ...denied().map(([name, cmd]) => `if ( ${cmd} ) >/dev/null 2>&1; then echo "FAIL ${name}: reachable"; else echo "PASS ${name}: denied"; fi`),
      // The Unix sockets Chrome needs work inside, so "user D-Bus socket: denied" is the namespace's doing, not the filter's.
      `if bun -e ${q(`require("net").createServer().listen(process.env.TMPDIR+"/probe.sock",()=>process.exit(0)).on("error",()=>process.exit(1))`)} >/dev/null 2>&1; then echo "PASS unix sockets: allowed"; else echo "FAIL unix sockets: blocked"; fi`,
      `if claude -p 'say ok' --output-format json 2>/dev/null | grep -q '"is_error":false'; then echo "PASS claude -p: ok"; else echo "FAIL claude -p: no result"; fi`,
      `${gitPrelude("../in.bundle", [`+${main}:${main}`]).join(" && ")} && git switch -q -c probe ${q(`origin/${repo.main}`)} >&2`,
      `${repo.setup.join(" && ") || "true"} >&2`,
      // As the checks run it (CHECK_ENV in checks.ts): the sandbox has the host's zone, and some tests assume UTC.
      `if TZ=UTC bun test >&2; then echo "PASS bun test: passed"; else echo "FAIL bun test: failed"; fi`,
    ].join("\n");
    const step = await sandboxed(dir, script, {
      read: ["in.bundle"], write: ["home", "work", "tmp"], cwd: "work", env: { CLAUDE_CODE_OAUTH_TOKEN: workerToken() }, sockets: true,
      stdout: log, stderr: `${log}.stderr`, limit: 1200,
    });
    const results = readFileSync(log, "utf8").split("\n").filter((l) => /^(PASS|FAIL) /.test(l))
      .map((l) => ({ name: l.slice(5, l.lastIndexOf(": ")), ok: l.startsWith("PASS") }));
    const expected = denied().length + 3;
    const failed = failedChecks(results, expected, fault(started));
    if (results.length < expected) {
      const last = lastLines(readFileSync(`${log}.stderr`, "utf8"));
      failed[failed.length - 1] += ` (exit ${step.code}${step.timedOut ? ", time box ended it" : ""}${last ? `; stderr: ${last}` : ""})`;
    }
    const p = { at: new Date().toISOString(), ok: !failed.length, failed, repo: repo.key, ...(commit ? { commit } : {}) };
    saveProbe(p);
    return { ...p, results };
  } finally {
    removeRunFolder(dir);
  }
}
