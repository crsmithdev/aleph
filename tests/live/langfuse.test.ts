/**
 * LIVE Langfuse ingestion. Needs a running Langfuse (compose/langfuse.yml) and:
 *   ALEPH_LIVE=1 LANGFUSE_BASE_URL=... LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=...
 *
 * This is the test that closes the last gap in the join invariant: the local OTLP
 * sink proves what the daemon SENDS; only Langfuse proves what it INGESTS.
 */
import { test, expect, describe } from "bun:test";
import { startOtel } from "../../src/obs/otel.ts";
import { spanAttributes } from "../../src/obs/langfuse.ts";
import { newTraceId } from "../../src/core/ids.ts";
import { remoteParentContext } from "../../src/core/tracectx.ts";

const LIVE = process.env.ALEPH_LIVE === "1" && Boolean(process.env.LANGFUSE_PUBLIC_KEY);
const describeLive = LIVE ? describe : describe.skip;

describeLive("live langfuse", () => {
  test("a span exported by our exporter is retrievable by trace id", async () => {
    const base = process.env.LANGFUSE_BASE_URL ?? "http://127.0.0.1:3010";
    const auth = "Basic " + Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
    const traceId = newTraceId();

    const otel = startOtel({
      enabled: true,
      endpoint: `${base}/api/public/otel/v1/traces`,
      headers: { Authorization: auth },
      serviceName: "aleph-live-test",
      simple: true,
    });

    const ids = { origin: "channel" as const, session_id: "ses_live_test", trace_id: traceId };
    const span = otel.tracer.startSpan("turn", {
      attributes: spanAttributes("turn", ids, "interactive", { baseUrl: base, projectId: "live" }) as Record<string, string | string[]>,
    }, remoteParentContext(traceId));
    span.end();
    await otel.forceFlush();

    // Ingestion is asynchronous; poll rather than sleeping a magic number.
    let found: unknown = null;
    for (let i = 0; i < 30 && !found; i++) {
      const res = await fetch(`${base}/api/public/traces/${traceId}`, { headers: { Authorization: auth } });
      if (res.ok) found = await res.json();
      else await Bun.sleep(2000);
    }
    expect(found).not.toBeNull();
    await otel.shutdown();
  }, 120_000);
});
