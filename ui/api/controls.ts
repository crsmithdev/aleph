/** `POST /api/pause` and `POST /api/resume`: the `aleph` command of that name, run through ui/action.ts. */
import { aleph, post } from "../action.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "POST /api/pause": post(() => aleph(["pause"])),
  "POST /api/resume": post(() => aleph(["resume"])),
};
