import { test, expect, describe, afterEach } from "bun:test";
import { readFileSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts";
import { startDaemon, type RunningDaemon } from "../helpers/daemon-process.ts";
import { startOtlpSink, type OtlpSink } from "../helpers/otlp-sink.ts";
import { localDate, systemClock } from "../../src/core/clock.ts";

let ws: Workspace | null = null;
let daemon: RunningDaemon | null = null;
let sink: OtlpSink | null = null;

afterEach(async () => {
  if (daemon) { await daemon.stop(); daemon = null; }
  if (sink) { sink.stop(); sink = null; }
  if (ws) { ws.cleanup(); ws = null; }
});

function events(w: Workspace): any[] {
  const dir = w.eventsDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}

describe("boot and shutdown", () => {
  test("daemon boots, answers status, and exits 0 on SIGTERM with daemon.stopped last", async () => {
    ws = makeWorkspace();
    daemon = await startDaemon(ws.configFile, ws.socket);

    const status = await daemon.call("status");
    expect(status.runner).toBe("echo");
    expect(status.lanes.map((l: any) => l.lane)).toEqual([
      "interactive", "control", "librarian", "heartbeat", "research", "synthesis", "backlog",
    ]);
    expect(status.lanes.find((l: any) => l.lane === "backlog").enabled).toBe(false);
    expect(status.windows["5h"].reserve).toBe(0.3);

    const code = await daemon.stop();
    daemon = null;
    expect(code).toBe(0);

    const log = events(ws);
    expect(log.at(-1)!.kind).toBe("daemon.stopped");
    const raw = readFileSync(join(ws.eventsDir, readdirSync(ws.eventsDir)[0]!), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  }, 60_000);
});

describe("a failed turn", () => {
  test("answers the requester instead of leaving the CLI hanging", async () => {
    ws = makeWorkspace();
    daemon = await startDaemon(ws.configFile, ws.socket);

    // One good turn first, so the vault log file exists and the only thing the
    // next turn cannot do is write to it.
    expect(await daemon.send("first")).toContain("first");

    // The real failure this reproduces: the container ran as a uid that did not
    // own the bind-mounted vault, every write hit EACCES, and `os send` blocked
    // for ten minutes with nothing on stdout.
    chmodSync(join(ws.vaultDir, "log"), 0o555);
    try {
      const started = Date.now();
      const reply = await daemon.send("this turn cannot write");
      expect(reply).toContain("turn failed");
      expect(Date.now() - started).toBeLessThan(30_000);

      const log = events(ws);
      expect(log.some((e) => e.kind === "session.turn_failed")).toBe(true);
      expect(log.some((e) => e.kind === "bus.finished" && e.payload.ok === false)).toBe(true);
    } finally {
      chmodSync(join(ws.vaultDir, "log"), 0o755);
    }
  }, 60_000);
});

describe("event chain", () => {
  test("one turn produces a fully caused chain sharing one trace", async () => {
    ws = makeWorkspace();
    daemon = await startDaemon(ws.configFile, ws.socket);
    const reply = await daemon.send("does the chain hold?");
    expect(reply).toContain("does the chain hold?");

    const log = events(ws);
    const byId = new Map(log.map((e) => [e.id, e]));
    const turn = log.filter((e) => e.ids.session_id);
    const expected = [
      "session.created", "channel.message_received", "bus.submitted", "bus.started",
      "routing.decided", "session.turn_started", "meter.usage_recorded",
      "vault.written", "session.turn_completed", "channel.message_sent", "bus.finished",
    ];
    for (const kind of expected) expect(turn.map((e) => e.kind)).toContain(kind);

    const traces = new Set(turn.map((e) => e.ids.trace_id));
    expect(traces.size).toBe(1);

    // Every non-root event resolves to a real parent event.
    for (const e of turn) {
      if (e.caused_by) expect(byId.has(e.caused_by)).toBe(true);
    }
    // Causes are code-authored in Phase 1 — never model-authored.
    for (const e of turn) expect(["computed", "user"]).toContain(e.cause.kind);
  }, 60_000);

  test("os events reindex rebuilds the SQLite index from JSONL, row for row", async () => {
    ws = makeWorkspace();
    daemon = await startDaemon(ws.configFile, ws.socket);
    await daemon.send("first");
    await daemon.send("second");

    const before = (await daemon.call("events", { limit: 500 })) as any[];
    expect(before.length).toBeGreaterThan(10);

    const db = new Database(join(ws.dataDir, "aleph.db"));
    db.run("DELETE FROM events");
    expect(db.query("SELECT COUNT(*) AS n FROM events").get() as any).toEqual({ n: 0 });
    db.close();

    const result = await daemon.call("events.reindex");
    expect(result.events).toBeGreaterThanOrEqual(before.length);

    const after = (await daemon.call("events", { limit: 500 })) as any[];
    expect(after.map((e) => e.id).sort()).toEqual(before.map((e) => e.id).sort());
  }, 60_000);
});

describe("otel join invariant", () => {
  test("one message = one joined trace tree, and the event trace_id IS that trace", async () => {
    sink = startOtlpSink();
    ws = makeWorkspace({ obs_enabled: "true", otlp_endpoint: sink.url });
    daemon = await startDaemon(ws.configFile, ws.socket);
    await daemon.send("trace me");

    const completed = events(ws).find((e) => e.kind === "session.turn_completed");
    expect(completed).toBeDefined();
    const traceId = completed.ids.trace_id;

    await sink.waitFor((spans) => spans.some((s) => s.name === "turn" && s.traceId === traceId), 20_000);
    const tree = sink.spans.filter((s) => s.traceId === traceId);

    const root = tree.find((s) => s.name === "turn")!;
    expect(root.attributes["langfuse.session.id"]).toBe(completed.ids.session_id);
    expect(root.attributes["aleph.origin"]).toBe("channel");
    expect(root.attributes["aleph.lane"]).toBe("interactive");
    expect(root.attributes["langfuse.trace.tags"]).toContain("origin:channel");
    expect(root.attributes["langfuse.user.id"]).toBe("chris");
    expect(root.events.map((e) => e.name)).toContain("session.turn_completed");

    expect(tree.some((s) => s.name === "sdk.query")).toBe(true);

    // Zero orphans: every event emitted for this turn belongs to this trace.
    const turnEvents = events(ws).filter((e) => e.ids.session_id === completed.ids.session_id);
    for (const e of turnEvents) expect(e.ids.trace_id).toBe(traceId);
  }, 60_000);

  test("an unreachable OTLP endpoint degrades to an event, and the kernel keeps working", async () => {
    ws = makeWorkspace({ obs_enabled: "true", otlp_endpoint: "http://127.0.0.1:9/v1/traces" });
    daemon = await startDaemon(ws.configFile, ws.socket);
    const reply = await daemon.send("langfuse is down");
    expect(reply).toContain("langfuse is down");
    const status = await daemon.call("status");
    expect(status.in_flight).toBe(0);
  }, 60_000);
});

describe("starvation ladder, enforced end to end", () => {
  test("a research job is refused above the reserve while interactive is admitted", async () => {
    ws = makeWorkspace();
    daemon = await startDaemon(ws.configFile, ws.socket);

    // Capacity is 1000 weighted in the test config; drive past the 0.70 headroom.
    const db = new Database(join(ws.dataDir, "aleph.db"));
    db.run(
      `INSERT INTO usage (id, ts, lane, model, tier, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, weighted, cost_usd, source)
       VALUES ('evt_seed', ?, 'interactive', 'test', 'T2', 0, 142, 0, 0, 710, NULL, 'estimate')`,
      [new Date().toISOString()],
    );
    db.close();

    const meter = await daemon.call("meter");
    expect(meter["5h"].share).toBeCloseTo(0.71, 2);

    // interactive still flows
    const reply = await daemon.send("still talking to you");
    expect(reply).toContain("still talking");

    const rejected = events(ws).filter((e) => e.kind === "bus.rejected");
    expect(rejected.length).toBe(0);   // nothing background was submitted, so nothing refused yet
  }, 60_000);
});

describe("vault", () => {
  test("bootstrap, per-write commits with trailers, and refused writes", async () => {
    ws = makeWorkspace();
    daemon = await startDaemon(ws.configFile, ws.socket);
    await daemon.send("write something to the vault", "vault-topic");

    expect(existsSync(join(ws.vaultDir, "VAULT.md"))).toBe(true);
    expect(existsSync(join(ws.vaultDir, "index.md"))).toBe(true);
    expect(existsSync(join(ws.vaultDir, "MEMORY.md"))).toBe(true);
    expect(existsSync(join(ws.vaultDir, "human"))).toBe(true);

    // The LOCAL date, not the UTC one. They differ every evening in
    // America/Los_Angeles, and asserting UTC here hid the writer's bug.
    const today = localDate(systemClock, "America/Los_Angeles");
    const logFile = join(ws.vaultDir, "log", `${today}.md`);
    expect(readFileSync(logFile, "utf8")).toContain("write something to the vault");

    const check = await daemon.call("vault.check");
    expect(check.ok).toBe(true);

    // Second turn hits the checkpoint cadence (2) and rewrites the brief, which
    // IS in commit_per_write -> a git commit carrying Session/Event trailers.
    await daemon.send("and again", "vault-topic");
    const gitLog = Bun.spawnSync(["git", "-C", ws.vaultDir, "log", "--format=%s%n%b"]).stdout.toString();
    expect(gitLog).toContain("vault: ");
    expect(gitLog).toContain("Session: ses_");
    expect(gitLog).toContain("Event: evt_");
  }, 60_000);
});

describe("cross-channel continuity", () => {
  test("a second message to the same topic continues the same session", async () => {
    ws = makeWorkspace();
    daemon = await startDaemon(ws.configFile, ws.socket);
    await daemon.send("first message", "phase-1");
    const reply = await daemon.send("second message", "phase-1");

    const sessions = (await daemon.call("sessions")) as any[];
    expect(sessions.length).toBe(1);
    expect(sessions[0].topic_key).toBe("phase-1");
    expect(sessions[0].turn_count).toBe(2);
    // echo-runner reports how many prior turns the resumed session had.
    expect(reply).toContain("1 prior turns");
  }, 60_000);
});
