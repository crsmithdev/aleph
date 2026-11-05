/** The Models card's routes: which backend serves each model slot, and the local server's state. */
import { BACKENDS, LOCAL, SLOTS, readModels, setModel } from "../../jobs/lib/models.ts";
import { sameSite, text } from "../http.ts";
import type { Routes } from "../server.ts";

/** "up" when the local server's /health answers ok, else "down". */
const health = async (): Promise<"up" | "down"> => {
  try { return (await fetch(`${LOCAL.baseUrl}/health`, { signal: AbortSignal.timeout(2000) })).ok ? "up" : "down"; } catch { return "down"; }
};
const body = async () => ({ slots: readModels(), local: await health() });

export const routes: Routes = {
  "GET /api/models": async () => Response.json(await body()),
  "POST /api/models": async (req) => {
    if (!sameSite(req)) return text("forbidden", 403);
    const b: any = await req.json().catch(() => null);
    const bad = (error: string) => Response.json({ error }, { status: 422 });
    if (!SLOTS.includes(b?.slot)) return bad(`unknown slot; slots: ${SLOTS.join(", ")}`);
    if (!BACKENDS.includes(b?.backend)) return bad(`unknown backend; backends: ${BACKENDS.join(", ")}`);
    if (b.backend === "local" && (await health()) === "down") return bad("the local server is down");
    setModel(b.slot, b.backend);
    return Response.json(await body());
  },
};
