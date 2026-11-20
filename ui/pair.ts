/**
 * Device pairing. home-proxy passes any LAN client's headers to the UI, so a header proves nothing. A paired device
 * holds the cookie `aleph_device=<token>`; `~/.aleph/ui-tokens` keeps one `<sha256-hex> <label> <iso-date>` line per
 * token. Every request except GET and HEAD needs a paired cookie. The file is small, so each check reads it.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { uiTokensFile } from "../lib/paths.ts";

const COOKIE = "aleph_device";
const TEN_YEARS = 10 * 365 * 24 * 3600;

export const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const lines = () => (existsSync(uiTokensFile()) ? readFileSync(uiTokensFile(), "utf8").split("\n").filter(Boolean) : []);
const save = (rows: string[]) => writeFileSync(uiTokensFile(), rows.map((r) => `${r}\n`).join(""), { mode: 0o600 });

/** Adds a device and returns its token, shown once. A label already in use is refused. */
export function addDevice(label?: string): { token: string; label: string } {
  const token = randomBytes(32).toString("base64url");
  const name = label ?? `device-${token.slice(0, 4)}`;
  if (/\s/.test(name)) throw new Error("a label has no spaces");
  if (devices().some((d) => d.label === name)) throw new Error(`device ${name} exists`);
  save([...lines(), `${hash(token)} ${name} ${new Date().toISOString()}`]);
  return { token, label: name };
}

/** True when a device carried `label`, now dropped. */
export function dropDevice(label: string): boolean {
  const rows = lines();
  const kept = rows.filter((r) => r.split(" ")[1] !== label);
  if (kept.length === rows.length) return false;
  save(kept);
  return true;
}

export const devices = (): { label: string; date: string }[] => lines().map((r) => { const [, label, date] = r.split(" "); return { label, date }; });

const known = (token: string) => token !== "" && lines().some((r) => r.split(" ")[0] === hash(token));

const cookieOf = (req: Request) => req.headers.get("cookie")?.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";

/** The 401 for a POST from a device that is not paired; null for a read or a paired device. */
export function gate(req: Request): Response | null {
  if (req.method === "GET" || req.method === "HEAD" || known(cookieOf(req))) return null;
  return Response.json({ error: "pair this device: aleph ui pair" }, { status: 401 });
}

// The script reads the token from the fragment, which the server never sees, so no log holds it.
const PAGE = `<!doctype html><meta charset="utf-8"><title>pair</title><p id="m">pairing</p><script>
const token = location.hash.slice(1);
history.replaceState(null, "", "/pair");
fetch("/pair", { method: "POST", body: token }).then((r) => { if (r.ok) location.replace("/"); else document.getElementById("m").textContent = "unknown token"; });
</script>`;

/** The answer to GET and POST `/pair`; null for any other path. */
export async function pairRoute(req: Request): Promise<Response | null> {
  if (new URL(req.url).pathname !== "/pair") return null;
  if (req.method === "GET") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const token = (await req.text()).trim();
  if (!known(token)) return Response.json({ error: "unknown token" }, { status: 401 });
  return new Response(null, { status: 204, headers: { "set-cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TEN_YEARS}` } });
}
