/** The model routes: each tier's enable and model, what each tier offers, which models' backends are down, and OpenRouter's spend. */
import { backendUp, MODELS, OFFERS, openRouterSpend, readModels, setModel } from "../../jobs/lib/routing/models.ts";
import { sameSite, text } from "../http.ts";
import type { Routes } from "../server.ts";

/** The models whose backend cannot take a call now: the local server when /health fails, OpenRouter's with no key. */
const downModels = async (): Promise<string[]> => {
  const names = Object.keys(MODELS);
  const up = await Promise.all(names.map(backendUp));
  return names.filter((_, i) => !up[i]);
};
const body = async () => {
  const [down, spend] = await Promise.all([downModels(), openRouterSpend()]);
  return { tiers: readModels(), offers: OFFERS, down, local: down.includes("gpt-oss-20b") ? "down" : "up", spend };
};

export const routes: Routes = {
  "GET /api/models": async () => Response.json(await body()),
  "POST /api/models": async (req) => {
    if (!sameSite(req)) return text("forbidden", 403);
    const b: any = await req.json().catch(() => null);
    const bad = (error: string) => Response.json({ error }, { status: 422 });
    if (b?.model !== undefined && typeof b.model !== "string") return bad("model is not a string");
    if (b?.enabled !== undefined && typeof b.enabled !== "boolean") return bad("enabled is not a boolean");
    if (b?.model !== undefined && Object.hasOwn(MODELS, b.model) && !(await backendUp(b.model))) return bad(`the backend of ${b.model} is down`);
    const e = setModel(String(b?.tier), { ...(b?.model !== undefined ? { model: b.model } : {}), ...(b?.enabled !== undefined ? { enabled: b.enabled } : {}) });
    if (e) return bad(e);
    return Response.json(await body());
  },
};
