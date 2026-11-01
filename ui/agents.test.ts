import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/agents.js";

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
    expect(v.view.api({}, new URLSearchParams("days=30&project=x&pick=tool:Bash"))).toBe("/api/agents?days=30&project=x");
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
    const h = v.renderAgents(data(), opts());
    expect(h).toContain('<header class="ph"><h1>Sessions</h1><div class="aside"><div class="fbar">');
    for (const s of ["Bash", "aleph:handoff", 'href="#/skills/tidy"', "vault-recall", "no &lt;run&gt;", 'href="#/sessions/s1"', "dear one"]) expect(h).toContain(s);
    expect(h).not.toContain("no <run>");
    expect(h).toContain('data-tile="tool:Bash"');
  });

  test("a selection is pressed, titles the list, and offers the way back and the skill's page", () => {
    const h = v.renderAgents(data(), opts("pick=skill:aleph:handoff"));
    expect(h).toContain("Sessions that used aleph:handoff");
    expect(h).toContain('data-tile="skill:aleph:handoff" aria-pressed="true"');
    expect(h).toContain("Show all sessions");
    expect(h).toContain('href="#/skills/aleph%3Ahandoff"');
  });

  test("a failed part says so and the others still show", () => {
    const off = v.renderAgents({ ...data(), activity: { langfuse: "off", tools: [] }, skills: { error: "boom" }, sessions: { error: "down" } }, opts());
    expect(off).toContain("Langfuse is not configured");
    expect(off).toContain("Skills failed: boom");
    expect(off).toContain("Sessions failed: down");
    expect(v.renderAgents({ ...data(), skills: { error: "boom" } }, opts())).toContain("dear one");
  });
});
