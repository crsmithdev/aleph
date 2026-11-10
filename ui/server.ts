/**
 * The factory UI's server. It binds 127.0.0.1 and home-proxy serves it on the LAN behind the gate in `ui/auth.ts`: a login, or with no password only this machine. It serves the page, `ui/lib.js`,
 * each `ui/views/*.js`, and the routes of every `ui/api/*.ts`, loaded at start.
 * A route file exports `routes`: `"GET /api/x/:id"` → `(req, params, url) => Response`. The answers of the routes in
 * `KEYED` come from the updater (ui/updater.ts), which builds them in its Worker; every other route runs here.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { skipFetches } from "../issues/lib/store.ts";
import { loadDotenv } from "../lib/env.ts";
import { gateOn, gate, routes as authRoutes } from "./auth.ts";
import { startPoller } from "./usage.ts";
import { KEYED, respond, startUpdater, stopUpdater, updater } from "./updater.ts";
import { uiPort } from "../jobs/lib/infra/settings.ts";
import { serverGraph } from "../jobs/lib/infra/ui-graph.ts";

export type Handler = (req: Request, params: Record<string, string>, url: URL) => Response | Promise<Response>;
export type Routes = Record<string, Handler>;

export interface Route { method: string; path: string; pattern: RegExp; names: string[]; handler: Handler }

/** The page and its modules are revalidated on every load, so a reload after a land gets the new code. */
const JS = { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" };
/** This process's start time: part of the version, so a restart changes it. */
const START = String(Date.now());
const VIEW_FILE = /^[\w-]+\.js$/;
const TS = new Bun.Transpiler({ loader: "ts" });
/** The modules that views import, by URL, and each one's file under ui/. `lib/naming.ts` sits at the same path from the page and from the repo, so `ui/lib.js` imports it as `../lib/naming.ts`; the page gets it as JS. */
const SHARED = new Map([["/lib.js", "lib.js"], ["/router.js", "router.js"], ["/chart.js", "chart.js"], ["/system-parts.js", "system-parts.js"], ["/decision.js", "decision.js"], ["/timeline.js", "timeline.js"], ["/lib/naming.ts", "../lib/naming.ts"], ["/lib/status-words.ts", "../lib/status-words.ts"]]);

/** `/api/jobs/:name` as a regex and its parameter names. */
export function compile(path: string): { pattern: RegExp; names: string[] } {
  const names: string[] = [];
  const src = path.split("/").map((seg) => {
    if (seg.startsWith(":")) { names.push(seg.slice(1)); return "([^/]+)"; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { pattern: new RegExp(`^${src}/?$`), names };
}

/** The routes of each `*.ts` under `dir`, as their files define them. */
export async function loadRoutes(dir: string): Promise<Route[]> {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort() : [];
  const routes: Route[] = [];
  for (const f of files) {
    const mod = await import(join(dir, f));
    for (const [key, handler] of Object.entries<Handler>(mod.routes ?? {})) {
      const [method, path] = key.trim().split(/\s+/);
      if (!method || !path) throw new Error(`ui/api/${f}: bad route "${key}"`);
      routes.push({ method: method.toUpperCase(), path, ...compile(path), handler });
    }
  }
  return routes;
}

/** The route for `method` and `path`, with its parameters. */
export function match(routes: Route[], method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const m = route.method === method && path.match(route.pattern);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    return { route, params };
  }
  return null;
}

/** The file names under ui/views/, sorted. */
export function views(dir = join(import.meta.dir, "views")): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => VIEW_FILE.test(f)).sort() : [];
}

/**
 * The value of `x-aleph-version`, computed per answer: the start time plus a fingerprint of the name, mtime and size
 * of index.html, app.css, the SHARED modules and each view. A restart, an edit, an added or a removed file changes it,
 * so an open page sees that its code changed and reloads its modules.
 */
export function version(dir = import.meta.dir): string {
  const files = ["index.html", "app.css", ...SHARED.values(), ...views(join(dir, "views")).map((f) => `views/${f}`)];
  const parts = files.map((f) => {
    try {
      const st = statSync(join(dir, f));
      return `${f}:${st.mtimeMs}:${st.size}`;
    } catch { return `${f}:missing`; }
  });
  return `${START}-${Bun.hash(parts.join("\n")).toString(36)}`;
}

/** A fingerprint of the content of each file that the server loaded (its server graph) under `root`. */
function codePrint(root: string, files: Iterable<string>): string {
  return [...files].sort().map((f) => {
    try { return `${f}:${Bun.hash(readFileSync(join(root, f)))}`; } catch { return `${f}:missing`; }
  }).join("\n");
}

/** `warm: false` builds no saved key and polls no usage: a test that does not test them keeps Langfuse out of its process. */
export async function serve(port: number, { warm = true, pageDir, apiDir, root = join(import.meta.dir, "..") }: { warm?: boolean; pageDir?: string; apiDir?: string; root?: string } = {}) {
  const dir = pageDir ?? import.meta.dir;
  // The files that this process loaded; an answer carries `x-aleph-stale` once one of them differs on disk.
  const loaded = serverGraph(root);
  const loadedPrint = codePrint(root, loaded);
  skipFetches();
  const routes = (await loadRoutes(join(import.meta.dir, "api"))).map((r) => (r.method === "GET" && KEYED.has(r.path) ? { ...r, handler: (_req: Request, _p: Record<string, string>, url: URL) => respond(url) } : r));
  if (apiDir) routes.push(...await loadRoutes(apiDir));
  for (const [key, handler] of Object.entries(authRoutes)) {
    const [method, path] = key.split(" ");
    routes.push({ method, path, ...compile(path), handler });
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    // Bun closes a request after 10 s by default; /api/memory and /api/sessions take longer.
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
        let res = await r.handler(req, params, url);
        if (r.method !== "GET" && res.ok) updater.changed("action");
        if (res.headers.get("content-type")?.includes("application/json") && req.headers.get("accept-encoding")?.includes("gzip")) {
          const body = new Uint8Array(await res.arrayBuffer());
          res = new Response(body.length > 1024 ? Bun.gzipSync(body) : body, res);
          if (body.length > 1024) { res.headers.set("content-encoding", "gzip"); res.headers.set("vary", "Accept-Encoding"); }
        }
        res.headers.set("x-aleph-version", version(dir));
        if (codePrint(root, loaded) !== loadedPrint) res.headers.set("x-aleph-stale", "1");
        if (gateOn()) res.headers.set("x-aleph-login", "1");
        return res;
      }
      if (allowed) return new Response("method not allowed", { status: 405 });
      // An API path with no route, such as an old one, is not found whatever the method.
      if (req.method !== "GET") return path.startsWith("/api/") ? new Response("not found", { status: 404 }) : new Response("method not allowed", { status: 405 });
      if (path === "/api/views") return Response.json(views(join(dir, "views")));
      if (path === "/" || path === "/index.html") {
        const page = join(dir, "index.html");
        return new Response(Bun.file(page), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
      }
      if (path === "/app.css") return new Response(Bun.file(join(dir, "app.css")), { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" } });
      if (path === "/vendor/echarts.min.js") return new Response(Bun.file(join(dir, "vendor", "echarts.min.js")), { headers: JS });
      if (SHARED.has(path)) {
        const file = join(dir, SHARED.get(path)!);
        return new Response(file.endsWith(".ts") ? TS.transformSync(readFileSync(file, "utf8")) : Bun.file(file), { headers: JS });
      }
      const v = path.match(/^\/views\/([^/]+)$/);
      if (v && VIEW_FILE.test(v[1]) && existsSync(join(dir, "views", v[1]))) return new Response(Bun.file(join(dir, "views", v[1])), { headers: JS });
      return new Response("not found", { status: 404 });
    },
  });
  // The weekly plan usage is polled every 10 minutes while the server runs; each snapshot changes the usage fit.
  if (warm) startPoller(undefined, () => updater.changed("usage"));
  stopUpdater();
  startUpdater({ restore: warm });
  return server;
}

if (import.meta.main) {
  loadDotenv(undefined, ["ALEPH_UI_PASSWORD"]);
  const i = process.argv.indexOf("--port");
  const port = Number(i >= 0 ? process.argv[i + 1] : uiPort());
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("usage: aleph-ui [--port <n>]");
    process.exit(2);
  }
  const server = await serve(port);
  console.log(`http://127.0.0.1:${server.port}/`);
}
