#!/usr/bin/env bun
/**
 * `os` — thin CLI over the daemon's Unix socket. docs/design/phase-1.md §12.
 * Human-readable by default, --json on everything.
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../core/config.ts";
import { cliRequest } from "../channels/cli/index.ts";
import { bootstrapVault } from "../vault/bootstrap.ts";
import { isRepo } from "../vault/git.ts";
import { openDb, journalMode } from "../platform/db.ts";
import { traceUrl } from "../obs/langfuse.ts";

const argv = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) flags[k!] = v;
    else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) flags[k!] = argv[++i]!;
    else flags[k!] = true;
  } else positional.push(a);
}

const json = Boolean(flags.json);
const configFile = String(flags.config ?? process.env.ALEPH_CONFIG ?? resolve(process.cwd(), "config/aleph.toml"));

function out(value: unknown, human?: (v: any) => string): void {
  if (json || !human) console.log(JSON.stringify(value, null, 2));
  else console.log(human(value));
}

function fail(message: string, code = 1): never {
  console.error(`os: ${message}`);
  process.exit(code);
}

function socketPath(): string {
  const { config } = loadConfig({ file: configFile });
  return resolve(config.daemon.socket);
}

async function call(op: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<unknown> {
  const path = socketPath();
  if (!existsSync(path)) fail(`daemon socket not found at ${path} — is the daemon running?`, 3);
  try {
    return await cliRequest(path, { op, args, ...extra });
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e), 4);
  }
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const commands: Record<string, () => Promise<void>> = {
  async status() {
    const s = (await call("status")) as any;
    out(s, (v) => [
      `daemon   pid ${v.pid}  up ${(v.uptime_ms / 1000).toFixed(0)}s  runner=${v.runner}  config ${v.config_hash}`,
      `windows  5h ${pct(v.windows["5h"].share)} of capacity (reserve ${pct(v.windows["5h"].reserve)})  weekly ${pct(v.windows.weekly.share)}${v.sentinel ? "  [SENTINEL]" : ""}`,
      `lanes    ${v.lanes.map((l: any) => `${l.lane}${l.enabled ? "" : "(off)"}:${l.running}/${l.queued}`).join("  ")}`,
      `sessions ${v.sessions} active   in-flight ${v.in_flight}`,
      `events   ${v.event_log}`,
      `otel     ${v.otel.endpoint} (${v.otel.export_errors} export errors)`,
    ].join("\n"));
  },

  async send() {
    const text = positional.slice(1).join(" ");
    if (!text) fail("nothing to send");
    const r = (await call("send", {}, { topic: flags.topic ? String(flags.topic) : undefined, text })) as any;
    out(r, (v) => v.text);
  },

  async sessions() {
    const rows = (await call("sessions", { all: Boolean(flags.all) })) as any[];
    out(rows, (v) => v.length === 0 ? "(no sessions)" : v.map((s: any) =>
      `${s.state.padEnd(8)} ${s.topic_key.padEnd(32)} turns=${String(s.turn_count).padEnd(4)} last=${s.last_turn_at ?? "never"}`).join("\n"));
  },

  async session() {
    const sub = positional[1];
    if (sub === "show") out(await call("session.show", { topic: positional[2] }));
    else if (sub === "archive") out(await call("session.archive", { topic: positional[2] }));
    else if (sub === "move") out(await call("session.move", { event_id: positional[2], topic: positional[3] }));
    else fail("usage: os session show|archive|move ...");
  },

  async events() {
    if (positional[1] === "reindex") { out(await call("events.reindex")); return; }
    const since = flags.since ? isoSince(String(flags.since)) : undefined;
    const rows = (await call("events", { since, kind: flags.kind, session: flags.session, trace: flags.trace, limit: flags.limit ?? 50 })) as any[];
    out(rows, (v) => v.map((e: any) =>
      `${e.ts}  ${e.kind.padEnd(28)} ${(e.session_id ?? "-").padEnd(30)} ${e.id}${e.caused_by ? ` <- ${e.caused_by}` : ""}`).join("\n"));
  },

  async trace() {
    const t = (await call("trace", { trace_id: positional[1] })) as any;
    out(t, (v) => `${v.url}\n${v.events.map((e: any) => `  ${e.ts}  ${e.kind}`).join("\n")}`);
  },

  async obs() {
    if (positional[1] !== "join-audit") fail("usage: os obs join-audit [--since 24h]");
    const since = isoSince(String(flags.since ?? "24h"));
    const r = (await call("obs.join_audit", { since })) as any;
    out(r, (v) => `traces ${v.traces}  orphans ${v.orphans}  baseline ${v.baseline}  delta ${v.delta}${v.delta ? `\n  unclassified: ${v.unexpected.map((u: any) => u.kinds.join("+")).join(", ")}` : ""}`);
    if (r.delta > 0) process.exit(1);
  },

  async meter() {
    const m = (await call("meter")) as any;
    out(m, (v) => Object.values(v).map((w: any) =>
      `${w.window.padEnd(7)} ${pct(w.share)} of ${w.capacity} weighted   reserve ${pct(w.reserve)}   ${w.exhausted ? "EXHAUSTED" : "ok"}`).join("\n"));
  },

  async lane() {
    const lane = positional[1];
    const enabled = flags.enable ? true : flags.disable ? false : undefined;
    if (!lane || enabled === undefined) fail("usage: os lane <name> --enable|--disable");
    out(await call("lane", { lane, enabled }));
  },

  async vault() {
    const sub = positional[1];
    if (sub === "init") {
      const { config } = loadConfig({ file: configFile });
      const root = resolve(String(flags.dir ?? config.daemon.vault_dir));
      const r = bootstrapVault(root, {});
      out(r, (v) => `vault at ${v.root}\n  ${v.alreadyExisted ? "already existed; " : ""}created ${v.created.length} entries\n  commit ${v.commit ?? "(none)"}`);
    } else if (sub === "check") {
      const r = (await call("vault.check")) as any;
      out(r, (v) => v.ok ? `vault ok (${v.root}, MEMORY.md ${v.memory_lines} lines)` : `problems:\n  ${v.problems.join("\n  ")}`);
      if (!r.ok) process.exit(1);
    } else fail("usage: os vault init|check");
  },

  async config() {
    const { config, hash, sources, files } = loadConfig({ file: configFile });
    if (flags.effective) out({ hash, files, sources, config });
    else out({ hash, files, config });
  },

  async doctor() {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

    let cfg: ReturnType<typeof loadConfig> | null = null;
    try { cfg = loadConfig({ file: configFile }); add("config", true, `${configFile} (${cfg.hash})`); }
    catch (e) { add("config", false, e instanceof Error ? e.message : String(e)); }

    if (cfg) {
      const dataDir = resolve(cfg.config.daemon.data_dir);
      try {
        const db = openDb(`${dataDir}/aleph.db`);
        add("database", journalMode(db) === "wal", `${dataDir}/aleph.db journal_mode=${journalMode(db)}`);
        db.close();
      } catch (e) { add("database", false, String(e)); }

      const vaultRoot = resolve(cfg.config.daemon.vault_dir);
      add("vault", existsSync(`${vaultRoot}/VAULT.md`), `${vaultRoot} ${existsSync(`${vaultRoot}/VAULT.md`) ? "" : "(run: os vault init)"}`);

      // A vault that is not a repo takes writes and silently keeps no history —
      // the failure mode a container hits when .git is left out of the mounts.
      add("vault-git", !existsSync(`${vaultRoot}/VAULT.md`) || isRepo(vaultRoot),
        isRepo(vaultRoot) ? "history on" : `${vaultRoot} is not a git repo — writes will not be committed`);

      const sock = resolve(cfg.config.daemon.socket);
      add("socket", existsSync(sock), existsSync(sock) ? sock : `${sock} (daemon not running)`);

      if (cfg.config.obs.enabled) {
        const reachable = await fetch(cfg.config.obs.otlp_endpoint, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(3000) })
          .then(() => true).catch(() => false);
        add("otlp", reachable, `${cfg.config.obs.otlp_endpoint}${reachable ? "" : " unreachable — traces will be dropped, kernel unaffected"}`);
        add("langfuse-link", Boolean(cfg.config.obs.langfuse_project_id), traceUrl({ baseUrl: cfg.config.obs.langfuse_base_url, projectId: cfg.config.obs.langfuse_project_id }, "0".repeat(32)));
      }
      add("telegram-config", !cfg.config.telegram.enabled || Boolean(cfg.config.telegram.bot_token && cfg.config.telegram.chat_id && cfg.config.telegram.owner_user_id),
        cfg.config.telegram.enabled ? "enabled" : "disabled");
      add("clock", Math.abs(Date.now() - Date.parse(new Date().toISOString())) < 1000, new Date().toISOString());
    }

    out(checks, (v) => v.map((c: any) => `${c.ok ? "ok  " : "FAIL"}  ${c.name.padEnd(16)} ${c.detail}`).join("\n"));
    if (checks.some((c) => !c.ok)) process.exit(1);
  },
};

function isoSince(spec: string): string {
  const m = /^(\d+)([smhd])$/.exec(spec);
  if (!m) return spec;
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]!]!;
  return new Date(Date.now() - Number(m[1]) * mult).toISOString();
}

const command = positional[0];
if (!command || command === "help" || flags.help) {
  console.log(`os — aleph-next control CLI

  os status                          daemon health, lanes, window shares
  os send [--topic <slug>] <text>    send into a topic (creates if absent)
  os sessions [--all]                list sessions
  os session show|archive <slug>
  os session move <event-id> <slug>  correct a topic inference (calibration)
  os events [--since 1h] [--kind k] [--session s] [--trace t] [--limit n]
  os events reindex                  rebuild the SQLite index from JSONL
  os trace <trace-id>                tuple + Langfuse deep link
  os obs join-audit [--since 24h]    orphan delta vs the classified baseline
  os meter [--json]                  window accumulators
  os lane <name> --enable|--disable
  os vault init [--dir path] | os vault check
  os config show [--effective]
  os doctor                          every precondition, one line each

Global: --json  --config <file>`);
  process.exit(0);
}

const handler = commands[command];
if (!handler) fail(`unknown command: ${command}`);
await handler();
