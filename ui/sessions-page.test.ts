import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/sessions.js";
// @ts-ignore plain JS, shared with the page
import { when } from "./lib.js";

const data = () => ({
  window: 7, project: null,
  activity: { langfuse: "ok", projects: ["aleph", "oth"], tools: [{ name: "Bash", calls: 100, errors: 10, lastAt: "2026-11-01T00:00:00Z" }, { name: "Monitor", calls: 10, errors: 5 }, { name: "Rare", calls: 2, errors: 2 }, { name: "Read", calls: 50, errors: 0 }], hooks: [{ name: "vault-recall", calls: 9, errors: 0, lastAt: "2026-11-01T00:00:00Z" }], denials: { total: 1, recent: [{ at: "2026-11-01T00:00:00Z", reason: "no <run>" }] } },
  skills: { projects: ["aleph"], skills: [{ name: "aleph:handoff", uses: 8, errors: 6, sessionIds: ["s2"] }], unused: ["tidy"] },
  sessions: { projects: ["aleph", "oth"], sessions: [
    { id: "s1", project: "aleph", firstPrompt: "cheap one", turns: 1, cost: 1, start: "2026-11-01T00:00:00Z", last: "2026-11-01T01:00:00Z", taskTypes: [] },
    { id: "s2", project: "oth", firstPrompt: "dear one", turns: 3, cost: 9, start: "2026-10-31T00:00:00Z", last: "2026-10-31T01:00:00Z", taskTypes: ["debug"] },
  ] },
  toolSessions: { Bash: ["s1", "s2"], Monitor: ["s1"] },
});
const opts = (q = "") => v.options(new URLSearchParams(q));
const ids = (q: string) => v.shownSessions(data(), opts(q)).map((s: any) => s.id);

describe("the Sessions page", () => {
  test("the view replaces the three old addresses and keeps their window and project", () => {
    expect(v.view).toMatchObject({ path: "/sessions", title: "Sessions", group: "claude" });
    expect(v.view.api({}, new URLSearchParams("days=30&project=x&pick=tool:Bash"))).toBe("/api/sessions?window=month&limit=2000&project=x");
    expect(v.redirect("#/agents")).toBe("#/sessions");
    expect(v.redirect("#/activity?days=30&project=x&q=y")).toBe("#/sessions?days=30&project=x");
    expect(v.redirect("#/skills")).toBe("#/sessions");
    expect(v.redirect("#/sessions/abc")).toBeNull();
    expect(v.redirect("#/skills/aleph:vault")).toBeNull();
    expect(v.redirect("#/sessions")).toBeNull();
  });

  test("the failing tiles rank by rate and leave out a tool with under five calls", () => {
    expect(v.failing(data()).map((r: any) => [r.name, Math.round(r.rate * 100)])).toEqual([["aleph:handoff", 75], ["Monitor", 50], ["Bash", 10]]);
  });

  test("a tool or skill narrows the sessions; none shows all, largest cost first", () => {
    expect(ids("")).toEqual(["s2", "s1"]);
    expect(ids("pick=tool:Monitor")).toEqual(["s1"]);
    expect(ids("pick=skill:aleph:handoff")).toEqual(["s2"]);
    expect(ids("pick=tool:Read")).toEqual([]);
    expect(ids("q=cheap")).toEqual(["s1"]);
    expect(ids("sort=last&dir=asc")).toEqual(["s2", "s1"]);
  });

  test("the page holds the old pages' content: tools, skills, unused, hooks, denials, sessions", () => {
    const h = v.renderSessions(data(), opts());
    expect(h).toContain('<header class="ph"><h1>Sessions</h1><div class="aside"><div class="fbar">');
    for (const s of ["Bash", "aleph:handoff", 'href="#/skills/tidy"', "vault-recall", "no &lt;run&gt;", 'title="s1" href="#/sessions/s1"', "dear one"]) expect(h).toContain(s);
    expect(h).not.toContain("no <run>");
    expect(h).toContain('<th class="num">Errors</th><th class="num">Last Call</th>');
    expect(h).toContain("<th>Denied</th><th>Reason</th>");
    expect(h).toContain('data-tile="tool:Bash"');
    const heads = (h.match(/<th[^>]*>(?:<button[^>]*>)?([^<]+)/g) ?? []).map((x: string) => x.replace(/<[^>]*>/g, ""));
    const at = heads.indexOf("Session");
    expect(heads.slice(at, at + 2)).toEqual(["Session", "First Prompt"]);
    expect(heads.slice(at + 6, at + 8)).toEqual(["Started", "Last Turn"]);
    expect(h).toContain(`<td class="time">${when("2026-10-31T00:00:00Z")}</td><td class="time">${when("2026-10-31T01:00:00Z")}</td>`);
    const skills = h.slice(h.indexOf('aria-label="Skills"'), h.indexOf("</div>", h.indexOf('aria-label="Skills"')));
    expect(skills).not.toContain("days");
    for (const s of ["<h2>Verify-Gate Denials</h2>", 'aria-label="Verify-gate denials"', '<button type="button" data-sort="prompt">First Prompt<']) expect(h).toContain(s);
  });

  test("a hook's name and a session's prompt are wide cells with their text as the title; extra kinds are a chip, not a quiet span", () => {
    const d = data();
    d.sessions.sessions[1].taskTypes = ["debug", "plan", "review"];
    const h = v.renderSessions(d, opts());
    expect(h).toContain('<td class="wide" title="vault-recall">vault-recall</td>');
    expect(h).toContain('<td class="wide" title="dear one">dear one</td>');
    expect(h).toContain('<td class="wide" title="no &lt;run&gt;">no &lt;run&gt;</td>');
    expect(h).toContain('<td title="debug, plan, review">');
    expect(h).toContain('<span class="chip" title="+1">+1</span>');
    expect(h).not.toContain('class="quiet"');
  });

  test("the total sits in the Sessions card's lede, and the counts say one error, not 1 errors", () => {
    const d = data();
    const h = v.renderSessions(d, opts());
    expect(h).toContain('<p class="lede">$10.00 recorded across these sessions.</p>');
    d.skills.skills[0].errors = 1;
    expect(v.renderSessions(d, opts())).toContain(">1 error</span>");
  });

  test("the lede totals only the sessions the card shows, and the counts keep their thousands separator", () => {
    expect(v.renderSessions(data(), opts("pick=tool:Monitor"))).toContain('<p class="lede">$1.00 recorded across these sessions.</p>');
    const d = data();
    d.activity.tools[0].calls = 12345;
    d.activity.tools[0].errors = 1500;
    const h = v.renderSessions(d, opts());
    for (const s of ["12,407 calls", "1,507 errors", "of 12,345 calls", ">1,500 errors</span>"]) expect(h).toContain(s);
  });

  test("a selection is pressed, titles the list, and offers the way back and the skill's page", () => {
    const h = v.renderSessions(data(), opts("pick=skill:aleph:handoff"));
    expect(h).toContain("<h2 id=\"h-ag-sess\">Sessions That Used aleph:handoff</h2>");
    expect(h).toContain('data-tile="skill:aleph:handoff" aria-pressed="true"');
    // The way back sits in the card's aside, not in a row, so it is a plain button and not kind small.
    expect(h).toContain('<button class="act" type="button" data-tile="">Show all sessions</button>');
    expect(h).toContain('href="#/skills/aleph%3Ahandoff"');
  });

  test("the cards use the kit parts: a fold of unused skills, a legend key, a link button", () => {
    const h = v.renderSessions(data(), opts("pick=skill:x"));
    const skills = h.slice(h.indexOf('aria-label="Skills"'), h.indexOf("</section>", h.indexOf('aria-label="Skills"')));
    expect(skills).toContain('href="#/skills/tidy"');
    expect(skills).not.toContain('class="unused"');
    expect(skills).not.toContain("<h3");
    expect(h).toContain('<a class="act" href="#/skills/x">Open the skill</a>');
    expect(h).not.toContain("red part");
    expect(h).toContain('<ul class="legend"><li>162 calls</li><li><i class="c-err"></i>17 errors</li></ul>');
  });

  test("the search box sits outside the Sessions card, which redraws whole in #ag-sessions", () => {
    const h = v.renderSessions(data(), opts("pick=skill:aleph:handoff"));
    const box = h.slice(h.indexOf('<div id="ag-sessions">'), h.indexOf("</section>", h.indexOf('<div id="ag-sessions">')));
    expect(box).toStartWith('<div id="ag-sessions"><section class="card" id="ag-sess" aria-label="Sessions">');
    expect(box).toContain("Show all sessions");
    expect(box).not.toContain('data-ui="ag-search"');
    expect(h.indexOf('data-ui="ag-search"')).toBeLessThan(h.indexOf('<div id="ag-sessions">'));
  });

  test("a Langfuse failure names the reason in the hint, not as a raw Langfuse failed line", () => {
    const h = v.renderSessions({ ...data(), activity: { langfuse: "error", error: "timeout", tools: [] } }, opts());
    expect(h).not.toContain("Langfuse failed:");
    expect(h).toContain("The tools did not load.");
    expect(h).toContain("timeout. Check that Langfuse is running");
  });

  test("a window past the pages the fetch reads says the counts are of part of it; one inside them says nothing", () => {
    const d = data();
    expect(v.renderSessions({ ...d, partial: true }, opts())).toContain("cover only part of the window");
    expect(v.renderSessions(d, opts())).not.toContain("cover only part of the window");
  });

  test("a failed part says so and the others still show", () => {
    const off = v.renderSessions({ ...data(), activity: { langfuse: "off", tools: [] }, skills: { error: "boom" }, sessions: { error: "down" } }, opts());
    expect(off).toContain("Langfuse off");
    expect(off).not.toMatch(/(Skills|Sessions) failed:/);
    expect(off).toContain("The skills did not load.");
    expect(off).toContain("boom. Check that Langfuse is running");
    expect(off).toContain("The sessions did not load.");
    expect(off).toContain("down. Check that Langfuse is running");
    expect(v.renderSessions({ ...data(), skills: { error: "boom" } }, opts())).toContain("dear one");
  });
});
