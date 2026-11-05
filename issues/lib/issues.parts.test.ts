import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedPart, setup, teardown } from "../../jobs/cli.helpers";
import { issueAdd, issueClose, issueEdit, issueNote, issueShow, status } from "../../jobs/inproc";

// The verbs of `aleph issue` on a part `<n>.<k>`, and the drop of a part, called in-process as the CLI calls them.
beforeAll(setup);
afterAll(teardown);

const SPEC = "## Goal\n\nAdd a line.\n\n## Oracle\n\n`bun test`\n\n## Time box\n\n10 minutes\n";
const add = async (title = "t") => (await issueAdd("fac", title, { request: "Why." }, { ALEPH_DISPATCH: "off" })).json.added as number;
const show = async (ref: number | string) => (await issueShow("fac", ref)).json;
/** The line `aleph status <ref>` prints. */
const statusLine = async (ref: string) => { const s = (await status(ref)).json; return [s.id, s.stage, s.why].filter(Boolean).join(" "); };

describe("the drop of a part", () => {
  test("dropping the only open part sets the part-dropped Ask, and status says waiting", async () => {
    const n = await add();
    seedPart("fac", n, 1);
    const r = await issueClose("fac", `${n}.1`, "drop", "not needed");
    expect(r.code, r.stderr).toBe(0);
    const issue = await show(n);
    expect(issue.ask).toMatchObject({ kind: "input", reason: "part-dropped" });
    expect(issue.ask.options.map((o: any) => o.label)).toEqual(["Close with what landed", "Plan the missing part"]);
    expect(await statusLine(`fac-${n}`)).toContain("waiting");
  });

  test("a second open part means no Ask", async () => {
    const n = await add();
    seedPart("fac", n, 1);
    seedPart("fac", n, 2, {}, "second");
    const r = await issueClose("fac", `${n}.1`, "drop", "not needed");
    expect(r.code, r.stderr).toBe(0);
    expect((await show(n)).ask).toBeNull();
    expect(await statusLine(`fac-${n}`)).not.toContain("awaiting");
  });
});

describe("the verbs on a part", () => {
  test("show --json, note, and edit; after takes a plain or a dotted ref", async () => {
    const n = await add("Listed");
    const m = await add("Other");
    seedPart("fac", n, 1, {}, "Part", SPEC);
    expect((await issueNote("fac", `${n}.1`, "a worker note")).code).toBe(0);
    const e = await issueEdit("fac", `${n}.1`, { title: "Renamed", priority: "high", after: [`fac-${m}`] });
    expect(e.code, e.stderr).toBe(0);
    const shown = await show(`${n}.1`);
    expect(shown).toMatchObject({ title: "Renamed", priority: "high", after: [`fac-${m}`] });
    expect(shown.spec).toContain("## Goal");
    expect(shown.notes.join("\n")).toContain("a worker note");
    expect((await issueEdit("fac", `${n}.1`, { after: ["fac-9999"] })).code).toBe(1);
  });
});
