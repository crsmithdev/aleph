/**
 * Real SQLite, real vault on disk, real git — but a fake clock, because the
 * resume/rehydrate/archive boundaries are pure clock arithmetic and waiting 25
 * hours is not a test strategy.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/platform/db.ts";
import { EventLog } from "../../src/core/eventlog.ts";
import { Emitter, setEmitter } from "../../src/core/emit.ts";
import { FakeClock } from "../../src/core/clock.ts";
import { loadConfig } from "../../src/core/config.ts";
import { Meter } from "../../src/core/meter.ts";
import { Router } from "../../src/routing/router.ts";
import { SessionStore } from "../../src/sessions/store.ts";
import { Lifecycle } from "../../src/sessions/lifecycle.ts";
import { EchoRunner } from "../../src/sessions/echo-runner.ts";
import { VaultWriter } from "../../src/vault/writer.ts";
import { bootstrapVault } from "../../src/vault/bootstrap.ts";
import { startOtel } from "../../src/obs/otel.ts";
import { newTraceId } from "../../src/core/ids.ts";
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts";
import { parseBrief } from "../../src/sessions/brief.ts";
import { VaultDenied } from "../../src/core/errors.ts";

let ws: Workspace;
let harness: ReturnType<typeof build>;

function build(w: Workspace, iso = "2026-08-20T09:00:00.000Z") {
  const { config } = loadConfig({ file: w.configFile, host: "none", env: {} });
  const clock = new FakeClock(Date.parse(iso));
  const db = openDb(join(w.dataDir, "aleph.db"));
  const log = new EventLog({ dir: w.eventsDir, db, clock, fsyncIntervalMs: 0 });
  const kinds: string[] = [];
  setEmitter(new Emitter({ log, clock, strict: true, onEvent: (e) => kinds.push(e.kind) }));
  bootstrapVault(w.vaultDir, { now: clock.iso() });
  const vault = new VaultWriter({ root: w.vaultDir, memoryMaxLines: config.vault.memory_max_lines, commitPerWrite: config.vault.commit_per_write });
  const store = new SessionStore(db, clock);
  const otel = startOtel({ enabled: false, endpoint: "", serviceName: "test" });
  const lifecycle = new Lifecycle({
    store, runner: new EchoRunner(), router: new Router(config), meter: new Meter(db, config, clock),
    vault, config, clock, tracer: otel.tracer, naming: { baseUrl: "http://lf", projectId: "test" },
  });
  return { config, clock, db, log, store, vault, lifecycle, kinds };
}

beforeEach(() => { ws = makeWorkspace(); harness = build(ws); });
afterEach(() => { harness.log.close(); harness.db.close(); ws.cleanup(); });

const ids = (sessionId: string) => ({ origin: "channel" as const, session_id: sessionId, trace_id: newTraceId() });

describe("resume vs rehydrate", () => {
  test("first turn is fresh; a turn one hour later resumes the SDK session", async () => {
    const s = harness.store.create("phase one");
    const first = await harness.lifecycle.runTurn({ session: s, text: "one", lane: "interactive", ids: ids(s.id), channel: "cli" });
    expect(first.resume_mode).toBe("fresh");

    harness.clock.advance(3_600_000);
    const again = harness.store.get(s.id)!;
    const second = await harness.lifecycle.runTurn({ session: again, text: "two", lane: "interactive", ids: ids(s.id), channel: "cli" });
    expect(second.resume_mode).toBe("resumed");
    expect(second.reply).toContain("1 prior turns");
    expect(harness.kinds).toContain("session.resumed");
  });

  test("past the 24h window it rehydrates from the checkpoint instead of resuming", async () => {
    const s = harness.store.create("phase one");
    await harness.lifecycle.runTurn({ session: s, text: "one", lane: "interactive", ids: ids(s.id), channel: "cli" });
    harness.lifecycle.checkpoint(harness.store.get(s.id)!, ids(s.id), undefined, { stands: "we decided on Bun" });

    harness.clock.advance(25 * 3_600_000);
    const aged = harness.store.get(s.id)!;
    const out = await harness.lifecycle.runTurn({ session: aged, text: "still there?", lane: "interactive", ids: ids(s.id), channel: "cli" });

    expect(out.resume_mode).toBe("rehydrated");
    // The echo runner reports what it was seeded with: a fresh SDK session that
    // nonetheless received the brief.
    expect(out.reply).toContain("0 prior turns");
    expect(out.reply).toContain("seed=brief");

    const rehydrated = JSON.parse(
      Bun.spawnSync(["grep", "-h", "session.rehydrated", `${ws.eventsDir}/${harness.clock.iso().slice(0, 10)}.jsonl`]).stdout.toString().trim().split("\n")[0]!,
    );
    expect(rehydrated.payload.seeded_with).toContain("MEMORY.md");
    expect(rehydrated.cause.text).toContain("resume window");
  });
});

describe("checkpointing", () => {
  test("the brief is rewritten on cadence and is what a rehydrated session reads", async () => {
    const s = harness.store.create("phase one");
    await harness.lifecycle.runTurn({ session: s, text: "one", lane: "interactive", ids: ids(s.id), channel: "cli" });
    await harness.lifecycle.runTurn({ session: harness.store.get(s.id)!, text: "two", lane: "interactive", ids: ids(s.id), channel: "cli" });

    const path = harness.store.get(s.id)!.checkpoint_path!;
    expect(existsSync(join(ws.vaultDir, path))).toBe(true);
    const brief = parseBrief(harness.vault.read(path));
    expect(brief.session_id).toBe(s.id);
    expect(brief.turns).toBe(2);
    expect(harness.kinds).toContain("session.checkpointed");
  });
});

describe("archival sweep", () => {
  test("active -> idle at 24h, archived at the archive_days boundary", async () => {
    const s = harness.store.create("phase one");
    await harness.lifecycle.runTurn({ session: s, text: "one", lane: "interactive", ids: ids(s.id), channel: "cli" });

    harness.clock.advance(25 * 3_600_000);
    expect(harness.lifecycle.sweep({ origin: "system", trace_id: newTraceId() }).idled).toContain(s.id);
    expect(harness.store.get(s.id)!.state).toBe("idle");

    harness.clock.advance(8 * 86_400_000);
    expect(harness.lifecycle.sweep({ origin: "system", trace_id: newTraceId() }).archived).toContain(s.id);
    expect(harness.store.get(s.id)!.state).toBe("archived");
    expect(harness.kinds).toContain("session.archived");
  });
});

describe("vault prohibitions", () => {
  test("writes under human/ and to VAULT.md are refused and logged", () => {
    const tuple = { origin: "system" as const, trace_id: newTraceId() };
    for (const path of ["human/notes.md", "VAULT.md", "../escape.md"]) {
      expect(() => harness.vault.write(path, "nope", tuple)).toThrow(VaultDenied);
    }
    expect(harness.kinds.filter((k) => k === "vault.write_denied").length).toBeGreaterThanOrEqual(2);
  });

  test("MEMORY.md over the line budget is refused, not silently trimmed", () => {
    const tuple = { origin: "system" as const, trace_id: newTraceId() };
    const before = harness.vault.read("MEMORY.md");
    expect(() => harness.vault.write("MEMORY.md", Array.from({ length: 151 }, (_, i) => `line ${i}`).join("\n"), tuple))
      .toThrow(/memory_line_budget/);
    expect(harness.vault.read("MEMORY.md")).toBe(before);
    expect(harness.vault.write("MEMORY.md", "just a few\nlines\n", tuple).sha256).toHaveLength(64);
  });

  test("log/ writes are confined to today's file", () => {
    const tuple = { origin: "system" as const, trace_id: newTraceId() };
    expect(() => harness.vault.write("log/1999-01-01.md", "x", tuple)).toThrow(/log_not_today/);
  });
});
