/** Helpers shared by the UI API routes. Outside `ui/api/`, so the route loader does not load it. */

/** True when a POST carries `X-Aleph-UI: 1` and, if it has an Origin, the server's own. */
export function sameSite(req: Request): boolean {
  if (req.headers.get("x-aleph-ui") !== "1") return false;
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}
