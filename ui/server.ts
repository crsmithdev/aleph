/**
 * The factory UI's server, on 127.0.0.1 only. It serves the page, `ui/lib.js`,
 * each `ui/views/*.js`, and the routes of every `ui/api/*.ts`, loaded at start.
 * A route file exports `routes`: `"GET /api/x/:id"` → `(req, params, url) => Response`.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Handler = (req: Request, params: Record<string, string>, url: URL) => Response | Promise<Response>;
export type Routes = Record<string, Handler>;

interface Route { method: string; pattern: RegExp; names: string[]; handler: Handler }

const JS = { "content-type": "text/javascript; charset=utf-8" };
const VIEW_FILE = /^[\w-]+\.js$/;

/** `/api/jobs/:name` as a regex and its parameter names. */
export function compile(path: string): { pattern: RegExp; names: string[] } {
  const names: string[] = [];
  const src = path.split("/").map((seg) => {
    if (seg.startsWith(":")) { names.push(seg.slice(1)); return "([^/]+)"; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { pattern: new RegExp(`^${src}/?$`), names };
}

async function loadRoutes(dir: string): Promise<Route[]> {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort() : [];
  const routes: Route[] = [];
  for (const f of files) {
    const mod = await import(join(dir, f));
    for (const [key, handler] of Object.entries<Handler>(mod.routes ?? {})) {
      const [method, path] = key.trim().split(/\s+/);
      if (!method || !path) throw new Error(`ui/api/${f}: bad route "${key}"`);
      routes.push({ method: method.toUpperCase(), ...compile(path), handler });
    }
  }
  return routes;
}

/** The file names under ui/views/, sorted. */
export function views(dir = join(import.meta.dir, "views")): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => VIEW_FILE.test(f)).sort() : [];
}

export async function serve(port: number) {
  const dir = import.meta.dir;
  const routes = await loadRoutes(join(dir, "api"));
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      let allowed = false;
      for (const r of routes) {
        const m = path.match(r.pattern);
        if (!m) continue;
        if (r.method !== req.method) { allowed = true; continue; }
        const params: Record<string, string> = {};
        r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        return r.handler(req, params, url);
      }
      if (allowed) return new Response("method not allowed", { status: 405 });
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      if (path === "/api/views") return Response.json(views(join(dir, "views")));
      if (path === "/") {
        const page = [join(dir, "index.html"), join(dir, "prototype.html")].find(existsSync)!;
        return new Response(Bun.file(page), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (path === "/lib.js") return new Response(Bun.file(join(dir, "lib.js")), { headers: JS });
      const v = path.match(/^\/views\/([^/]+)$/);
      if (v && VIEW_FILE.test(v[1]) && existsSync(join(dir, "views", v[1]))) return new Response(Bun.file(join(dir, "views", v[1])), { headers: JS });
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
  const server = await serve(port);
  console.log(`http://127.0.0.1:${server.port}/`);
}
