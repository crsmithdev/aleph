import { afterAll, expect, test } from "bun:test";
import { pickSet, routes, sources } from "./api/list.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/list.js";


const J = [{ name: "aleph-9", repo: "aleph", item: { id: 9, title: "Fix <it>" }, state: "landed", started: "2026-10-27T10:00:00Z", ended: "2026-10-27T10:25:00Z", cost: 1.5, model: "opus" }];
const I = [{ id: 3, repo: "aleph", title: "An issue", status: "open", labels: ["goal", "ui"], updated: "2026-10-26", notes: 2 }];
const P = [{ key: "aleph", path: "/w/aleph", factory: true, openItems: 4, lastLanded: { name: "aleph-8", at: "2026-10-27T09:00:00Z" }, behind: 1, activity: null }];
const S = { base: "", sessions: [{ id: "abcdef1234", project: "aleph", firstPrompt: "hello", turns: 3, start: "2026-10-27T08:00:00Z", last: "2026-10-27T08:30:00Z", cost: 0.25, taskTypes: ["code_edit"] }] };

sources.jobs = () => Response.json(J);
sources.issues = () => Response.json(I);
sources.projects = () => Response.json(P);
sources.sessions = () => Response.json(S);

const real = { ...sources };
afterAll(() => Object.assign(sources, real));

const get = async (q: string): Promise<any> => {
  const url = new URL("http://x/api/list" + q);
  return (await routes["GET /api/list"](new Request(url), {}, url) as Response).json();
};

test("each set maps to the shared fields and its own details", async () => {
  expect((await get("?set=jobs")).rows[0]).toMatchObject({ set: "jobs", project: "aleph", id: "aleph-9", title: "Fix <it>", state: "landed", cost: 1.5, details: [["took", "25m"], ["model", "opus"]], href: "#/jobs/aleph-9" });
  expect((await get("?set=issues")).rows[0]).toMatchObject({ id: "aleph#3", state: "open", cost: null, details: [["labels", "goal,ui"], ["notes", "2"]], href: "#/issues/aleph/3" });
  expect((await get("?set=projects")).rows[0]).toMatchObject({ id: "aleph", when: "2026-10-27T09:00:00Z", details: [["open issues", "4"], ["last land", "aleph-8"], ["behind", "1"]], href: "#/projects/aleph" });
  expect((await get("?set=sessions")).rows[0]).toMatchObject({ id: "abcdef12", title: "hello", cost: 0.25, details: [["turns", "3"], ["kinds", "code_edit"]], href: "#/sessions/abcdef1234" });
});

test("an unknown set is the jobs set", async () => {
  expect((await get("?set=nope")).set).toBe("jobs");
  expect((await get("")).set).toBe("jobs");
  expect(pickSet("issues")).toBe("issues");
});

test("the hash set picks the set", () => {
  expect(v.pickSet(new URLSearchParams("set=sessions&project=aleph"))).toBe("sessions");
  expect(v.pickSet(new URLSearchParams("set=bogus"))).toBe("jobs");
  expect(v.pickSet(new URLSearchParams(""))).toBe("jobs");
});

test("the view renders the shared columns, one Details cell, links and the set control", async () => {
  const h = v.renderList(await get("?set=jobs"));
  for (const t of ["<th>When</th>", "<th>Project</th>", "<th>Id</th>", "<th>Title</th>", "<th>State</th>", "<th>Cost</th>", "<th>Details</th>", 'href="#/jobs/aleph-9"', "took 25m", "model opus", "Fix &lt;it&gt;", "<wa-radio-group", 'value="jobs"']) expect(h).toContain(t);
  const s = v.renderList(await get("?set=issues"));
  expect(s).toContain("labels goal,ui");
  expect(s).toContain('<td class="num"></td>');
});
