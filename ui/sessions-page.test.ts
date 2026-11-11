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
    expect(h).toContain('<header class="ph"><h1>Sessions</h1><span class="count">last 7 days</span><div class="aside"><div class="fbar">');
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

  test("a selection is pressed, titles the list, and offers the way back and the skill's page", () => {
    const h = v.renderSessions(data(), opts("pick=skill:aleph:handoff"));
    expect(h).toContain("<h2 id=\"h-ag-sess\">Sessions That Used aleph:handoff</h2>");
    expect(h).toContain('data-tile="skill:aleph:handoff" aria-pressed="true"');
    expect(h).toContain("Show all sessions");
    expect(h).toContain('href="#/skills/aleph%3Ahandoff"');
  });

  test("a window past the pages the fetch reads says the counts are of part of it; one inside them says nothing", () => {
    const d = data();
    expect(v.renderSessions({ ...d, partial: true }, opts())).toContain("cover only part of the window");
    expect(v.renderSessions(d, opts())).not.toContain("cover only part of the window");
  });

  test("a failed part says so and the others still show", () => {
    const off = v.renderSessions({ ...data(), activity: { langfuse: "off", tools: [] }, skills: { error: "boom" }, sessions: { error: "down" } }, opts());
    expect(off).toContain("Langfuse is not configured");
    expect(off).toContain("Skills failed: boom");
    expect(off).toContain("Sessions failed: down");
    expect(v.renderSessions({ ...data(), skills: { error: "boom" } }, opts())).toContain("dear one");
  });
});
