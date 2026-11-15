/** The model routes: each size's and role model's enable and model, what each offers, which models' backends are down, and OpenRouter's spend. */
import { MODELS } from "../../lib/models.ts";
import { backendUp, OFFERS, openRouterSpend, readModels, setModel } from "../../jobs/lib/routing/models.ts";
import { fail, post } from "../action.ts";
import type { Routes } from "../server.ts";

/** The models whose backend cannot take a call now: the local server when /health fails, OpenRouter's with no key. */
const downModels = async (): Promise<string[]> => {
  const names = Object.keys(MODELS);
  const up = await Promise.all(names.map(backendUp));
  return names.filter((_, i) => !up[i]);
};
const body = async () => {
  const [down, spend] = await Promise.all([downModels(), openRouterSpend()]);
  return { models: readModels(), offers: OFFERS, down, local: down.includes("gpt-oss-20b") ? "down" : "up", spend };
};

export const routes: Routes = {
  "GET /api/models": async () => Response.json(await body()),
  "POST /api/models": post(async (b) => {
    if (b.model !== undefined && typeof b.model !== "string") fail(422, "model is not a string");
    if (b.enabled !== undefined && typeof b.enabled !== "boolean") fail(422, "enabled is not a boolean");
    if (b.model !== undefined && Object.hasOwn(MODELS, b.model) && !(await backendUp(b.model))) fail(422, `the backend of ${b.model} is down`);
    const e = setModel(String(b.name), { ...(b.model !== undefined ? { model: b.model } : {}), ...(b.enabled !== undefined ? { enabled: b.enabled } : {}) });
    if (e) fail(422, e);
    return body();
  }),
};
