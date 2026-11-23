/**
 * `GET /api/design`: the design index (tokens, components and rules) from aleph-tools, for the Design page to show each
 * component's file and rules beside its specimen. 404 when aleph-tools is missing.
 */
import { join } from "node:path";
import { design } from "../dock.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "GET /api/design": () => design ? Response.json(design.index(join(import.meta.dir, "..", ".."))) : new Response("not found", { status: 404 }),
};
