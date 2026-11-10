/** `GET /api/annotations` lists the notes; `POST /api/annotations` puts one (`{ ...note }`); `POST /api/annotations/:id/drop` drops one. */
import { drop, load, put, type Note } from "../../lib/annotations.ts";
import { post } from "../action.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "GET /api/annotations": () => Response.json(load()),
  "POST /api/annotations": post((note: Note) => put(note)),
  "POST /api/annotations/:id/drop": post((_body, { id }) => drop(id)),
};
