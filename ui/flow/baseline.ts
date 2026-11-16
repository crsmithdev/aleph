import type { Window } from "../../lib/windows.ts";
import type { Speed } from "../api/flow.ts";
import { round } from "./phases.ts";

/** What a Status card shows for one span; a field is null when the span has no data for it. */
export interface Figures { lost: number | null; hours: number | null; leadP50: number | null; leadP90: number | null; asks: number | null; landed: number | null; firstPass: number | null; followups: number | null; filed: number | null }
/** The trend baseline of a window: `prev` is the span just before, `base` the average the trend compares with, `basis` says how it is taken. */
export interface Baseline { prev: Figures; base: Figures; basis: string }

export function figures(s: Speed): Figures {
  const total = s.classes.reduce((a, c) => a + c.hours, 0), any = total > 0 || s.done > 0;
  return {
    lost: total > 0 ? s.lost.share : null,
    hours: total > 0 ? s.lost.hours : null,
    leadP50: s.phases.lead.count ? s.phases.lead.p50 : null,
    leadP90: s.phases.lead.count ? s.phases.lead.p90 : null,
    asks: s.asks.count,
    landed: any ? s.done : null,
    firstPass: s.issues.firstPass,
    followups: s.filed.followups,
    filed: s.filed.all,
  };
}

/** Each field's mean over the spans that have data for it; null when none has. */
export function averageFigures(xs: Figures[]): Figures {
  const out = {} as Record<keyof Figures, number | null>;
  for (const k of Object.keys(xs[0] ?? figures0()) as (keyof Figures)[]) {
    const v = xs.map((x) => x[k]).filter((n): n is number => n !== null);
    out[k] = v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 4) : null;
  }
  return out;
}
const figures0 = (): Figures => ({ lost: null, hours: null, leadP50: null, leadP90: null, asks: null, landed: null, firstPass: null, followups: null, filed: null });

// Hour: the average of the last 12 hours; day: of the last 7 days; week and month: the span before.
export const BASELINE: Record<Window, { n: number; avg: boolean; basis: string; prev: string }> = {
  hour: { n: 12, avg: true, basis: "average of the last 12 hours with data", prev: "the hour before" },
  day: { n: 7, avg: true, basis: "average of the last 7 days with data", prev: "the day before" },
  week: { n: 1, avg: false, basis: "the previous 7 days", prev: "the previous 7 days" },
  month: { n: 1, avg: false, basis: "the previous 30 days", prev: "the previous 30 days" },
};
