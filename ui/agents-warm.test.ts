import { expect, test } from "bun:test";
import { serve } from "./server.ts";
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
  const keys = ["LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"];
  const before = keys.map((k) => process.env[k]);
  process.env.LANGFUSE_PUBLIC_KEY = "pk"; process.env.LANGFUSE_SECRET_KEY = "sk";
  process.env.LANGFUSE_BASE_URL = `http://127.0.0.1:${mock.port}`;
  clearCache();
  const s = await serve(0);
  try {
    await Promise.all(Object.values(s.warmed)); // every warm-up, so none reads during the count
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    const r = await fetch(`http://127.0.0.1:${s.port}/api/agents?days=7`);
    expect(r.status).toBe(200);
    const b = await r.json() as any;
    for (const k of ["activity", "skills", "sessions", "toolSessions"]) expect(b[k]).toBeDefined();
    expect(b.skills.error).toBeUndefined();
    expect(b.sessions.error).toBeUndefined();
    expect(calls).toBe(seen);
  } finally {
    s.stop(true); mock.stop(true);
    keys.forEach((k, i) => { if (before[i] === undefined) delete process.env[k]; else process.env[k] = before[i]; });
  }
});
