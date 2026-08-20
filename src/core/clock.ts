/**
 * The only source of "now". Nothing outside this file calls Date.now(),
 * so tests can advance time deterministically (session resume vs rehydrate
 * turns entirely on clock arithmetic — see docs/design/phase-1.md §7.3).
 */
export interface Clock {
  now(): Date;
  iso(): string;
  ms(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  iso: () => new Date().toISOString(),
  ms: () => Date.now(),
};

export class FakeClock implements Clock {
  constructor(private t: number) {}
  now() { return new Date(this.t); }
  iso() { return new Date(this.t).toISOString(); }
  ms() { return this.t; }
  advance(ms: number) { this.t += ms; return this; }
  set(iso: string) { this.t = Date.parse(iso); return this; }
}

/** RFC3339 UTC with milliseconds — the one timestamp format in this system. */
export function rfc3339(d: Date): string {
  return d.toISOString();
}
