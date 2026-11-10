/** `POST /api/standing/:reason` (`{ "action": "<action>" }`): `aleph always grant`, run through ui/action.ts. */
import { aleph, fail, post } from "../action.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "POST /api/standing/:reason": post((body, { reason }) => {
    if (typeof body.action !== "string" || !body.action) fail(400, "send an action");
    return aleph(["always", "grant", "--", reason, body.action]);
  }),
};
