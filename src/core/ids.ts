/**
 * ULIDs with a type prefix, per docs/design/phase-1.md §2.
 * Prefixes are for greppability; the 26-char ULID body is what sorts.
 */
import { monotonicFactory } from "ulid";

const ulid = monotonicFactory();

export type IdPrefix = "evt" | "ses" | "tsk" | "run" | "msg" | "turn" | "job";

export function mint(prefix: IdPrefix, seedTime?: number): string {
  return `${prefix}_${ulid(seedTime)}`;
}

export function isId(prefix: IdPrefix, value: string): boolean {
  return value.startsWith(`${prefix}_`) && value.length === prefix.length + 27;
}

/** W3C trace/span ids: raw hex, not ours to prefix. */
export function newTraceId(): string {
  return randomHex(16);
}
export function newSpanId(): string {
  return randomHex(8);
}
function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Slug for topic keys and vault paths. Stable, lowercase, no surprises. */
export function slugify(s: string, max = 48): string {
  const base = s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return base || "topic";
}
