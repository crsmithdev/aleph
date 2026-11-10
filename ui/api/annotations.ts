/**
 * The annotations of the kit's note tool (ui/vendor/kit/annotate.js, lib/annotations.ts). `GET /api/annotations`
 * answers every note; the updater keeps it and sends `change` when the file changes, so a page shows an agent's
 * note or reply. `POST /api/annotations` puts one note and `POST /api/annotations/:id/drop` deletes one, each through
 * `aleph annotation`, as every UI action runs the CLI.
 */
import { aleph, post } from "../action.ts";
import { read } from "../../lib/annotations.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "GET /api/annotations": () => Response.json(read()),
  "POST /api/annotations": post((body) => aleph(["annotation", "put"], { stdin: JSON.stringify(body) })),
  "POST /api/annotations/:id/drop": post((_body, params) => aleph(["annotation", "drop", "--", params.id])),
};
