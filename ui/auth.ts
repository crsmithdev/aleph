/**
 * The UI's password gate. ALEPH_UI_PASSWORD unset or empty: the gate is off.
 * Otherwise a request needs the `aleph_session` cookie, whose token is in
 * `<ALEPH_FACTORY_DIR>/ui-sessions.json`, so a restart keeps every device logged in.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Routes } from "./server.ts";

const COOKIE = "aleph_session";
const password = () => process.env.ALEPH_UI_PASSWORD ?? "";
export const gateOn = () => password() !== "";

function sessionsPath(): string {
  const d = process.env.ALEPH_FACTORY_DIR ?? "~/.aleph/factory";
  return join(d === "~" || d.startsWith("~/") ? homedir() + d.slice(1) : d, "ui-sessions.json");
}

function readSessions(): string[] {
  try {
    const v = JSON.parse(readFileSync(sessionsPath(), "utf8"));
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch { return []; }
}

function writeSessions(tokens: string[]): void {
  const p = sessionsPath();
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(tokens));
}

function cookieToken(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

const hasSession = (req: Request) => {
  const t = cookieToken(req);
  return t !== null && readSessions().includes(t);
};

export function loginPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aleph — sign in</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1115;color:#e6e8ec;font:16px system-ui,sans-serif}
form{display:flex;flex-direction:column;gap:12px;width:260px}
input,button{padding:10px 12px;border-radius:6px;border:1px solid #2a2f3a;background:#171a21;color:inherit;font:inherit}
button{background:#3b6ef5;border-color:#3b6ef5;cursor:pointer}
#err{color:#ff6b6b;min-height:1.2em;font-size:14px}
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

/** null: let the request through. Otherwise the refusal. */
export function gate(req: Request): Response | null {
  if (!gateOn()) return null;
  const path = new URL(req.url).pathname;
  if (path === "/api/login") return null;
  if (hasSession(req)) return null;
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
    if (t) writeSessions(readSessions().filter((s) => s !== t));
    return new Response(null, { status: 204, headers: { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
  },
};
