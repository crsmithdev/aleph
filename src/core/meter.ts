/**
 * Window meter: usage-window share, not dollars (design v1.0 §2).
 *
 * docs/design/phase-1.md §11. This is explicitly a MODEL of the plan's windows,
 * not a reading of them — Anthropic exposes no "share consumed" API. Capacity is
 * a configured estimate; observed rate-limit errors are the calibration signal.
 * Pretending otherwise would be the confabulation-as-audit that principle 5 bans.
 */
import type { Db } from "../platform/db.ts";
import type { Clock } from "./clock.ts";
import type { Config, Lane } from "./config.ts";
import { laneConfig } from "./config.ts";
import type { IdTuple } from "./envelope.ts";
import { emit } from "./emit.ts";

export interface UsageRecord {
  lane: Lane;
  model: string;
  tier: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number | null;
  source: "sdk" | "estimate";
  session_id?: string;
  task_id?: string;
  run_id?: string;
}

export type WindowName = "5h" | "weekly";

export interface WindowState {
  window: WindowName;
  weighted: number;
  capacity: number;
  share: number;
  reserve: number;
  headroom: number;
  anchor: string | null;
  exhausted: boolean;
}

export interface AdmissionVerdict {
  admit: boolean;
  reason: "ok" | "lane_disabled" | "window_reserved" | "window_exhausted";
  share_5h: number;
  share_weekly: number;
  headroom: number;
}

const THRESHOLDS = [0.5, 0.75, 0.9] as const;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class Meter {
  private crossed = new Map<string, number>();
  private exhausted = new Set<WindowName>();

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly clock: Clock,
  ) {}

  weigh(u: Pick<UsageRecord, "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_creation_tokens">): number {
    const w = this.config.meter.weights;
    return (
      u.input_tokens * w.input +
      u.output_tokens * w.output +
      u.cache_read_tokens * w.cache_read +
      u.cache_creation_tokens * w.cache_creation
    );
  }

  /** Start of the rolling 5h window: the first request at or after now-5h. */
  private anchor5h(): string | null {
    const since = new Date(this.clock.ms() - FIVE_HOURS_MS).toISOString();
    return this.db.query<{ ts: string }, [string]>("SELECT MIN(ts) AS ts FROM usage WHERE ts >= ?").get(since)?.ts ?? null;
  }

  private weightedSince(since: string): number {
    return this.db.query<{ total: number | null }, [string]>(
      "SELECT SUM(weighted) AS total FROM usage WHERE ts >= ?",
    ).get(since)?.total ?? 0;
  }

  window(name: WindowName): WindowState {
    const ms = name === "5h" ? FIVE_HOURS_MS : WEEK_MS;
    const since = new Date(this.clock.ms() - ms).toISOString();
    const weighted = this.weightedSince(since);
    const capacity = name === "5h" ? this.config.meter.capacity.window_5h : this.config.meter.capacity.weekly;
    const reserve = name === "5h" ? this.config.meter.reserve.window_5h : this.config.meter.reserve.weekly;
    return {
      window: name,
      weighted,
      capacity,
      share: capacity > 0 ? weighted / capacity : 0,
      reserve,
      headroom: 1 - reserve,
      anchor: name === "5h" ? this.anchor5h() : since,
      exhausted: this.exhausted.has(name),
    };
  }

  windows(): Record<WindowName, WindowState> {
    return { "5h": this.window("5h"), weekly: this.window("weekly") };
  }

  /** Enforcement point 1 — docs/design/phase-1.md §11.4. */
  admit(lane: Lane): AdmissionVerdict {
    const w5 = this.window("5h");
    const ww = this.window("weekly");
    const verdict = (admit: boolean, reason: AdmissionVerdict["reason"]): AdmissionVerdict => ({
      admit, reason, share_5h: w5.share, share_weekly: ww.share,
      headroom: Math.min(w5.headroom, ww.headroom),
    });

    if (!laneConfig(this.config, lane).enabled) return verdict(false, "lane_disabled");

    const privileged = lane === "interactive" || lane === "control";
    if (privileged) {
      const full = w5.share >= 1 || ww.share >= 1 || this.exhausted.size > 0;
      return full ? verdict(false, "window_exhausted") : verdict(true, "ok");
    }
    if (this.exhausted.size > 0) return verdict(false, "window_exhausted");
    if (w5.share >= w5.headroom || ww.share >= ww.headroom) return verdict(false, "window_reserved");
    return verdict(true, "ok");
  }

  /** Enforcement point 2 — record real usage, fire threshold events. */
  record(u: UsageRecord, ids: IdTuple, causedBy?: string): { id: string; weighted: number } {
    const weighted = this.weigh(u);
    const id = emit("meter.usage_recorded", ids, {
      lane: u.lane, model: u.model, tier: u.tier,
      input_tokens: u.input_tokens, output_tokens: u.output_tokens,
      cache_read_tokens: u.cache_read_tokens, cache_creation_tokens: u.cache_creation_tokens,
      weighted, cost_usd: u.cost_usd, source: u.source,
    }, { causedBy, cause: { kind: "computed", text: `usage reported by ${u.source} for ${u.model}`, source: "core/meter.ts:record" } });

    this.db.run(
      `INSERT INTO usage (id, ts, lane, session_id, task_id, run_id, model, tier,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, weighted, cost_usd, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, this.clock.iso(), u.lane, u.session_id ?? null, u.task_id ?? null, u.run_id ?? null,
       u.model, u.tier, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_creation_tokens,
       weighted, u.cost_usd, u.source],
    );

    for (const name of ["5h", "weekly"] as const) {
      const w = this.window(name);
      const last = this.crossed.get(name) ?? 0;
      for (const t of THRESHOLDS) {
        if (w.share >= t && last < t) {
          this.crossed.set(name, t);
          emit("meter.window_threshold", ids, { window: name, crossing: String(t), share: w.share }, {
            causedBy: id,
            cause: { kind: "computed", text: `${name} window crossed ${t * 100}%`, source: "core/meter.ts:record" },
          });
        }
      }
      if (w.share >= 1 && !this.exhausted.has(name)) this.markExhausted(name, ids, "accumulator", id);
    }
    return { id, weighted };
  }

  /** The calibration signal: the provider told us the window is actually gone. */
  markExhausted(name: WindowName, ids: IdTuple, detectedBy: "accumulator" | "provider", causedBy?: string): void {
    if (this.exhausted.has(name)) return;
    this.exhausted.add(name);
    const w = this.window(name);
    emit("meter.window_exhausted", ids, {
      window: name, observed_weighted: w.weighted, capacity: w.capacity, detected_by: detectedBy,
    }, { causedBy, cause: { kind: "computed", text: `${name} window exhausted (detected by ${detectedBy}) — sentinel mode`, source: "core/meter.ts:markExhausted" } });
  }

  /** Enforcement point 3 — the tick re-evaluates when a window rolls over. */
  sweep(ids: IdTuple): WindowName[] {
    const recovered: WindowName[] = [];
    for (const name of [...this.exhausted]) {
      const w = this.window(name);
      if (w.share < w.headroom) {
        this.exhausted.delete(name);
        this.crossed.delete(name);
        recovered.push(name);
        emit("meter.window_threshold", ids, { window: name, crossing: "recovered", share: w.share }, {
          cause: { kind: "computed", text: `${name} window rolled over; leaving sentinel mode`, source: "core/meter.ts:sweep" },
        });
      }
    }
    return recovered;
  }

  get sentinel(): boolean { return this.exhausted.size > 0; }
}
