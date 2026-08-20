/**
 * In-process, per-lane job queue with admission control.
 *
 * docs/design/phase-1.md §4.2/§4.3. Per-lane FIFO, bounded; per-session
 * serialization (a session is a single-writer resource); every state change
 * emits with a computed cause.
 */
import { mint } from "./ids.ts";
import { emit } from "./emit.ts";
import type { Clock } from "./clock.ts";
import type { Config, Lane } from "./config.ts";
import { laneConfig, LANES } from "./config.ts";
import type { IdTuple } from "./envelope.ts";
import type { Meter } from "./meter.ts";
import type { Db } from "../platform/db.ts";

export interface Job<P = unknown> {
  id: string;
  lane: Lane;
  ids: IdTuple;
  kind: string;
  payload: P;
  submitted_at: string;
  attempt: number;
  /** Jobs sharing a serial key never run concurrently. */
  serial_key?: string;
  caused_by?: string;
}

export type Handler = (job: Job) => Promise<void>;

export interface SubmitResult {
  accepted: boolean;
  job_id: string;
  reason: string;
  event_id: string;
}

export class Bus {
  private queues = new Map<Lane, Job[]>();
  private running = new Map<Lane, number>();
  private activeSerials = new Set<string>();
  private handlers = new Map<string, Handler>();
  private draining = false;
  private inFlight = 0;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly clock: Clock,
    private readonly meter: Meter,
  ) {
    for (const lane of LANES) { this.queues.set(lane, []); this.running.set(lane, 0); }
  }

  on(kind: string, handler: Handler): void { this.handlers.set(kind, handler); }

  get inFlightCount(): number { return this.inFlight; }

  depth(lane: Lane): number { return this.queues.get(lane)!.length; }

  snapshot() {
    return LANES.map((lane) => ({
      lane,
      enabled: laneConfig(this.config, lane).enabled,
      queued: this.depth(lane),
      running: this.running.get(lane)!,
      max_concurrent: laneConfig(this.config, lane).max_concurrent,
    }));
  }

  submit<P>(input: Omit<Job<P>, "id" | "submitted_at" | "attempt"> & { id?: string; attempt?: number }): SubmitResult {
    const job: Job<P> = {
      ...input,
      id: input.id ?? mint("job", this.clock.ms()),
      submitted_at: this.clock.iso(),
      attempt: input.attempt ?? 0,
    };

    const done = this.db.query<{ job_id: string }, [string]>("SELECT job_id FROM jobs_done WHERE job_id = ?").get(job.id);
    if (done) {
      const eid = emit("bus.duplicate", job.ids, { job_id: job.id, lane: job.lane }, {
        causedBy: job.caused_by,
        cause: { kind: "computed", text: "job id already recorded as finished — replay dropped", source: "core/bus.ts:submit" },
      });
      return { accepted: false, job_id: job.id, reason: "duplicate", event_id: eid };
    }

    const verdict = this.meter.admit(job.lane);
    if (!verdict.admit) {
      const eid = emit("bus.rejected", job.ids, {
        job_id: job.id, lane: job.lane, reason: verdict.reason,
        share_5h: verdict.share_5h, share_weekly: verdict.share_weekly, headroom: verdict.headroom,
      }, {
        causedBy: job.caused_by,
        cause: {
          kind: "computed",
          text: `lane ${job.lane} refused: ${verdict.reason} (5h share ${verdict.share_5h.toFixed(3)}, weekly ${verdict.share_weekly.toFixed(3)}, headroom ${verdict.headroom.toFixed(2)})`,
          source: "core/bus.ts:submit",
        },
      });
      return { accepted: false, job_id: job.id, reason: verdict.reason, event_id: eid };
    }

    const queue = this.queues.get(job.lane)!;
    const limits = laneConfig(this.config, job.lane);
    if (queue.length >= limits.max_queue) {
      const eid = emit("bus.rejected", job.ids, { job_id: job.id, lane: job.lane, reason: "queue_full" }, {
        causedBy: job.caused_by,
        cause: { kind: "computed", text: `lane ${job.lane} queue at capacity (${limits.max_queue})`, source: "core/bus.ts:submit" },
      });
      return { accepted: false, job_id: job.id, reason: "queue_full", event_id: eid };
    }

    queue.push(job as Job);
    const eid = emit("bus.submitted", job.ids, { job_id: job.id, lane: job.lane, kind: job.kind, queue_depth: queue.length }, {
      causedBy: job.caused_by,
      cause: { kind: "computed", text: `queued on lane ${job.lane}`, source: "core/bus.ts:submit" },
    });
    queueMicrotask(() => this.pump());
    return { accepted: true, job_id: job.id, reason: "ok", event_id: eid };
  }

  /** Re-evaluate every lane; called after each completion and from daemon.tick. */
  pump(): void {
    if (this.draining) return;
    for (const lane of LANES) {
      const limits = laneConfig(this.config, lane);
      const queue = this.queues.get(lane)!;
      while (this.running.get(lane)! < limits.max_concurrent && queue.length > 0) {
        const idx = queue.findIndex((j) => !j.serial_key || !this.activeSerials.has(j.serial_key));
        if (idx === -1) break;
        const [job] = queue.splice(idx, 1) as [Job];
        void this.run(lane, job);
      }
    }
  }

  private async run(lane: Lane, job: Job): Promise<void> {
    this.running.set(lane, this.running.get(lane)! + 1);
    this.inFlight++;
    if (job.serial_key) this.activeSerials.add(job.serial_key);
    const started = this.clock.ms();
    const startedEvent = emit("bus.started", job.ids, {
      job_id: job.id, lane, waited_ms: started - Date.parse(job.submitted_at),
    }, { causedBy: job.caused_by, cause: { kind: "computed", text: `dequeued from ${lane}`, source: "core/bus.ts:run" } });

    const handler = this.handlers.get(job.kind);
    let ok = true, error: string | undefined;
    try {
      if (!handler) throw new Error(`no handler registered for job kind ${job.kind}`);
      await handler(job);
    } catch (e) {
      ok = false;
      error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    } finally {
      if (job.serial_key) this.activeSerials.delete(job.serial_key);
      this.running.set(lane, this.running.get(lane)! - 1);
      this.inFlight--;
      this.db.run("INSERT OR REPLACE INTO jobs_done (job_id, finished_at) VALUES (?, ?)", [job.id, this.clock.iso()]);
      emit("bus.finished", job.ids, { job_id: job.id, lane, ok, ms: this.clock.ms() - started, error }, {
        causedBy: startedEvent,
        cause: { kind: "computed", text: ok ? "handler returned" : `handler threw: ${error}`, source: "core/bus.ts:run" },
      });
      queueMicrotask(() => this.pump());
    }
  }

  async drain(timeoutMs: number): Promise<boolean> {
    this.draining = true;
    const deadline = this.clock.ms() + timeoutMs;
    while (this.inFlight > 0 && Date.now() < deadline) await Bun.sleep(20);
    return this.inFlight === 0;
  }
}
