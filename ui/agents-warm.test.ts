import { expect, test } from "bun:test";
import { withEnv, withServer } from "./test-server.ts";
import { clearCache } from "./api/skills.ts";

test("serve() warms /api/agents so the first request hits Langfuse zero times", async () => {
  let calls = 0;
  const mock = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname.startsWith("/api/public/")) calls++;
      return Response.json({ data: [], meta: { totalPages: 1 } });
    },
  });
  const restoreEnv = withEnv({ LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", LANGFUSE_BASE_URL: `http://127.0.0.1:${mock.port}` });
  clearCache();
  const { server: s, at, stop } = await withServer();
  try {
    await Promise.all(Object.values(s.warmed)); // every warm-up, so none reads during the count
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    const r = await at("/api/agents?days=7");
    expect(r.status).toBe(200);
    const b = await r.json() as any;
    for (const k of ["activity", "skills", "sessions", "toolSessions"]) expect(b[k]).toBeDefined();
    expect(b.skills.error).toBeUndefined();
    expect(b.sessions.error).toBeUndefined();
    expect(calls).toBe(seen);
  } finally {
    stop(); mock.stop(true);
    restoreEnv();
  }
});
