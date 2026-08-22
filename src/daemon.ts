/**
 * Composition root. Boot order matters and is asserted by the boot events:
 * config -> db -> event log -> otel -> meter/bus -> vault -> sessions -> channels.
 * Channels start last, once everything they can produce work for is up.
 */
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { hostname } from "node:os";
import { trace } from "@opentelemetry/api";
import { openDb, journalMode, type Db } from "./platform/db.ts";
import { systemClock, type Clock } from "./core/clock.ts";
import { loadConfig, type Config, type Lane } from "./core/config.ts";
import { EventLog } from "./core/eventlog.ts";
import { Emitter, setEmitter, emit } from "./core/emit.ts";
import { newTraceId, slugify } from "./core/ids.ts";
import type { IdTuple } from "./core/envelope.ts";
import { Bus, type Job } from "./core/bus.ts";
import { Meter } from "./core/meter.ts";
import { startOtel, type Otel } from "./obs/otel.ts";
import { traceUrl, type LangfuseNaming } from "./obs/langfuse.ts";
import { Router } from "./routing/router.ts";
import { VaultWriter } from "./vault/writer.ts";
import { bootstrapVault } from "./vault/bootstrap.ts";
import { SessionStore, type SessionRow } from "./sessions/store.ts";
import { Lifecycle } from "./sessions/lifecycle.ts";
import type { AgentRunner } from "./sessions/runner.ts";
import { SdkRunner } from "./sessions/sdk-runner.ts";
import { EchoRunner } from "./sessions/echo-runner.ts";
import type { Channel, InboundMessage } from "./channels/channel.ts";
import { TelegramChannel } from "./channels/telegram/index.ts";
import { CliChannel, type CliRequest } from "./channels/cli/index.ts";
import { reindex } from "./core/eventlog.ts";
import { emitJoinAudit } from "./obs/join-audit.ts";

export interface DaemonOptions {
  configFile?: string;
  host?: string;
  runner?: AgentRunner;
  clock?: Clock;
  /** Test seam: force simple (non-batched) span export so assertions do not race. */
  otelSimple?: boolean;
}

export interface TurnJobPayload {
  message: InboundMessage;
  session_id: string;
  reply_to?: string;
  chat_id?: string;
  thread_id?: string;
}

/** Liveness cadence, in wall-clock time so it does not move when tick_seconds does. */
const LIVENESS_INTERVAL_MS = 10 * 60 * 1000;

export class Daemon {
  readonly config: Config;
  readonly configHash: string;
  readonly db: Db;
  readonly log: EventLog;
  readonly clock: Clock;
  readonly meter: Meter;
  readonly bus: Bus;
  readonly store: SessionStore;
  readonly lifecycle: Lifecycle;
  readonly vault: VaultWriter;
  readonly router: Router;
  readonly runner: AgentRunner;
  readonly otel: Otel;
  readonly naming: LangfuseNaming;
  private readonly channels: Channel[] = [];
  private telegram: TelegramChannel | null = null;
  private cli: CliChannel | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private readonly startedAt: number;
  private stopping = false;
  private lastLivenessAt = 0;

  constructor(opts: DaemonOptions = {}) {
    this.clock = opts.clock ?? systemClock;
    this.startedAt = this.clock.ms();

    const loaded = loadConfig({ file: opts.configFile ?? resolve(process.cwd(), "config/aleph.toml"), host: opts.host });
    this.config = loaded.config;
    this.configHash = loaded.hash;

    const dataDir = resolve(this.config.daemon.data_dir);
    this.db = openDb(join(dataDir, "aleph.db"));
    this.log = new EventLog({ dir: join(dataDir, "events"), db: this.db, clock: this.clock });
    // The emitter is installed twice on purpose: once before OTel exists (so a
    // config or DB failure is still recorded), then again with the tracer so
    // every event joins its trace tree.
    setEmitter(new Emitter({ log: this.log, clock: this.clock, strict: process.env.NODE_ENV !== "production" }));

    const rootIds = this.systemIds();
    emit("daemon.config_loaded", rootIds, { hash: loaded.hash, sources: loaded.sources }, {
      cause: { kind: "computed", text: `merged ${loaded.files.length} config file(s)`, source: "daemon.ts" },
    });
    this.bootStep("db", true, `journal_mode=${journalMode(this.db)}`);

    this.naming = {
      baseUrl: this.config.obs.langfuse_base_url,
      projectId: this.config.obs.langfuse_project_id,
      userId: "chris",
    };
    this.otel = startOtel({
      enabled: this.config.obs.enabled,
      endpoint: this.config.obs.otlp_endpoint,
      headers: this.config.obs.otlp_headers,
      serviceName: this.config.obs.service_name,
      timeoutMs: this.config.obs.export_timeout_ms,
      simple: opts.otelSimple,
      onExportError: (error, dropped) => this.onExportError(error, dropped),
    });
    setEmitter(new Emitter({ log: this.log, clock: this.clock, tracer: this.otel.tracer, strict: process.env.NODE_ENV !== "production" }));
    this.bootStep("otel", true, this.config.obs.enabled ? this.config.obs.otlp_endpoint : "disabled");

    this.meter = new Meter(this.db, this.config, this.clock);
    this.bus = new Bus(this.db, this.config, this.clock, this.meter);
    this.store = new SessionStore(this.db, this.clock);
    this.router = new Router(this.config);

    const vaultRoot = resolve(this.config.daemon.vault_dir);
    if (!existsSync(join(vaultRoot, "VAULT.md"))) bootstrapVault(vaultRoot, { now: this.clock.iso() });
    this.vault = new VaultWriter({
      root: vaultRoot,
      memoryMaxLines: this.config.vault.memory_max_lines,
      commitPerWrite: this.config.vault.commit_per_write,
      clock: this.clock,
      timezone: this.config.daemon.timezone,
    });
    this.bootStep("vault", true, vaultRoot);

    this.runner = opts.runner ?? (this.config.runner === "echo" ? new EchoRunner() : new SdkRunner());
    this.lifecycle = new Lifecycle({
      store: this.store, runner: this.runner, router: this.router, meter: this.meter,
      vault: this.vault, config: this.config, clock: this.clock,
      tracer: this.otel.tracer, naming: this.naming,
    });
    this.bus.on("turn.run", (job) => this.handleTurn(job as Job<TurnJobPayload>));
  }

  private systemIds(): IdTuple {
    return { origin: "system", trace_id: newTraceId() };
  }

  private bootStep(step: string, ok: boolean, detail?: string): void {
    emit("daemon.boot_step", this.systemIds(), { step, ok, detail, ms: this.clock.ms() - this.startedAt }, {
      cause: { kind: "computed", text: `boot step ${step} ${ok ? "ok" : "failed"}`, source: "daemon.ts:bootStep" },
    });
  }

  private exportErrorAt = 0;
  private onExportError(error: string, dropped: number): void {
    const now = this.clock.ms();
    if (now - this.exportErrorAt < 60_000) return;
    this.exportErrorAt = now;
    emit("obs.export_failed", this.systemIds(), { endpoint: this.config.obs.otlp_endpoint, error, dropped }, {
      cause: { kind: "computed", text: "OTLP export failed; kernel console continues (cockpit P4)", source: "daemon.ts:onExportError" },
    });
  }

  async start(): Promise<void> {
    emit("daemon.started", this.systemIds(), {
      version: "0.1.0", config_hash: this.configHash, pid: process.pid,
      git_sha: process.env.ALEPH_GIT_SHA,
    }, { cause: { kind: "computed", text: `daemon boot on ${hostname()}`, source: "daemon.ts:start" } });

    this.cli = new CliChannel({
      socketPath: resolve(this.config.daemon.socket),
      clock: this.clock,
      control: (req) => this.control(req),
    });
    await this.cli.start((m) => this.onMessage(m));
    this.channels.push(this.cli);
    this.bootStep("channel.cli", true, resolve(this.config.daemon.socket));

    if (this.config.telegram.enabled) {
      this.telegram = new TelegramChannel({
        token: this.config.telegram.bot_token,
        apiBase: this.config.telegram.api_base,
        chatId: this.config.telegram.chat_id,
        ownerUserId: this.config.telegram.owner_user_id,
        pollTimeoutSeconds: this.config.telegram.poll_timeout_seconds,
        clock: this.clock,
        loadOffset: () => Number(this.store.kvGet("telegram.offset") ?? 0),
        saveOffset: (o) => this.store.kvSet("telegram.offset", String(o)),
        onError: (where, error) => emit("channel.send_failed", this.systemIds(), {
          channel: "telegram", error: `${where}: ${error.message}`, attempts: 1,
        }, { cause: { kind: "computed", text: `telegram ${where} failed`, source: "daemon.ts" } }),
      });
      await this.telegram.start((m) => this.onMessage(m));
      this.channels.push(this.telegram);
      this.bootStep("channel.telegram", true, this.config.telegram.api_base);
    }

    this.tick = setInterval(() => this.onTick(), this.config.daemon.tick_seconds * 1000);
    this.tick.unref?.();
  }

  /**
   * Every task is guarded on its own. Unguarded, a throw in any one of them took
   * the other two with it and the only symptom was silence — the meter stopped
   * sweeping, sessions stopped ageing and the bus stopped pumping, all at once.
   * Phase 2a puts the approval TTL sweep here too, so the blast radius would
   * have grown to include the safety gate (docs/design/phase-2a.md §2.3).
   */
  private onTick(): void {
    if (this.stopping) return;
    const ids = this.systemIds();
    const tasks: Array<[string, () => void]> = [
      ["meter.sweep", () => this.meter.sweep(ids)],
      ["lifecycle.sweep", () => this.lifecycle.sweep(ids)],
      ["bus.pump", () => this.bus.pump()],
    ];

    let failed = 0;
    for (const [name, run] of tasks) {
      try {
        run();
      } catch (e) {
        failed++;
        // Emitting must not itself be able to kill the tick.
        try {
          emit("daemon.tick_failed", ids, { task: name, error: e instanceof Error ? e.message : String(e) }, {
            cause: { kind: "computed", text: `tick task ${name} threw; the other tasks still ran`, source: "daemon.ts:onTick" },
          });
        } catch { /* the log is already the thing that is broken */ }
      }
    }

    // Liveness the heartbeat can check, at a cadence that does not flood the log.
    const now = this.clock.ms();
    if (failed > 0 || now - this.lastLivenessAt >= LIVENESS_INTERVAL_MS) {
      this.lastLivenessAt = now;
      try {
        emit("daemon.tick", ids, { tasks_ok: tasks.length - failed, tasks_failed: failed }, {
          cause: { kind: "computed", text: `tick ran ${tasks.length - failed}/${tasks.length} tasks`, source: "daemon.ts:onTick" },
        });
      } catch { /* as above */ }
    }
  }

  /** Inbound from any channel: authorize, resolve topic, submit a turn job. */
  private async onMessage(message: InboundMessage): Promise<void> {
    const traceId = newTraceId();

    if (message.rejected) {
      emit("channel.message_received", { origin: "system", trace_id: traceId }, {
        channel: message.channel, message_id: message.id, text: "", rejected: message.rejected,
        external: message.external as Record<string, unknown>,
      }, { actor: "external", cause: { kind: "computed", text: `dropped: ${message.rejected}`, source: "daemon.ts:onMessage" } });
      return;
    }

    const resolved = this.resolveSession(message, traceId);
    const ids: IdTuple = { origin: "channel", session_id: resolved.session.id, trace_id: traceId };

    const received = emit("channel.message_received", ids, {
      channel: message.channel, message_id: message.id, text: message.text,
      external: message.external as Record<string, unknown>,
    }, {
      actor: "user",
      causedBy: resolved.causedBy,
      cause: { kind: "user", text: message.text.slice(0, 280), source: `${message.channel}:${message.external.message_id ?? message.id}` },
    });

    const payload: TurnJobPayload = {
      message, session_id: resolved.session.id,
      reply_to: message.channel === "cli" ? message.id : message.external.message_id,
      chat_id: message.external.chat_id,
      thread_id: resolved.threadId ?? message.external.thread_id,
    };

    const lane: Lane = "interactive";
    const result = this.bus.submit<TurnJobPayload>({
      lane, ids, kind: "turn.run", payload, serial_key: resolved.session.id, caused_by: received,
    });

    if (!result.accepted) {
      // Templated, zero-LLM refusal — the alert path never needs model tokens.
      await this.reply(payload, `Not right now: ${refusalText(result.reason)}`, ids, result.event_id);
    }
  }

  /** Topic inference — docs/design/phase-1.md §8.4. */
  private resolveSession(message: InboundMessage, traceId: string): { session: SessionRow; threadId?: string; causedBy?: string } {
    const key = message.external.thread_id ?? "";
    if (key) {
      const binding = this.store.binding(message.channel, key);
      if (binding) {
        const session = this.store.get(binding.session_id);
        if (session) return { session, threadId: key };
      }
      // The CLI's container key IS the topic slug (`os send --topic <slug>`),
      // so an unbound key that names a known topic binds to it rather than
      // forking a second session for the same topic. Restricted to the CLI on
      // purpose: a Telegram thread id is a number and could collide with a slug.
      if (message.channel === "cli") {
        const byTopic = this.store.byTopic(key);
        if (byTopic) {
          this.store.bind(message.channel, key, byTopic.id);
          return { session: byTopic, threadId: key };
        }
      }
    }

    const sysIds: IdTuple = { origin: "system", trace_id: traceId };
    const explicitNew = /^new:\s*/i.exec(message.text);
    const hashTag = /^#([a-z0-9-]+)\b/i.exec(message.text);

    if (hashTag) {
      const existing = this.store.byTopic(hashTag[1]!.toLowerCase());
      if (existing) {
        const cause = emit("session.topic_inferred", sysIds, {
          decision: "existing", title: existing.title, alternatives: [], rule: "explicit #slug prefix",
        }, { cause: { kind: "computed", text: `message began with #${hashTag[1]}`, source: "daemon.ts:resolveSession" } });
        if (key) this.store.bind(message.channel, key, existing.id, message.external.chat_id);
        return { session: existing, threadId: key || undefined, causedBy: cause };
      }
    }

    // Phase 1 rule: one topic per distinct project/question, and when in doubt
    // SPLIT. A wrongly-split topic is a merge later; a wrongly-merged topic
    // corrupts a session's context permanently.
    const title = explicitNew
      ? message.text.replace(/^new:\s*/i, "").split("\n")[0]!.slice(0, 80)
      : message.text.split("\n")[0]!.slice(0, 80) || "untitled";
    const alternatives = this.store.activeTitles().map((t) => t.topic_key);
    const rule = explicitNew ? "explicit new: prefix"
      : key ? "unbound channel container"
      : "default-to-new (no explicit target)";

    // An explicit CLI topic slug names the topic; otherwise derive it from the
    // first line of the message.
    const explicitKey = message.channel === "cli" && key ? slugify(key) : undefined;
    const session = this.store.create(title, { topicKey: explicitKey ?? slugify(title) });
    const inferred = emit("session.topic_inferred", sysIds, {
      decision: "new", title, alternatives, rule,
    }, { cause: { kind: "computed", text: `no binding for ${message.channel}:${key || "(none)"}; ${rule}`, source: "daemon.ts:resolveSession" } });

    const created = emit("session.created", { origin: "channel", session_id: session.id, trace_id: traceId }, {
      session_id: session.id, topic_key: session.topic_key, title: session.title, channel: message.channel,
    }, { causedBy: inferred, cause: { kind: "computed", text: `new topic ${session.topic_key}`, source: "daemon.ts:resolveSession" } });

    if (key) this.store.bind(message.channel, key, session.id, message.external.chat_id);
    return { session, threadId: key || undefined, causedBy: created };
  }

  private async handleTurn(job: Job<TurnJobPayload>): Promise<void> {
    const payload = job.payload;
    const session = this.store.get(payload.session_id)!;

    // A Telegram topic is created lazily, on the first turn of a session that
    // arrived through the General topic — so an aborted turn cannot litter the
    // group with empty topics.
    let threadId = payload.thread_id;
    if (this.telegram && payload.message.channel === "telegram" && !threadId) {
      const topic = await this.telegram.createTopic(session.title);
      threadId = topic.external_id;
      this.store.bind("telegram", threadId, session.id, topic.chat_id);
      emit("channel.topic_created", job.ids, { channel: "telegram", external_id: threadId, title: session.title }, {
        causedBy: job.caused_by, cause: { kind: "computed", text: `forum topic created for ${session.topic_key}`, source: "daemon.ts:handleTurn" },
      });
    }

    let out;
    try {
      out = await this.lifecycle.runTurn({
        session, text: payload.message.text, lane: job.lane, ids: job.ids,
        causedBy: job.caused_by, channel: payload.message.channel,
      });
    } catch (e) {
      // A failed turn still owes the requester an answer. `os send` blocks on a
      // reply that only arrives through the channel, so without this the CLI
      // hangs for the full 600 s timeout on every failure — silence that reads
      // as a hang rather than as the error it is. The throw is preserved so the
      // bus still records bus.finished ok:false.
      await this.reply({ ...payload, thread_id: threadId },
        `turn failed: ${e instanceof Error ? e.message : String(e)}`, job.ids, job.caused_by);
      throw e;
    }

    await this.reply({ ...payload, thread_id: threadId }, out.reply, job.ids, out.events.turnCompleted ?? job.caused_by);
  }

  private async reply(payload: TurnJobPayload, text: string, ids: IdTuple, causedBy?: string): Promise<void> {
    const channel = this.channels.find((c) => c.name === payload.message.channel);
    if (!channel) return;
    try {
      const sent = await channel.send({
        chat_id: payload.chat_id, thread_id: payload.thread_id, reply_to: payload.reply_to,
      }, { text });
      emit("channel.message_sent", ids, {
        channel: channel.name, external_id: sent.external_ids[0], parts: sent.parts, bytes: sent.bytes,
      }, { causedBy, cause: { kind: "computed", text: `reply delivered in ${sent.parts} part(s)`, source: "daemon.ts:reply" } });
    } catch (e) {
      emit("channel.send_failed", ids, {
        channel: channel.name, error: e instanceof Error ? e.message : String(e), attempts: 3,
      }, { causedBy, cause: { kind: "computed", text: "send failed after retries; the reply is still in the vault log", source: "daemon.ts:reply" } });
    }
  }

  /** `os` CLI control surface. */
  private async control(req: CliRequest): Promise<unknown> {
    const args = req.args ?? {};
    switch (req.op) {
      case "status": return {
        pid: process.pid,
        uptime_ms: this.clock.ms() - this.startedAt,
        config_hash: this.configHash,
        runner: this.runner.name,
        sentinel: this.meter.sentinel,
        in_flight: this.bus.inFlightCount,
        lanes: this.bus.snapshot(),
        windows: this.meter.windows(),
        sessions: this.store.list().length,
        event_log: this.log.currentFile(),
        otel: { endpoint: this.config.obs.otlp_endpoint, export_errors: this.otel.exportErrors() },
      };
      case "sessions": return this.store.list(Boolean(args.all));
      case "session.show": {
        const session = this.store.byTopic(String(args.topic));
        if (!session) throw new Error(`no session for topic ${args.topic}`);
        const brief = session.checkpoint_path && this.vault.exists(session.checkpoint_path)
          ? this.vault.read(session.checkpoint_path) : null;
        return {
          session,
          bindings: this.store.bindingsFor(session.id),
          brief,
          turns: this.db.query("SELECT * FROM turns WHERE session_id = ? ORDER BY started_at DESC LIMIT 10").all(session.id),
        };
      }
      case "session.archive": {
        const session = this.store.byTopic(String(args.topic));
        if (!session) throw new Error(`no session for topic ${args.topic}`);
        this.store.setState(session.id, "archived");
        for (const b of this.store.bindingsFor(session.id)) {
          if (b.channel === "telegram" && this.telegram) await this.telegram.closeTopic(b.external_id).catch(() => {});
        }
        emit("session.archived", { origin: "channel", session_id: session.id, trace_id: newTraceId() },
          { session_id: session.id, idle_days: 0 },
          { cause: { kind: "user", text: "archived from the os CLI", source: "cli" }, actor: "user" });
        return { archived: session.id };
      }
      case "session.move": {
        const eventId = String(args.event_id);
        const target = this.store.byTopic(String(args.topic));
        if (!target) throw new Error(`no session for topic ${args.topic}`);
        const row = this.db.query<{ session_id: string | null }, [string]>("SELECT session_id FROM events WHERE id = ?").get(eventId);
        if (!row?.session_id) throw new Error(`event ${eventId} has no session`);
        emit("session.topic_corrected", { origin: "channel", session_id: target.id, trace_id: newTraceId() },
          { from_session: row.session_id, to_session: target.id, event_id: eventId },
          { actor: "user", cause: { kind: "user", text: "topic inference corrected by Chris — calibration data", source: "cli" } });
        return { from: row.session_id, to: target.id };
      }
      case "events": {
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (args.since) { clauses.push("ts >= ?"); params.push(String(args.since)); }
        if (args.kind) { clauses.push("kind LIKE ?"); params.push(String(args.kind)); }
        if (args.session) { clauses.push("session_id = ?"); params.push(String(args.session)); }
        if (args.trace) { clauses.push("trace_id = ?"); params.push(String(args.trace)); }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const limit = Number(args.limit ?? 50);
        return this.db.query(`SELECT id, ts, kind, origin, session_id, trace_id, caused_by, actor, payload FROM events ${where} ORDER BY ts DESC, id DESC LIMIT ${limit}`).all(...(params as string[]));
      }
      case "events.reindex": {
        this.log.flush();
        return reindex(this.db, join(resolve(this.config.daemon.data_dir), "events"));
      }
      case "obs.join_audit": {
        const since = String(args.since ?? new Date(this.clock.ms() - 86_400_000).toISOString());
        return emitJoinAudit(this.db, this.systemIds(), since);
      }
      case "meter": return this.meter.windows();
      case "lane": {
        const lane = String(args.lane) as Lane;
        const laneCfg = this.config.lanes[lane];
        if (!laneCfg) throw new Error(`unknown lane ${lane}`);
        laneCfg.enabled = Boolean(args.enabled);
        return { lane, enabled: laneCfg.enabled };
      }
      case "trace": {
        const traceId = String(args.trace_id);
        return {
          trace_id: traceId,
          url: traceUrl(this.naming, traceId),
          events: this.db.query("SELECT id, ts, kind, session_id FROM events WHERE trace_id = ? ORDER BY ts").all(traceId),
        };
      }
      case "config": return { hash: this.configHash, config: this.config };
      case "vault.check": return this.vaultCheck();
      default: throw new Error(`unknown op: ${req.op}`);
    }
  }

  private vaultCheck() {
    const root = resolve(this.config.daemon.vault_dir);
    const problems: string[] = [];
    for (const required of ["VAULT.md", "index.md", "MEMORY.md"]) {
      if (!this.vault.exists(required)) problems.push(`missing ${required}`);
    }
    let memoryLines = 0;
    if (this.vault.exists("MEMORY.md")) {
      memoryLines = this.vault.read("MEMORY.md").split("\n").length;
      if (memoryLines > this.config.vault.memory_max_lines) problems.push(`MEMORY.md is ${memoryLines} lines (budget ${this.config.vault.memory_max_lines})`);
    }
    return { root, memory_lines: memoryLines, problems, ok: problems.length === 0 };
  }

  async stop(reason = "signal"): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.tick) clearInterval(this.tick);
    for (const channel of this.channels) await channel.stop().catch(() => {});
    const drained = await this.bus.drain(this.config.daemon.shutdown_grace_seconds * 1000);
    for (const session of this.store.list()) {
      if (session.turn_count > 0) {
        try { this.lifecycle.checkpoint(session, { origin: "channel", session_id: session.id, trace_id: newTraceId() }); }
        catch { /* checkpoint failure must not block shutdown */ }
      }
    }
    emit("daemon.stopped", this.systemIds(), {
      reason, uptime_ms: this.clock.ms() - this.startedAt, in_flight: drained ? 0 : this.bus.inFlightCount,
    }, { cause: { kind: "computed", text: drained ? "drained cleanly" : "grace period expired with work in flight", source: "daemon.ts:stop" } });
    this.log.flush();
    await this.otel.forceFlush();
    await this.otel.shutdown();
    this.log.close();
    this.db.close();
  }
}

function refusalText(reason: string): string {
  switch (reason) {
    case "window_reserved": return "background work is paused to protect interactive headroom.";
    case "window_exhausted": return "the usage window is exhausted; I am in sentinel mode until it rolls over.";
    case "lane_disabled": return "that lane is disabled in config.";
    case "queue_full": return "that lane's queue is full.";
    case "duplicate": return "that job was already processed.";
    default: return reason;
  }
}

if (import.meta.main) {
  const daemon = new Daemon({ configFile: process.env.ALEPH_CONFIG });
  await daemon.start();
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) {
      emit("daemon.killed", { origin: "system", trace_id: newTraceId() }, { signal });
      process.exit(1);
    }
    stopping = true;
    await daemon.stop(signal);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  console.log(`aleph-next daemon up (pid ${process.pid}) — socket ${resolve(daemon.config.daemon.socket)}`);
}

export { trace };
