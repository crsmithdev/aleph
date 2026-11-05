/** The model routes: each tier's enable and model, and the local server's state. */
import { LOCAL, readModels, setModel } from "../../jobs/lib/routing/models.ts";
import { sameSite, text } from "../http.ts";
import type { Routes } from "../server.ts";

/** "up" when the local server's /health answers ok, else "down". */
const health = async (): Promise<"up" | "down"> => {
  try { return (await fetch(`${LOCAL.baseUrl}/health`, { signal: AbortSignal.timeout(2000) })).ok ? "up" : "down"; } catch { return "down"; }
};
const body = async () => ({ tiers: readModels(), local: await health() });

export const routes: Routes = {
  "GET /api/models": async () => Response.json(await body()),
  "POST /api/models": async (req) => {
    if (!sameSite(req)) return text("forbidden", 403);
    const b: any = await req.json().catch(() => null);
    const bad = (error: string) => Response.json({ error }, { status: 422 });
    if (b?.model !== undefined && typeof b.model !== "string") return bad("model is not a string");
    if (b?.enabled !== undefined && typeof b.enabled !== "boolean") return bad("enabled is not a boolean");
    if (b?.model === LOCAL.model && (await health()) === "down") return bad("the local server is down");
    const e = setModel(String(b?.tier), { ...(b?.model !== undefined ? { model: b.model } : {}), ...(b?.enabled !== undefined ? { enabled: b.enabled } : {}) });
    if (e) return bad(e);
    return Response.json(await body());
  },
};
