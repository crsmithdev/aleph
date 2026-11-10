/**
 * The UI's password gate. ALEPH_UI_PASSWORD unset or empty: the UI answers only
 * a request whose Host header names this machine, with no login; any other Host gets a 403 page.
 * Otherwise a request needs the `aleph_session` cookie, whose token is in
 * `<ALEPH_FACTORY_DIR>/ui-sessions.json`, so a restart keeps every device logged in.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Routes } from "./server.ts";
import { readSessions, writeSessions } from "../jobs/lib/infra/ui-token.ts";
import { uiPassword } from "../jobs/lib/infra/settings.ts";

const COOKIE = "aleph_session";
const password = () => uiPassword();
export const gateOn = () => password() !== "";

export function cookieToken(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** Called with the token of each session that logs out. */
export const onLogout: ((token: string) => void)[] = [];

const hasSession = (req: Request) => {
  const t = cookieToken(req);
  return t !== null && readSessions().includes(t);
};

export function loginPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aleph — sign in</title>
<link rel="stylesheet" href="/app.css">
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--ink);font:var(--fs-md)/1.5 var(--sans)}
form{display:flex;flex-direction:column;gap:var(--sp-12);width:260px}
input,button{padding:var(--sp-10) var(--sp-12);border-radius:var(--r-ctl);border:1px solid var(--rule);background:var(--sunk);color:inherit;font:inherit}
button{background:var(--run);border-color:var(--run);color:var(--on-fill);cursor:pointer}
#err{color:var(--stuck);min-height:1.2em}
</style></head><body>
<form id="f"><input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
<button type="submit">Sign in</button><div id="err" role="alert"></div></form>
<script>
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: e.target.password.value }) });
  if (r.status === 204) location.reload();
  else document.getElementById("err").textContent = r.status === 401 ? "wrong password" : "error " + r.status;
});
</script></body></html>
`;
}

const local = (req: Request) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(req.headers.get("host") ?? "");

const noPassword = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Aleph — password needed</title></head>
<body><p>Set ALEPH_UI_PASSWORD in ~/.aleph/.env first.</p></body></html>
`;

/** null: let the request through. Otherwise the refusal. */
export function gate(req: Request): Response | null {
  if (!gateOn()) {
    return local(req) ? null : new Response(noPassword, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const path = new URL(req.url).pathname;
  if (path === "/api/login") return null;
  if (hasSession(req)) return null;
  if (req.method === "GET" && path === "/app.css") return null; // the login page's tokens
  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    return new Response(loginPage(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  }
  return new Response("unauthorized", { status: 401 });
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const routes: Routes = {
  "POST /api/login": async (req) => {
    if (!gateOn()) return new Response("not found", { status: 404 });
    const body = await req.json().catch(() => null) as { password?: unknown } | null;
    const given = typeof body?.password === "string" ? body.password : "";
    if (!same(given, password())) return Response.json({ error: "wrong password" }, { status: 401 });
    const token = randomBytes(32).toString("hex");
    writeSessions([...readSessions(), token]);
    return new Response(null, { status: 204, headers: { "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` } });
  },
  "POST /api/logout": (req) => {
    const t = cookieToken(req);
    if (t) {
      writeSessions(readSessions().filter((s) => s !== t));
      for (const f of onLogout) f(t);
    }
    return new Response(null, { status: 204, headers: { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
  },
};
