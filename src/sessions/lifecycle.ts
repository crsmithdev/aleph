/**
 * Session lifecycle: resolve -> resume-or-rehydrate -> route -> run -> record ->
 * write vault -> checkpoint -> reply.
 *
 * docs/design/phase-1.md §7.3. The resume/rehydrate split is the whole reason
 * this file exists: same-day continuations resume the SDK session; past the
 * window we rehydrate from the brief rather than re-paying a week-old transcript
 * against the usage window, and we say so in the event log instead of leaving
 * "why did it forget?" to intuition.
 */
import { trace, context, SpanStatusCode, type Tracer } from "@opentelemetry/api";
import { emit } from "../core/emit.ts";
import { remoteParentContext } from "../core/tracectx.ts";
import type { IdTuple } from "../core/envelope.ts";
import type { Clock } from "../core/clock.ts";
import type { Config, Lane } from "../core/config.ts";
import type { Meter } from "../core/meter.ts";
import type { Router } from "../routing/router.ts";
import type { VaultWriter } from "../vault/writer.ts";
import { spanAttributes, type LangfuseNaming } from "../obs/langfuse.ts";
import { SessionStore, type SessionRow } from "./store.ts";
import type { AgentRunner } from "./runner.ts";
import { renderBrief, parseBrief, type Brief } from "./brief.ts";

export interface TurnInput {
  session: SessionRow;
  text: string;
  lane: Lane;
  ids: IdTuple;
  causedBy?: string;
  channel: string;
}

export interface TurnOutput {
  reply: string;
  turn_id: string;
  resume_mode: "fresh" | "resumed" | "rehydrated";
  model: string;
  events: { turnStarted: string; turnCompleted: string | null };
}

const SYSTEM_PROMPT_BASE = `You are Chris's personal agent, running inside the aleph-next daemon.
You have no tools in this phase: answer from the context you are given and say plainly when you
do not know something. Never claim that something works unless the context shows it was run and
its output observed. Be concise; this reply is going to a phone.`;

/**
 * Vault content is not trusted input to a prompt. `renderBrief` escapes what the
 * agent authored (see brief.ts), and this is the second line: whatever reaches
 * here, the closing tag cannot appear inside the section it closes.
 */
function wrapUntrusted(tag: string, content: string): string {
  const closing = `</${tag}>`;
  const safe = content.split(closing).join(`&lt;/${tag}>`);
  return `<${tag}>\n${safe}\n${closing}`;
}

export class Lifecycle {
  constructor(
    private readonly deps: {
      store: SessionStore;
      runner: AgentRunner;
      router: Router;
      meter: Meter;
      vault: VaultWriter;
      config: Config;
      clock: Clock;
      tracer: Tracer;
      naming: LangfuseNaming;
    },
  ) {}

  private idleMs(session: SessionRow): number {
    const last = session.last_turn_at ?? session.created_at;
    return this.deps.clock.ms() - Date.parse(last);
  }

  private readBrief(session: SessionRow): Brief | null {
    const path = session.checkpoint_path;
    if (!path || !this.deps.vault.exists(path)) return null;
    try { return parseBrief(this.deps.vault.read(path)); } catch { return null; }
  }

  private seedPrompt(session: SessionRow): { prompt: string; seeded: string[] } {
    const seeded: string[] = [];
    const parts = [SYSTEM_PROMPT_BASE];
    if (this.deps.vault.exists("MEMORY.md")) {
      parts.push(wrapUntrusted("memory", this.deps.vault.read("MEMORY.md")));
      seeded.push("MEMORY.md");
    }
    const brief = this.readBrief(session);
    if (brief) {
      parts.push(wrapUntrusted("brief", renderBrief(brief)));
      seeded.push(session.checkpoint_path!);
    }
    parts.push(`<topic>${session.title}</topic>`);
    return { prompt: parts.join("\n\n"), seeded };
  }

  async runTurn(input: TurnInput): Promise<TurnOutput> {
    const { store, runner, router, meter, vault, config, clock, tracer, naming } = this.deps;
    const session = input.session;

    const idle = this.idleMs(session);
    const withinWindow = idle <= config.sessions.resume_window_hours * 3_600_000;
    const canResume = withinWindow && !!session.sdk_session_id;
    const resumeMode: TurnOutput["resume_mode"] = canResume ? "resumed" : session.turn_count === 0 ? "fresh" : "rehydrated";

    // Opened under the minted trace id (see core/tracectx.ts) so the event log's
    // trace_id and the Langfuse trace are the same trace, and the deep link works.
    const span = tracer.startSpan("turn", {
      attributes: spanAttributes("turn", input.ids, input.lane, naming) as Record<string, string | string[]>,
    }, remoteParentContext(input.ids.trace_id));
    const ctx = trace.setSpan(context.active(), span);

    return await context.with(ctx, async () => {
      const seed = this.seedPrompt(session);
      let causedBy = input.causedBy;

      if (resumeMode === "resumed") {
        causedBy = emit("session.resumed", input.ids, {
          session_id: session.id, sdk_session_id: session.sdk_session_id!, idle_ms: idle,
        }, { causedBy, cause: { kind: "computed", text: `idle ${Math.round(idle / 60000)} min <= resume window ${config.sessions.resume_window_hours}h`, source: "sessions/lifecycle.ts:runTurn" } });
      } else if (resumeMode === "rehydrated") {
        causedBy = emit("session.rehydrated", input.ids, {
          session_id: session.id, idle_ms: idle, seeded_with: seed.seeded,
        }, { causedBy, cause: { kind: "computed", text: `idle ${(idle / 3_600_000).toFixed(1)}h > resume window ${config.sessions.resume_window_hours}h — seeding from checkpoint instead of resuming`, source: "sessions/lifecycle.ts:runTurn" } });
      }

      const route = router.route(session.model_class, { ids: input.ids, causedBy });
      const turnId = store.startTurn({
        session_id: session.id, trace_id: input.ids.trace_id, lane: input.lane,
        model: route.model, tier: route.tier, resume_mode: resumeMode,
      });

      const turnStarted = emit("session.turn_started", input.ids, {
        session_id: session.id, turn_id: turnId, resume_mode: resumeMode, model: route.model, lane: input.lane,
      }, { causedBy, cause: { kind: "computed", text: `turn ${session.turn_count + 1} on ${route.model} (${resumeMode})`, source: "sessions/lifecycle.ts:runTurn" } });

      const started = clock.ms();
      const querySpan = tracer.startSpan("sdk.query", {
        attributes: { "gen_ai.request.model": route.model, "aleph.resume_mode": resumeMode, "aleph.runner": runner.name },
      }, ctx);

      try {
        const result = await runner.run({
          prompt: input.text,
          systemPrompt: seed.prompt,
          model: route.model,
          resume: canResume ? session.sdk_session_id! : undefined,
        });

        querySpan.setAttributes({
          "gen_ai.usage.input_tokens": result.usage.input_tokens,
          "gen_ai.usage.output_tokens": result.usage.output_tokens,
        });
        querySpan.end();

        store.recordTurn(session.id, result.sdk_session_id);
        store.endTurn(turnId, "ok", result.usage);

        const usageEvent = meter.record({
          lane: input.lane, model: route.model, tier: route.tier,
          input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
          cache_read_tokens: result.usage.cache_read_tokens, cache_creation_tokens: result.usage.cache_creation_tokens,
          cost_usd: result.usage.cost_usd, source: runner.name === "sdk" ? "sdk" : "estimate",
          session_id: session.id,
        }, input.ids, turnStarted).id;

        vault.appendLog(
          `\n## ${clock.iso()} — ${session.title} (${input.channel})\n\n**Chris:** ${input.text}\n\n**Aleph:** ${result.text}\n`,
          input.ids, usageEvent,
        );

        const after = store.get(session.id)!;
        if (after.turn_count % config.sessions.checkpoint_every_turns === 0) {
          this.checkpoint(after, input.ids, usageEvent, { stands: result.text.slice(0, 500) });
        }

        const completed = emit("session.turn_completed", input.ids, {
          session_id: session.id, turn_id: turnId, ms: clock.ms() - started, reply_chars: result.text.length,
          input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
        }, { causedBy: turnStarted, cause: { kind: "computed", text: `runner ${runner.name} returned ${result.text.length} chars (${result.stop_reason ?? "no stop_reason"})`, source: "sessions/lifecycle.ts:runTurn" } });

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return { reply: result.text, turn_id: turnId, resume_mode: resumeMode, model: route.model, events: { turnStarted, turnCompleted: completed } };
      } catch (e) {
        const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        querySpan.recordException(error);
        querySpan.end();
        store.endTurn(turnId, "failed");
        emit("session.turn_failed", input.ids, {
          session_id: session.id, turn_id: turnId,
          error_class: e instanceof Error ? e.name : "unknown", error,
        }, { causedBy: turnStarted, cause: { kind: "computed", text: `runner ${runner.name} threw`, source: "sessions/lifecycle.ts:runTurn" } });
        span.setStatus({ code: SpanStatusCode.ERROR, message: error });
        span.end();
        throw e;
      }
    });
  }

  /** Rewrite the brief. Called on the checkpoint cadence and at shutdown. */
  checkpoint(session: SessionRow, ids: IdTuple, causedBy?: string, patch: Partial<Brief> = {}): string {
    const existing = this.readBrief(session);
    const brief: Brief = {
      topic: session.topic_key,
      session_id: session.id,
      updated: this.deps.clock.iso(),
      turns: session.turn_count,
      state: session.state,
      title: session.title,
      stands: patch.stands ?? existing?.stands ?? "",
      decisions: patch.decisions ?? existing?.decisions ?? [],
      questions: patch.questions ?? existing?.questions ?? [],
      actions: patch.actions ?? existing?.actions ?? [],
      artifacts: patch.artifacts ?? existing?.artifacts ?? [],
    };
    const path = session.checkpoint_path ?? `wiki/projects/${session.topic_key}/session-brief.md`;
    this.deps.vault.write(path, renderBrief(brief), ids, { causedBy, mode: "rewrite" });
    return emit("session.checkpointed", ids, { session_id: session.id, turn_count: session.turn_count, brief_path: path }, {
      causedBy, cause: { kind: "computed", text: `checkpoint at turn ${session.turn_count}`, source: "sessions/lifecycle.ts:checkpoint" },
    });
  }

  /** Idle/archive sweep — enforcement of the ~1 week rule (design v1.0 §3.2). */
  sweep(ids: IdTuple): { idled: string[]; archived: string[] } {
    const { store, config, clock } = this.deps;
    const stale = store.staleSessions(config.sessions.idle_hours, config.sessions.archive_days);
    const idled: string[] = [], archived: string[] = [];
    for (const s of stale.idle) { store.setState(s.id, "idle"); idled.push(s.id); }
    for (const s of stale.archive) {
      store.setState(s.id, "archived");
      archived.push(s.id);
      const days = (clock.ms() - Date.parse(s.last_turn_at ?? s.created_at)) / 86_400_000;
      emit("session.archived", { ...ids, origin: "channel", session_id: s.id }, { session_id: s.id, idle_days: Number(days.toFixed(2)) }, {
        cause: { kind: "computed", text: `idle ${days.toFixed(1)}d >= archive_days ${config.sessions.archive_days}`, source: "sessions/lifecycle.ts:sweep" },
      });
    }
    return { idled, archived };
  }
}
