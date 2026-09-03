/**
 * LIVE: needs compose/langfuse.yml up and LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY
 * (env or ~/.aleph/.env). Run with ALEPH_LIVE=1 bun test tests/live
 */
import { describe, expect, test } from "bun:test";
import { langfuseConfig } from "../../hooks/lib/env.ts";
import { attrs, fetchTrace, nano, postSpans, spanId, traceIdFor } from "../../hooks/lib/otlp.ts";

const cfg = process.env.ALEPH_LIVE === "1" ? langfuseConfig() : null;
const describeLive = cfg ? describe : describe.skip;

describeLive("live langfuse", () => {
  test("a posted span is retrievable by trace id", async () => {
    const sessionId = `live-${Date.now()}`;
    const traceId = traceIdFor(sessionId);
    const now = Date.now();
    const result = await postSpans(cfg!, [{
      traceId,
      spanId: spanId(),
      name: "live-test",
      kind: 1,
      startTimeUnixNano: nano(now - 50),
      endTimeUnixNano: nano(now),
      attributes: attrs({
        "langfuse.trace.name": "live-test",
        "langfuse.session.id": sessionId,
        "langfuse.user.id": "chris",
        "langfuse.observation.type": "span",
        "langfuse.trace.tags": ["live-test"],
      }),
    }]);
    expect(result.ok).toBe(true);

    let found: unknown = null;
    for (let attempt = 0; attempt < 30 && !found; attempt++) {
      found = await fetchTrace(cfg!, traceId);
      if (!found) await Bun.sleep(2000);
    }
    expect(found).not.toBeNull();
    expect((found as { id: string }).id).toBe(traceId);
  }, 90_000);
});
