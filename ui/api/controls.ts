/** `POST /api/factory/pause` and `POST /api/factory/resume`: the `aleph` command of that name, run through ui/action.ts. */
import { aleph, post } from "../action.ts";
import type { Routes } from "../server.ts";

export const routes: Routes = {
  "POST /api/factory/pause": post(() => aleph(["pause"])),
  "POST /api/factory/resume": post(() => aleph(["resume"])),
};
