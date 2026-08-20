/**
 * OTel tracer provider + OTLP/HTTP exporter aimed at Langfuse.
 *
 * docs/design/phase-1.md §6.1: no collector in the middle at N=1. Export
 * failures degrade to a counter + obs.export_failed — the kernel console must
 * work when Langfuse is down (cockpit P4), so nothing here may throw upward.
 */
import { trace, context, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { NodeTracerProvider, BatchSpanProcessor, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export interface OtelOptions {
  enabled: boolean;
  endpoint: string;
  headers?: Record<string, string>;
  serviceName: string;
  serviceVersion?: string;
  timeoutMs?: number;
  /** Tests use simple (synchronous-ish) processing so assertions do not race the batcher. */
  simple?: boolean;
  onExportError?: (error: string, dropped: number) => void;
}

export interface Otel {
  tracer: Tracer;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
  exportErrors(): number;
}

export function startOtel(opts: OtelOptions): Otel {
  if (!opts.enabled) {
    return {
      tracer: trace.getTracer("aleph-noop"),
      shutdown: async () => {},
      forceFlush: async () => {},
      exportErrors: () => 0,
    };
  }

  let errors = 0;
  const exporter = new OTLPTraceExporter({
    url: opts.endpoint,
    headers: opts.headers ?? {},
    timeoutMillis: opts.timeoutMs ?? 5000,
  });

  const wrapped = {
    export(spans: Parameters<typeof exporter.export>[0], cb: Parameters<typeof exporter.export>[1]) {
      exporter.export(spans, (result) => {
        if (result.code !== 0) {
          errors++;
          opts.onExportError?.(String(result.error?.message ?? result.error ?? "export failed"), spans.length);
        }
        cb(result);
      });
    },
    shutdown: () => exporter.shutdown(),
    forceFlush: () => exporter.forceFlush?.() ?? Promise.resolve(),
  } as unknown as typeof exporter;

  const processor = opts.simple ? new SimpleSpanProcessor(wrapped) : new BatchSpanProcessor(wrapped);
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: opts.serviceName,
      [ATTR_SERVICE_VERSION]: opts.serviceVersion ?? "0.1.0",
    }),
    spanProcessors: [processor],
  });
  provider.register();

  return {
    tracer: trace.getTracer("aleph-next", opts.serviceVersion ?? "0.1.0"),
    shutdown: async () => { await provider.shutdown().catch(() => {}); },
    forceFlush: async () => { await provider.forceFlush().catch(() => {}); },
    exportErrors: () => errors,
  };
}

export { trace, context, SpanStatusCode };
export type { Span };
