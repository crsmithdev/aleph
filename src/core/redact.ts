/**
 * Secret redaction over every event payload before it is written.
 *
 * docs/design/phase-1.md §13. Deliberately conservative on the false-positive
 * side: a UUID, a git SHA and a ULID must survive untouched, because redacting
 * an id would corrupt the causal chain the whole log exists to record.
 */
const PATTERNS: Array<[string, RegExp]> = [
  ["telegram", /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g],
  ["anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ["langfuse", /\b(?:pk|sk)-lf-[A-Za-z0-9-]{20,}\b/g],
  ["bearer", /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}/g],
  ["aws", /\bAKIA[0-9A-Z]{16}\b/g],
  ["pem", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
];

function fingerprint(s: string): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(s);
  return h.digest("hex").slice(0, 8);
}

export function redactString(input: string): string {
  let out = input;
  for (const [, re] of PATTERNS) {
    out = out.replace(re, (m) => `«redacted:${fingerprint(m)}»`);
  }
  return out;
}

export function redact<T>(value: T): T {
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redact) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redact(v);
    return out as unknown as T;
  }
  return value;
}
