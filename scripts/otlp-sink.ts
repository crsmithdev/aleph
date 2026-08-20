#!/usr/bin/env bun
/**
 * Standalone OTLP/JSON sink for local verification when Langfuse is not running.
 * Prints one line per span and appends the decoded spans to a JSONL file.
 * Usage: bun scripts/otlp-sink.ts [port] [outfile]
 */
import { appendFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 4318);
const outfile = process.argv[3] ?? "";

const decodeValue = (v: any): unknown => {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decodeValue);
  return v;
};
const decodeAttrs = (list: any[] = []) => Object.fromEntries(list.map((a) => [a.key, decodeValue(a.value)]));

const server = Bun.serve({
  port,
  async fetch(req) {
    const body = (await req.json()) as any;
    for (const rs of body.resourceSpans ?? []) {
      for (const ss of rs.scopeSpans ?? []) {
        for (const s of ss.spans ?? []) {
          const span = {
            name: s.name, traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId || null,
            attributes: decodeAttrs(s.attributes),
            events: (s.events ?? []).map((e: any) => ({ name: e.name, attributes: decodeAttrs(e.attributes) })),
          };
          console.log(`[span] ${span.name.padEnd(14)} trace=${span.traceId.slice(0, 12)} parent=${span.parentSpanId ? span.parentSpanId.slice(0, 8) : "-"} events=${span.events.length}`);
          if (outfile) appendFileSync(outfile, JSON.stringify(span) + "\n");
        }
      }
    }
    return Response.json({ partialSuccess: {} });
  },
});
console.log(`otlp sink listening on http://127.0.0.1:${server.port}/v1/traces`);
