/**
 * A real HTTP OTLP/JSON sink. Integration tests assert against what actually
 * left the process, not against a mocked exporter — the whole point of §14.3.
 */
export interface SinkSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes: Record<string, unknown> }>;
}

export interface OtlpSink {
  url: string;
  spans: SinkSpan[];
  requests: number;
  waitFor(predicate: (spans: SinkSpan[]) => boolean, timeoutMs?: number): Promise<SinkSpan[]>;
  stop(): void;
}

function decodeValue(v: Record<string, any>): unknown {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decodeValue);
  return v;
}

function decodeAttrs(list: Array<{ key: string; value: Record<string, any> }> = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of list) out[a.key] = decodeValue(a.value);
  return out;
}

export function startOtlpSink(): OtlpSink {
  const spans: SinkSpan[] = [];
  const state = { requests: 0 };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      state.requests++;
      const body = (await req.json()) as any;
      for (const rs of body.resourceSpans ?? []) {
        for (const ss of rs.scopeSpans ?? []) {
          for (const s of ss.spans ?? []) {
            spans.push({
              name: s.name,
              traceId: s.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId || undefined,
              attributes: decodeAttrs(s.attributes),
              events: (s.events ?? []).map((e: any) => ({ name: e.name, attributes: decodeAttrs(e.attributes) })),
            });
          }
        }
      }
      return new Response(JSON.stringify({ partialSuccess: {} }), { headers: { "content-type": "application/json" } });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}/v1/traces`,
    spans,
    get requests() { return state.requests; },
    async waitFor(predicate, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate(spans)) return spans;
        await Bun.sleep(25);
      }
      throw new Error(`otlp sink: predicate not satisfied in ${timeoutMs}ms (got ${spans.length} spans: ${spans.map((s) => s.name).join(", ")})`);
    },
    stop() { server.stop(true); },
  };
}
