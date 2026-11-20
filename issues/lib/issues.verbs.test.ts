import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Refusal } from "../../lib/refusal.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { breakItem, doc, env, fx, issueFile, remoteItem, sec, seed, sh, useFixture } from "../issues.testkit.ts";
import * as store from "../../lib/store.ts";
import * as issues from "../../lib/todo.ts";
import { addPart } from "./parts.testkit.ts";
import * as verbs from "./issues.ts";
import { readEvents } from "../../lib/layout.ts";
import { askOf, grant, PART_DROPPED, plainAsk, refIn, revoke, setAsk, askOfItem } from "../../jobs/lib/asks/ask.ts";

setDefaultTimeout(30000);

// The verbs of `aleph issue`, called in-process as cli/cli.ts calls them, under the CLI's environment.
// issues/cli.test.ts keeps the CLI test of each verb's wiring.
// The save runs before useFixture's hooks and the restore after them, so the restore does not bring back the fixture's deleted ALEPH_DB.
let saved: Record<string, string | undefined> = {};
beforeEach(() => { saved = { ...process.env }; });
useFixture();
beforeEach(() => { Object.assign(process.env, env()); });
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

const proj = () => loadRegistry().proj!;
/** The verb's value with the exit code the CLI would give: 1 for a refusal. */
async function code<T>(f: () => T | Promise<T>): Promise<{ code: number; value?: T }> {
  try { return { code: 0, value: await f() }; } catch (e) { if (!(e instanceof Refusal)) throw e; return { code: 1 }; }
}
/** The full id of each issue the verb's filing passed to `after`. */
let started: string[] = [];
const add = async (title: string, fields: verbs.Fields = {}) => { verbs.checkFields(fields); return verbs.add(proj(), title, fields, { after: (r, i) => { started.push(`${r.key}-${i.id}`); } }); };
const list = (o: { status?: string; label?: string } = {}) => verbs.list(proj(), o).map(verbs.brief);
const show = (id: number) => { const i = verbs.show(proj(), id); return { ...verbs.brief(i), request: i.request, spec: i.spec, notes: i.notes }; };
/** The lines `aleph issue lint` prints on stderr, and its exit code. */
function lint(): { code: number; err: string } {
  try {
    const l = verbs.lint(proj());
    return { code: l.findings.length ? 1 : 0, err: l.findings.map((f) => `item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`).join("\n") };
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    return { code: 1, err: e.message };
  }
}

test("a write from a store clone that is behind lands on top of main and keeps main's change", async () => {
  const other = join(fx.base, "other");
  sh(fx.base, "git", "clone", "-q", fx.remote, other);
  writeFileSync(join(other, "readme.txt"), "x\n");
  sh(other, "git", "add", "readme.txt");
  sh(other, "git", "commit", "-qm", "readme");
  sh(other, "git", "push", "-q", "origin", "main");
  expect((await code(() => add("After the readme"))).code).toBe(0);
  expect(sh(fx.base, "git", "--git-dir", fx.remote, "log", "--format=%s", "-2", "main")).toBe("proj: todo: add an item\nreadme");
  expect(existsSync(join(fx.items, "readme.txt"))).toBe(true);
});

test("a write with a changed file in the store's checkout still reaches main, and says the checkout did not follow", async () => {
  writeFileSync(join(fx.items, issueFile(3)), "local edit\n");
  const a = await code(() => add("Despite the edit"));
  expect(a.code).toBe(0);
  expect(remoteItem(4)).toContain("Despite the edit");
  expect(a.value!.follow).toContain(`main checkout not updated: it has changes in ${issueFile(3)}`);
  expect(doc(3)).toBe("local edit\n");
});

test("add allocates the next id and list shows it", async () => {
  const a = await code(() => add("Teach the gate to count"));
  expect(a.code).toBe(0);
  expect(a.value!.result.added).toBe(4);
  const rows = list();
  expect(rows.map((r: any) => r.id)).toEqual([3, 4]);
  expect(rows[1]).toMatchObject({ status: "open", priority: "medium", source: "chris", areas: [] });
  expect(rows[1]).not.toHaveProperty("labels");
});

test("a title that YAML would misread is quoted in the file and comes back exactly", async () => {
  const title = '`/play` says "done" \\ then # drops it';
  expect((await code(() => add(title))).code).toBe(0);
  expect(remoteItem(4)).toContain(`title: ${JSON.stringify(title)}\n`);
  expect(show(4).title).toBe(title);
});

test("labels filter, and a flag value never lands in the title", async () => {
  await add("Audio thing", { labels: ["audio", "phone"], priority: "high" });
  await add("Other thing", { labels: ["build"] });
  const rows = list();
  expect(rows.map((r: any) => r.title)).toEqual(["An old item", "Audio thing", "Other thing"]);
  expect(rows[1]).toMatchObject({ priority: "high", areas: ["audio", "phone"] });
  expect(list({ label: "audio" }).map((r: any) => r.id)).toEqual([4]);
});

test("lint refuses an unknown status, and --fix cannot save it", () => {
  seed(`# To do\n\n## 8. One\n---\nid: 8\nstatus: maybe\ncreated: 2026-09-01T00:00:00.000Z\n---\n\nA.\n`);
  const r = lint();
  expect(r.code).toBe(1);
  expect(r.err).toContain('closed_as "maybe" is not done or dropped');
  // `--fix` exits 1 when findings remain.
  expect(verbs.lintFix(proj()).result.remaining.length).toBeGreaterThan(0);
});

test("add takes a body of several lines", async () => {
  // The CLI reads it from stdin with `--request -` and trims it.
  expect((await code(() => add("Count at the gate", { request: "Why it matters.\n\nDone when the gate counts.\n".trim() }))).code).toBe(0);
  expect(show(4).request).toBe("Why it matters.\n\nDone when the gate counts.");
  expect(remoteItem(4)).toContain("---\n\n# Request\n\nWhy it matters.\n\nDone when the gate counts.");
});

test("park: the reason is a note, closed_as stays unset, list shows parked, --status parked filters, open unparks and add files parked", async () => {
  await add("Needs a look");
  const p = await code(() => verbs.edit(proj(), 4, { status: "parked" }, "needs more investigation"));
  expect(p.code).toBe(0);
  expect(p.value!.result.status).toBe("parked");
  expect(doc(4)).not.toContain("closed_as");
  expect(doc(4)).toContain("needs more investigation");
  const ids = (o: { status?: string } = {}) => list(o).map((r: any) => r.id);
  expect(ids()).toEqual([3, 4]);
  expect(ids({ status: "parked" })).toEqual([4]);
  expect(verbs.edit(proj(), 4, { status: "open" }).result.status).toBe("open");
  const a = await add("Filed parked", { status: "parked" });
  expect(show(a.result.added).status).toBe("parked");
});

test("lint refuses a labels field and a waiting_on field and names the item", async () => {
  await add("Broken");
  breakItem("labels: [ui]\nwaiting_on: proj-1");
  const l = lint();
  expect(l.code).toBe(1);
  expect(l.err).toContain("item 4: labels is retired");
  expect(l.err).toContain("item 4: waiting_on is retired");
});

test("aleph issue lint reads an issue file and names it by its number", () => {
  const put = (created: string) => {
    seed(`# To do\n\n## 5. Parent\n---\nstatus: open\ncreated: ${created}\nkind: task\n---\n\nBody.\n`);
  };
  put("soon");
  const bad = lint();
  expect(bad.code).toBe(1);
  expect(bad.err).toContain('item 5: created "soon"');
  put("2026-09-01T00:00:00.000Z");
  const ok = lint();
  expect(ok.err).not.toContain("created");
});

test("lint refuses an after ref that is not issue.<n>", () => {
  seed(`# To do\n\n${sec(20, "spec: true\nafter: [issue.1]\nlabels: []")}\n${sec(21, "spec: true\nafter: [proj-x]\nlabels: []")}`);
  const r = lint();
  expect(r.code).toBe(1);
  expect(r.err).toContain("after: proj-x");
  expect(r.err).not.toContain("issue.1");
});

test("add and edit refuse a title over 60 characters, with a final period or with ': ', and write no commit", async () => {
  const head = () => sh(fx.base, "git", "--git-dir", fx.remote, "rev-parse", "main");
  const before = head();
  for (const t of ["x".repeat(61), "Fix it.", "Check foo: bar"]) {
    expect((await code(() => add(t))).code).toBe(1);
    expect((await code(() => verbs.edit(proj(), 3, { title: t }))).code).toBe(1);
  }
  expect(head()).toBe(before);
});

test("drop: clears the Ask on the issue", async () => {
  await add("Asks something");
  const ask = { kind: "input" as const, reason: "question", question: "q?", options: [], why: [] };
  setAsk(refIn({ id: 4 } as any), ask);
  expect(askOfItem({ id: 4 } as any)).not.toBeNull();
  verbs.close(proj(), 4, "drop", "not needed");
  expect(askOfItem({ id: 4 } as any)).toBeNull();
});

test("media: add and attach store images in the store, and a run reads them back", async () => {
  const png = join(fx.base, "shot.png"), pdf = join(fx.base, "spec sheet.pdf");
  writeFileSync(png, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 1]));
  writeFileSync(pdf, "%PDF-1.4");
  const a = await add("Fix the header", { request: "see the shot", media: [png] });
  verbs.attach(proj(), a.item.id, [png, pdf]);
  const item = verbs.show(proj(), a.item.id);
  expect(issues.mediaOf(item)).toEqual(["shot.png", "shot-2.png", "spec_sheet.pdf"]);
  const files = store.mediaFiles(item);
  expect(readFileSync(files[0])).toEqual(readFileSync(png));
  expect(readFileSync(files[2], "utf8")).toBe("%PDF-1.4");
  // A run on a part of the issue reads the issue's media, then its own.
  const child = store.writeList(proj(), "a child", (d) => addPart(d, d.items.find((i) => i.id === a.item.id)!, { title: "Fix the logo", spec: "## Goal\nx" }).id)!.value;
  const part = verbs.attach(proj(), child, [pdf]);
  expect(part.result.media).toEqual(["spec_sheet.pdf"]);
  expect(store.runMedia("proj", child)).toEqual([...files, join(fx.items, "issues", String(child), "spec_sheet.pdf")]);
  writeFileSync(join(fx.base, "clip.mp4"), "x");
  expect((await code(() => verbs.attach(proj(), a.item.id, [join(fx.base, "clip.mp4")]))).code).toBe(1);
});

test("retitle gives a bad title of an open or parked issue a new one, keeps a child's group and leaves a done issue", async () => {
  const a = await add("Fix the first"), b = await add("Fix the second"), c = await add("Fix the third");
  store.writeList(proj(), "bad titles", (d) => {
    const [x, y, z] = [a, b, c].map((n) => issues.find(d, n.item.id)!);
    x.title = "Check foo: bar";
    y.title = "[Group] Check foo: bar.";
    y.fm.from = `issue.${x.id}`;
    y.fm.parked = "true";
    z.title = "Done foo: bar";
    z.fm.closed_as = "done";
    return true;
  });
  const stub = async (group: string, rest: string) => group + rest.replace(/^.*: /, "Fix ").replace(/\.$/, "");
  const r = await verbs.retitle(proj(), stub);
  expect(r.result.retitled.map((t) => t.id)).toEqual([String(a.item.id), String(b.item.id)]);
  expect(verbs.lint(proj()).findings.filter((f) => /title/.test(f.problem))).toEqual([]);
  expect(show(a.item.id).title).toBe("Fix bar");
  expect(show(b.item.id).title).toBe("[Group] Fix bar");
  expect(show(a.item.id).notes.join("\n")).toContain("retitled from: Check foo: bar");
  expect(show(b.item.id).notes.join("\n")).toContain("retitled from: [Group] Check foo: bar.");
  expect(show(c.item.id).title).toBe("Done foo: bar");
});

test("add logs a filed event, and close logs a done or a dropped event, on the issue's key", async () => {
  const before = readEvents().length;
  const added = (await add("Teach the gate to count")).result.added;
  verbs.close(proj(), added, "done");
  const b = (await add("Count the other gate")).result.added;
  verbs.close(proj(), b, "drop", "not needed");
  const mine = (n: number) => readEvents().slice(before).filter((e) => e.object === `issue.${n}`).map((e) => e.action);
  expect(mine(added)).toEqual(["filed", "done"]);
  expect(mine(b)).toEqual(["filed", "dropped"]);
});

test("add files through writeFiling: one filed event and one after per new issue; a refused title writes and starts nothing", async () => {
  started = [];
  const before = readEvents().length;
  const n = (await add("Start the dispatch on a filing")).result.added;
  expect(started).toEqual([`proj-${n}`]);
  expect(readEvents().slice(before).filter((e) => e.action === "filed").map((e) => [e.subject, e.object])).toEqual([["human", `issue.${n}`]]);
  expect((await code(() => add("Fix: the title has a prefix"))).code).toBe(1);
  expect(started).toEqual([`proj-${n}`]);
});

/** Two issues, B waiting after A; A is dropped. */
async function blockerDropped() {
  const a = (await add("The blocker")).result.added;
  const b = (await add("The waiter", { after: [`issue.${a}`] })).result.added;
  verbs.close(proj(), a, "drop", "not needed");
  return { a, b, ref: `issue.${b}` };
}

test("a dropped blocker parks the waiter, logs rule parked, and asks Chris what to do", async () => {
  const { a, b, ref } = await blockerDropped();
  expect(show(b).status).toBe("parked");
  expect(askOf(ref)).toMatchObject({ reason: "blocker-dropped", recommended: "Remove the link" });
  expect(askOf(ref)!.options.map((o) => o.label)).toEqual(["Remove the link", "Drop the waiter"]);
  expect(readEvents().filter((e) => e.object === ref && e.action === "parked")).toMatchObject([{ subject: "rule", detail: `blocker issue.${a} dropped` }]);
});

test("deciding Remove the link opens the waiter without the link and clears the Ask; Drop the waiter drops it", async () => {
  const one = await blockerDropped();
  verbs.decide(proj(), one.b, "Remove the link");
  expect(show(one.b)).toMatchObject({ status: "open", after: [], ask: null });
  const two = await blockerDropped();
  verbs.decide(proj(), two.b, "Drop the waiter");
  expect(show(two.b)).toMatchObject({ status: "dropped", ask: null });
});

test("decide logs Chris's answer to the part-dropped Ask: its reason and the option the text names, also when the answer closes the issue", async () => {
  for (const said of ["Keep open", "Close as done"]) {
    const n = (await add("The parent")).result.added, ref = `issue.${n}`;
    setAsk(ref, { ...plainAsk("part-dropped", "A sub-issue was dropped. What now?"), options: PART_DROPPED });
    verbs.decide(proj(), n, said);
    expect(readEvents().filter((e) => e.object === ref && e.action === "answered")).toMatchObject([{ subject: "human", detail: `part-dropped: ${said}` }]);
  }
});

test("a decide whose write is refused leaves the Ask in place and logs no answer", async () => {
  const n = (await add("A question")).result.added, ref = `issue.${n}`;
  setAsk(ref, plainAsk("question", "Which page?"));
  expect(() => verbs.decide(proj(), n, "page A", { after: ["issue.9999"] })).toThrow("names no issue");
  expect(askOf(ref)?.question).toBe("Which page?");
  expect(readEvents().filter((e) => e.object === ref && e.action === "answered")).toEqual([]);
});

test("an Always blocker-dropped grant scoped to the issue's project resolves the Ask; one for another project does not", async () => {
  expect(grant("blocker-dropped:elsewhere", "resolve")).toBeNull();
  try {
    expect(askOf((await blockerDropped()).ref)).toMatchObject({ reason: "blocker-dropped" });
    expect(grant("blocker-dropped:proj", "resolve")).toBeNull();
    const { b } = await blockerDropped();
    expect(show(b)).toMatchObject({ status: "open", after: [], ask: null });
  } finally { revoke("blocker-dropped:elsewhere"); revoke("blocker-dropped:proj"); }
});

test("with Always blocker-dropped resolve, a dropped blocker opens the waiter without the link and asks nothing", async () => {
  expect(grant("blocker-dropped", "resolve")).toBeNull();
  try {
    const { a, b, ref } = await blockerDropped();
    expect(show(b)).toMatchObject({ status: "open", after: [], ask: null });
    expect(readEvents().filter((e) => e.object === ref && e.subject === "rule").map((e) => [e.action, e.detail])).toEqual([["answered", "blocker-dropped: Remove the link"]]);
    expect(a).toBeGreaterThan(0);
  } finally { revoke("blocker-dropped"); }
});
