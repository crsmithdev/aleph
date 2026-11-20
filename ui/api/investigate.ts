/**
 * The investigator's routes: start a run on an issue or a job, and file, note or dismiss one recommended issue of a run.
 * Filing and noting go through the CLI, the one issue path; the fate goes on the run's result.json.
 */
import { aleph, fail, post } from "../action.ts";
import { findingOf, setFate } from "../../jobs/lib/roles/investigator.ts";
import { getRun } from "../../jobs/lib/records/record.ts";
import { issueKey } from "../../lib/naming.ts";
import { issueKeyOf } from "../../jobs/lib/records/ledger.ts";
import type { Routes } from "../server.ts";

/** The issue an issue's or a job's finding refers to: the issue itself, or the issue the job is on. */
const refOf = (subject: string): string | undefined => (subject.startsWith("issue.") ? subject : issueKeyOf(getRun(subject) ?? {}));

/** `{ act: "file" | "note" | "dismiss" }` on issue `i` of run `id`. */
const act = post(async (b, { id, i }) => {
  const at = findingOf(id, Number(i)) ?? fail(404, "no such finding");
  const { finding: f } = at;
  if (f.fate) fail(422, `already ${f.fate}`);
  const spec = `${f.spec}\n\nEvidence: ${f.evidence.join(", ")}\n\nFrom ${at.subject}'s investigation ${id}.`;
  if (b.act === "file") {
    const ref = refOf(at.subject);
    const r = await aleph(["issue", "add", "--spec", "-", "--kind", f.kind, ...(ref ? ["--refs", ref] : []), "--", at.repo, f.title], { stdin: spec });
    setFate(id, Number(i), `filed ${issueKey(r.added)}`);
  } else if (b.act === "note" && f.existing) {
    // A note is one line.
    await aleph(["issue", "note", "--", f.existing, `${f.title}: ${spec.replace(/\s+/g, " ")}`]);
    setFate(id, Number(i), `noted ${f.existing}`);
  } else if (b.act === "dismiss") setFate(id, Number(i), "dismissed");
  else fail(400, "act is file, note or dismiss");
  return {};
});

export const routes: Routes = {
  "POST /api/investigate": post((b) => aleph(["investigate", "--detach", "--", String(b.subject ?? "")])),
  "POST /api/investigations/:id/:i": act,
};
