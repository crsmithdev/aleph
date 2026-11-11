/**
 * `GET /api/design`: the text of docs/design.md, for the Kit page to show each component's rules beside its specimen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "GET /api/design": () => Response.json({ body: readFileSync(join(import.meta.dir, "..", "..", "docs", "design.md"), "utf8") }),
};
