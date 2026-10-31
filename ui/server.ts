/**
 * The factory UI's server. It binds 127.0.0.1 and home-proxy serves it on the LAN behind the login in `ui/auth.ts`. It serves the page, `ui/lib.js`,
 * each `ui/views/*.js`, and the routes of every `ui/api/*.ts`, loaded at start.
 * A route file exports `routes`: `"GET /api/x/:id"` → `(req, params, url) => Response`.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cacheFetches, uiFetchTtl } from "../todo/lib/store.ts";
import { loadDotenv } from "../hooks/lib/env.ts";
import { gateOn, gate, routes as authRoutes } from "./auth.ts";
import { startPoller } from "./usage.ts";

export type Handler = (req: Request, params: Record<string, string>, url: URL) => Response | Promise<Response>;
export type Routes = Record<string, Handler>;

interface Route { method: string; pattern: RegExp; names: string[]; handler: Handler }

/** The page and its modules are revalidated on every load, so a reload after a land gets the new code. */
const JS = { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" };
/** This process's start time: part of the version, so a restart changes it. */
const START = String(Date.now());
const VIEW_FILE = /^[\w-]+\.js$/;
/** The modules in ui/ that views import (`from "../lib.js"`), served at the root. */
const SHARED = new Set(["/lib.js", "/decision.js"]);

/** `/api/jobs/:name` as a regex and its parameter names. */
export function compile(path: string): { pattern: RegExp; names: string[] } {
  const names: string[] = [];
  const src = path.split("/").map((seg) => {
    if (seg.startsWith(":")) { names.push(seg.slice(1)); return "([^/]+)"; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { pattern: new RegExp(`^${src}/?$`), names };
}

/** Each route file's optional `warm` export: fills its caches once the server is up. */
const warmers: { file: string; warm: () => Promise<void> }[] = [];

async function loadRoutes(dir: string): Promise<Route[]> {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort() : [];
  const routes: Route[] = [];
  for (const f of files) {
    const mod = await import(join(dir, f));
    if (typeof mod.warm === "function") warmers.push({ file: f, warm: mod.warm });
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

/**
 * The value of `x-aleph-version`, computed per answer: the start time plus a fingerprint of the name, mtime and size
 * of index.html, the SHARED modules and each view. A restart, an edit, an added or a removed file changes it,
 * so an open page sees that its code changed and reloads its modules.
 */
export function version(dir = import.meta.dir): string {
  const files = ["index.html", ...[...SHARED].map((p) => p.slice(1)), ...views(join(dir, "views")).map((f) => `views/${f}`)];
  const parts = files.map((f) => {
    try {
      const st = statSync(join(dir, f));
      return `${f}:${st.mtimeMs}:${st.size}`;
    } catch { return `${f}:missing`; }
  });
  return `${START}-${Bun.hash(parts.join("\n")).toString(36)}`;
}

/** `warm: false` skips the warm-ups: a test that does not test them keeps Langfuse and the vault out of its process. */
export async function serve(port: number, { warm = true, pageDir }: { warm?: boolean; pageDir?: string } = {}) {
  const dir = pageDir ?? import.meta.dir;
  warmers.length = 0;
  const routes = await loadRoutes(join(import.meta.dir, "api"));
  for (const [key, handler] of Object.entries(authRoutes)) {
    const [method, path] = key.split(" ");
    routes.push({ method, ...compile(path), handler });
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    // Bun closes a request after 10 s by default; /api/memory and /api/activity take longer.
    idleTimeout: 120,
    async fetch(req) {
      const refused = gate(req);
      if (refused) return refused;
      const url = new URL(req.url);
      const path = url.pathname;
      let allowed = false;
      for (const r of routes) {
        const m = path.match(r.pattern);
        if (!m) continue;
        if (r.method !== req.method) { allowed = true; continue; }
        const params: Record<string, string> = {};
        r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        const res = await r.handler(req, params, url);
        res.headers.set("x-aleph-version", version(dir));
        if (gateOn()) res.headers.set("x-aleph-login", "1");
        return res;
      }
      if (allowed) return new Response("method not allowed", { status: 405 });
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      if (path === "/api/views") return Response.json(views(join(dir, "views")));
      if (path === "/" || path === "/index.html") {
        const page = join(dir, "index.html");
        return new Response(Bun.file(page), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
      }
      if (path === "/vendor/echarts.min.js") return new Response(Bun.file(join(dir, "vendor", "echarts.min.js")), { headers: JS });
      if (SHARED.has(path)) return new Response(Bun.file(join(dir, path.slice(1))), { headers: JS });
      const v = path.match(/^\/views\/([^/]+)$/);
      if (v && VIEW_FILE.test(v[1]) && existsSync(join(dir, "views", v[1]))) return new Response(Bun.file(join(dir, "views", v[1])), { headers: JS });
      return new Response("not found", { status: 404 });
    },
  });
  // One background call per slow route, so the first visit finds its cache filled.
  // The weekly plan usage is polled every 10 minutes while the server runs.
  if (warm) startPoller();
  // `warmed[file]` settles when that route's warm-up ends, failed or not: a test waits on it instead of on the clock.
  const warmed: Record<string, Promise<void>> = {};
  if (warm) for (const w of warmers) warmed[w.file] = w.warm().catch((e) => console.error(`ui/api/${w.file}: warm-up failed: ${e instanceof Error ? e.message : e}`));
  return Object.assign(server, { warmed });
}

if (import.meta.main) {
  loadDotenv(undefined, ["ALEPH_UI_PASSWORD"]);
  const i = process.argv.indexOf("--port");
  const port = Number(i >= 0 ? process.argv[i + 1] : process.env.ALEPH_UI_PORT ?? 3020);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("usage: aleph-ui [--port <n>]");
    process.exit(2);
  }
  // Every read of the work store in this process reuses a fetch for ALEPH_UI_FETCH_TTL seconds.
  cacheFetches(uiFetchTtl());
  const server = await serve(port);
  console.log(`http://127.0.0.1:${server.port}/`);
}
