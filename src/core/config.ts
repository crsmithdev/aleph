/**
 * TOML config: committed defaults <- per-host overlay <- ALEPH_* env overrides,
 * deep-merged, ${ENV} references resolved, then validated as one object.
 *
 * docs/design/phase-1.md §9. An unresolved ${VAR} is a boot failure, never an
 * empty string — a daemon that starts with no bot token and reports healthy is
 * exactly the silent failure this system exists to prevent.
 */
import { parse as parseToml } from "smol-toml";
import { readFileSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { resolve, dirname } from "node:path";
import { z } from "zod";
import { ConfigError } from "./errors.ts";

export const LANES = ["interactive", "control", "librarian", "heartbeat", "research", "synthesis", "backlog"] as const;
export type Lane = (typeof LANES)[number];

const LaneSchema = z.object({
  enabled: z.boolean().default(true),
  max_concurrent: z.number().int().positive().default(1),
  max_queue: z.number().int().positive().default(16),
});

const TierSchema = z.object({
  model: z.string(),
  enabled: z.boolean().default(true),
  backend: z.enum(["anthropic", "local", "modal"]).default("anthropic"),
});

const ClassSchema = z.object({
  tier: z.string(),
  ceiling: z.string(),
});

export const ConfigSchema = z.object({
  daemon: z.object({
    data_dir: z.string().default("./data"),
    vault_dir: z.string().default("../vault"),
    socket: z.string().default("./data/aleph.sock"),
    shutdown_grace_seconds: z.number().int().nonnegative().default(120),
    timezone: z.string().refine(isTimeZone, "not a valid IANA time zone").default("America/Los_Angeles"),
    tick_seconds: z.number().int().positive().default(30),
  }).prefault({}),

  telegram: z.object({
    enabled: z.boolean().default(false),
    api_base: z.string().default("https://api.telegram.org"),
    bot_token: z.string().default(""),
    chat_id: z.string().default(""),
    owner_user_id: z.string().default(""),
    poll_timeout_seconds: z.number().int().positive().default(50),
  }).prefault({}),

  obs: z.object({
    enabled: z.boolean().default(true),
    otlp_endpoint: z.string().default("http://127.0.0.1:3010/api/public/otel/v1/traces"),
    otlp_headers: z.record(z.string(), z.string()).default({}),
    langfuse_base_url: z.string().default("http://127.0.0.1:3010"),
    langfuse_project_id: z.string().default(""),
    service_name: z.string().default("aleph-daemon"),
    export_timeout_ms: z.number().int().positive().default(5000),
  }).prefault({}),

  sessions: z.object({
    resume_window_hours: z.number().positive().default(24),
    idle_hours: z.number().positive().default(24),
    archive_days: z.number().positive().default(7),
    checkpoint_every_turns: z.number().int().positive().default(5),
    max_active_topics: z.number().int().positive().default(6),
  }).prefault({}),

  meter: z.object({
    plan: z.string().default("max20x"),
    reserve: z.object({
      window_5h: z.number().min(0).max(1).default(0.30),
      weekly: z.number().min(0).max(1).default(0.25),
    }).prefault({}),
    capacity: z.object({
      window_5h: z.number().positive().default(4_000_000),
      weekly: z.number().positive().default(40_000_000),
    }).prefault({}),
    weights: z.object({
      input: z.number().nonnegative().default(1),
      output: z.number().nonnegative().default(5),
      cache_read: z.number().nonnegative().default(0.1),
      cache_creation: z.number().nonnegative().default(1.25),
    }).prefault({}),
  }).prefault({}),

  lanes: z.partialRecord(z.enum(LANES), LaneSchema).prefault({}),

  routing: z.object({
    default_tier: z.string().default("T2"),
    flex: z.number().int().nonnegative().default(1),
    escalate_after_failures: z.number().int().positive().default(2),
    tiers: z.record(z.string(), TierSchema).default({}),
    classes: z.record(z.string(), ClassSchema).default({}),
  }).prefault({}),

  vault: z.object({
    memory_max_lines: z.number().int().positive().default(150),
    commit_per_write: z.array(z.string()).default(["wiki/", "MEMORY.md", "index.md"]),
  }).prefault({}),

  retention: z.object({
    compress_after_days: z.number().int().positive().default(30),
  }).prefault({}),

  runner: z.enum(["sdk", "echo"]).default("sdk"),
});

export type Config = z.infer<typeof ConfigSchema>;

type Json = Record<string, unknown>;

function deepMerge(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    if (v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b)) {
      out[k] = deepMerge(b as Json, v as Json);
    } else out[k] = v;
  }
  return out;
}

/** Record which file supplied each leaf key, for `os config show --effective`. */
function trackSources(obj: Json, source: string, into: Record<string, string>, prefix = ""): void {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) trackSources(v as Json, source, into, path);
    else into[path] = source;
  }
}

/**
 * A typo here used to boot cleanly and then kill every `log/` write with an
 * uncaught RangeError from inside VaultWriter.today() — the zone is only used
 * at write time, so nothing surfaced it at startup. Config is the right place
 * to refuse it: an unusable value is a boot failure, like an unresolved ${VAR}.
 */
function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const ENV_REF = /^\$\{([A-Z0-9_]+)\}$/;

function resolveEnv(obj: unknown, env: Record<string, string | undefined>, path = ""): unknown {
  if (typeof obj === "string") {
    const m = ENV_REF.exec(obj);
    if (!m) return obj;
    const name = m[1]!;
    const value = env[name];
    if (value === undefined || value === "") {
      throw new ConfigError(`config references \${${name}} but it is not set in the environment`, path);
    }
    return value;
  }
  if (Array.isArray(obj)) return obj.map((v, i) => resolveEnv(v, env, `${path}[${i}]`));
  if (obj && typeof obj === "object") {
    const out: Json = {};
    for (const [k, v] of Object.entries(obj as Json)) out[k] = resolveEnv(v, env, path ? `${path}.${k}` : k);
    return out;
  }
  return obj;
}

/**
 * Harness variables that name no config key: they select the file, stamp the
 * build, or gate the live tests. Everything else prefixed ALEPH_ is a config
 * path — including a single-segment one like ALEPH_RUNNER, which addresses the
 * top-level `runner` key. Dropping those silently means a container can be told
 * `runner = "echo"` and quietly run the SDK instead.
 */
const NOT_CONFIG_KEYS = new Set(["ALEPH_CONFIG", "ALEPH_GIT_SHA", "ALEPH_LIVE", "ALEPH_VAULT"]);

/** ALEPH_DAEMON__DATA_DIR=... overrides daemon.data_dir; ALEPH_RUNNER=... overrides runner. */
function envOverrides(env: Record<string, string | undefined>): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith("ALEPH_") || v === undefined) continue;
    if (NOT_CONFIG_KEYS.has(k)) continue;
    const path = k.slice("ALEPH_".length).toLowerCase().split("__");
    if (path.length === 0 || path[0] === "") continue;
    let node = out;
    for (const seg of path.slice(0, -1)) {
      node[seg] ??= {};
      node = node[seg] as Json;
    }
    const leaf = path[path.length - 1]!;
    node[leaf] = v === "true" ? true : v === "false" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return out;
}

export interface LoadedConfig {
  config: Config;
  hash: string;
  sources: Record<string, string>;
  files: string[];
}

export function loadConfig(opts: {
  file?: string;
  host?: string;
  env?: Record<string, string | undefined>;
} = {}): LoadedConfig {
  const env = opts.env ?? process.env;
  const file = opts.file ?? resolve(process.cwd(), "config/aleph.toml");
  const sources: Record<string, string> = {};
  const files: string[] = [];

  if (!existsSync(file)) throw new ConfigError(`config file not found: ${file}`);
  let merged = parseToml(readFileSync(file, "utf8")) as Json;
  trackSources(merged, file, sources);
  files.push(file);

  const host = opts.host ?? hostname();
  const overlay = resolve(dirname(file), "hosts", `${host}.toml`);
  if (existsSync(overlay)) {
    const o = parseToml(readFileSync(overlay, "utf8")) as Json;
    trackSources(o, overlay, sources);
    merged = deepMerge(merged, o);
    files.push(overlay);
  }

  const fromEnv = envOverrides(env);
  if (Object.keys(fromEnv).length) {
    trackSources(fromEnv, "env", sources);
    merged = deepMerge(merged, fromEnv);
  }

  const resolved = resolveEnv(merged, env) as Json;

  const parsed = ConfigSchema.safeParse(resolved);
  if (!parsed.success) {
    const first = parsed.error.issues[0]!;
    throw new ConfigError(`invalid config at ${first.path.join(".")}: ${first.message}`, first.path.join("."));
  }

  // Hash the pre-env-resolution form so the hash never depends on secret values.
  const h = new Bun.CryptoHasher("sha256");
  h.update(JSON.stringify(merged));
  return { config: parsed.data, hash: h.digest("hex").slice(0, 16), sources, files };
}

/**
 * Lane defaults. `backlog` defaults to DISABLED in code, not merely in the
 * shipped config file: design v1.0 §2 calls it the largest silent consumer, and
 * a default that only holds when someone remembers to write the section is not
 * a default.
 */
export function laneConfig(config: Config, lane: Lane) {
  return config.lanes[lane] ?? LaneSchema.parse(lane === "backlog" ? { enabled: false } : {});
}
