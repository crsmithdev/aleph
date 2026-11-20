/**
 * Test helpers for the jobs table: put a job in the ledger with the fields a test cares about, change one, and remove one.
 * A job gets the next number of the `job` counter, so a test never names a key before it exists.
 */
import { rmSync } from "node:fs";
import { conn } from "../lib/db.ts";
import { jobFolder } from "./lib/records/run-files.ts";
import { makeJob, patchRun, setState, type RunRecord } from "./lib/records/record.ts";
import type { Run } from "./lib/records/ledger.ts";
import type { State } from "../lib/naming.ts";

export type Seed = Partial<Omit<Run, "job" | "state" | "role">> & Pick<Run, "role"> & { state?: State };

/** Make a job with `fields`: a name and `told` unless given; `started` is now. Returns its key, its folder and its row. */
export function seed({ state, ...fields }: Seed): { id: string; folder: string; run: RunRecord } {
  return makeJob({ name: "job", told: true, ...fields, role: fields.role, state: state ?? "done" });
}

/** Change job `id`: its state when `fields` holds one, then its other fields. */
export function reseed(id: string, { state, ...fields }: Partial<Omit<Run, "job">>): RunRecord {
  if (state) setState(id, state, fields);
  else if (Object.keys(fields).length) patchRun(id, fields);
  return patchRun(id, {});
}

/** Remove job `id`: its row and its folder, so a later test does not see it. */
export function unseed(id: string): void {
  conn().run("DELETE FROM jobs WHERE id = ?", [id]);
  rmSync(jobFolder(id), { recursive: true, force: true });
}
