/**
 * LIVE: needs compose/langfuse.yml up on this host, docker, and LANGFUSE_PUBLIC_KEY /
 * LANGFUSE_SECRET_KEY (env or ~/.aleph/.env). Run with ALEPH_LIVE=1 bun test tests/live
 */
import { describe, expect, test } from "bun:test";
import { langfuseConfig } from "../../lib/env.ts";
import { attrs, fetchTrace, nano, postSpans, spanId, traceIdFor } from "../../lib/otlp.ts";

const cfg = process.env.ALEPH_LIVE === "1" ? langfuseConfig() : null;
const describeLive = cfg ? describe : describe.skip;

describeLive("live langfuse", () => {
  test("a posted span is retrievable by trace id", async () => {
    const sessionId = `live-${crypto.randomUUID()}`;
    const traceId = traceIdFor(sessionId);
    const now = Date.parse("2026-01-01T00:00:00Z");
    const spans = [{
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
        "langfuse.environment": "test",
      }),
    }];

    // The worker writes traces to ClickHouse in timed batches and sends no event of its own.
    // Follow the ClickHouse log, and read the trace each time an insert into traces ends.
    // tail stops when its stdin closes, so it does not live on in the container.
    const log = "/var/log/clickhouse-server/clickhouse-server.log";
    const tail = Bun.spawn(["docker", "exec", "-i", "aleph-langfuse-clickhouse-1", "sh", "-c", `tail -n0 -F ${log} & cat >/dev/null; kill $!; wait`], { stdin: "pipe", stdout: "pipe" });
    const inserts = new Set<string>();
    let posted = false, found: unknown = null, rest = "";
    read: for await (const chunk of tail.stdout.pipeThrough(new TextDecoderStream())) {
      // The first chunk shows that tail follows the log, so no insert after the post is missed.
      if (!posted) { posted = true; expect((await postSpans(cfg!, spans)).ok).toBe(true); }
      const lines = (rest + chunk).split("\n");
      rest = lines.pop()!;
      for (const line of lines) {
        const query = line.match(/\{([\w-]+)\}/)?.[1];
        if (!query) continue;
        if (line.includes("INSERT INTO traces")) inserts.add(query);
        else if (inserts.has(query) && line.includes("Done processing query") && (found = await fetchTrace(cfg!, traceId))) break read;
      }
    }
    tail.stdin.end();
    await tail.exited;
    expect((found as { id: string }).id).toBe(traceId);
  }, 90_000);
});
