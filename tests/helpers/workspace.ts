/** Temp workspace + config for integration tests. Real files, real sockets. */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Workspace {
  root: string;
  configFile: string;
  dataDir: string;
  vaultDir: string;
  socket: string;
  eventsDir: string;
  cleanup(): void;
}

export function makeWorkspace(overrides: Record<string, string> = {}): Workspace {
  const root = mkdtempSync(join(tmpdir(), "aleph-test-"));
  const dataDir = join(root, "data");
  const vaultDir = join(root, "vault");
  const socket = join(dataDir, "aleph.sock");
  mkdirSync(dataDir, { recursive: true });

  const base = `runner = "echo"

[daemon]
data_dir = "${dataDir}"
vault_dir = "${vaultDir}"
socket = "${socket}"
shutdown_grace_seconds = 5
tick_seconds = 3600

[telegram]
enabled = false
api_base = "${overrides.telegram_api_base ?? "http://127.0.0.1:1"}"
bot_token = "test-token"
chat_id = "-100777"
owner_user_id = "42"
poll_timeout_seconds = 1

[obs]
enabled = ${overrides.obs_enabled ?? "false"}
otlp_endpoint = "${overrides.otlp_endpoint ?? "http://127.0.0.1:1/v1/traces"}"
langfuse_base_url = "http://127.0.0.1:3010"
langfuse_project_id = "test"

[sessions]
resume_window_hours = 24
idle_hours = 24
archive_days = 7
checkpoint_every_turns = 2

[meter]
plan = "max20x"
[meter.reserve]
window_5h = 0.30
weekly = 0.25
[meter.capacity]
window_5h = 1000
weekly = 100000
[meter.weights]
input = 1
output = 5
cache_read = 0.1
cache_creation = 1.25

[lanes.interactive]
enabled = true
max_concurrent = 1
max_queue = 8
[lanes.control]
enabled = true
[lanes.research]
enabled = true
[lanes.backlog]
enabled = false

[routing]
default_tier = "T2"
flex = 1
escalate_after_failures = 2
[routing.tiers]
T1 = { model = "test-haiku" }
T2 = { model = "test-sonnet" }
T3 = { model = "test-opus" }
[routing.classes]
conversation = { tier = "T2", ceiling = "T3" }
classify = { tier = "T1", ceiling = "T1" }

[vault]
memory_max_lines = 150
commit_per_write = ["wiki/", "MEMORY.md", "index.md"]

[retention]
compress_after_days = 30
`;
  const overridden = overrides.telegram_enabled === "true" ? base.replace("[telegram]\nenabled = false", "[telegram]\nenabled = true") : base;
  const configFile = join(root, "aleph.toml");
  writeFileSync(configFile, overridden);

  return {
    root, configFile, dataDir, vaultDir, socket,
    eventsDir: join(dataDir, "events"),
    cleanup() { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } },
  };
}
