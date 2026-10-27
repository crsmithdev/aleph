/** The factory UI's server: read-only, on 127.0.0.1 only. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { state } from "./state.ts";

export function serve(port: number) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      if (url.pathname === "/api/state") return Response.json(state());
      if (url.pathname === "/") {
        const page = [join(import.meta.dir, "index.html"), join(import.meta.dir, "prototype.html")].find(existsSync)!;
        return new Response(Bun.file(page), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/render.js") return new Response(Bun.file(join(import.meta.dir, "render.js")), { headers: { "content-type": "text/javascript; charset=utf-8" } });
      return new Response("not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const i = process.argv.indexOf("--port");
  const port = Number(i >= 0 ? process.argv[i + 1] : process.env.ALEPH_UI_PORT ?? 3020);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("usage: aleph-ui [--port <n>]");
    process.exit(2);
  }
  const server = serve(port);
  console.log(`http://127.0.0.1:${server.port}/`);
}
