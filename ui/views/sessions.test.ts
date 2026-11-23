import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import * as v from "./sessions.js";
// @ts-ignore plain JS, shared with the page
import { when } from "./lib/format.js";

const data = () => ({
  window: 7, project: null,
  activity: { langfuse: "ok", projects: ["aleph", "oth"], tools: [{ name: "Bash", calls: 100, errors: 10, lastAt: "2026-11-01T00:00:00Z" }, { name: "Monitor", calls: 10, errors: 5 }, { name: "Rare", calls: 2, errors: 2 }, { name: "Read", calls: 50, errors: 0 }], hooks: [{ name: "vault-recall", calls: 9, errors: 0, lastAt: "2026-11-01T00:00:00Z" }], denials: { total: 1, recent: [{ at: "2026-11-01T00:00:00Z", reason: "no <run>" }] } },
  skills: { projects: ["aleph"], skills: [{ name: "aleph:handoff", uses: 8, errors: 6, sessionIds: ["s2"] }], unused: ["tidy"] },
  sessions: { projects: ["aleph", "oth"], sessions: [
    { id: "s1", project: "aleph", firstPrompt: "cheap one", turns: 1, cost: 1, start: "2026-11-01T00:00:00Z", last: "2026-11-01T01:00:00Z", taskTypes: [], who: "you" },
    { id: "s2", project: "oth", firstPrompt: "dear one", turns: 3, cost: 9, start: "2026-10-31T00:00:00Z", last: "2026-10-31T01:00:00Z", taskTypes: ["debug"], who: "factory" },
    { id: "s3", project: "aleph", firstPrompt: "", turns: 1, cost: 2, start: "2026-10-30T00:00:00Z", last: "2026-10-30T01:00:00Z", taskTypes: [], who: "headless" },
  ] },
  toolSessions: { Bash: ["s1", "s2"], Monitor: ["s1"] },
});
const opts = (q = "") => v.options(new URLSearchParams(q));

describe("the Sessions page", () => {
  test("the view replaces the three old addresses and keeps their window and project", () => {
    expect(v.view).toMatchObject({ path: "/sessions", title: "Sessions", group: "claude" });
    expect(v.view.api({}, new URLSearchParams("days=30&project=x&pick=tool:Bash"))).toBe("/api/sessions?window=month&limit=2000&project=x");
    const g = globalThis as any;
    g.localStorage = { getItem: (k: string) => (k === "aleph.project" ? '"kept"' : null) };
    try {
      expect(v.view.api({}, new URLSearchParams("days=30"))).toBe("/api/sessions?window=month&limit=2000&project=kept");
      expect(v.options(new URLSearchParams("days=30")).project).toBe("kept");
    } finally { delete g.localStorage; }
    expect(v.redirect("#/agents")).toBe("#/sessions");
    expect(v.redirect("#/activity?days=30&project=x&q=y")).toBe("#/sessions?days=30&project=x");
    expect(v.redirect("#/skills")).toBe("#/sessions");
    expect(v.redirect("#/sessions/abc")).toBeNull();
    expect(v.redirect("#/skills/aleph:vault")).toBeNull();
    expect(v.redirect("#/sessions")).toBeNull();
  });

  test("the failing table ranks by rate and leaves out a tool with under five calls", () => {
    expect(v.failing(data()).map((r: any) => [r.name, Math.round(r.rate * 100)])).toEqual([["aleph:handoff", 75], ["Monitor", 50], ["Bash", 10]]);
  });

  test("the List view opens on Yours, with the cost split by who ran the session and no hook cards", () => {
    const h = v.renderSessions(data(), opts());
    expect(h).toContain('<p class="factline"><span><b class="num">$12.00</b> this week</span> <span><b class="num">$1.00</b> yours</span> <span><b class="num">$9.00</b> factory</span> <span><b class="num">$2.00</b> headless</span></p>');
    expect(h).toContain('data-name="who"><button type="button" data-value="" aria-pressed="false">All</button><button type="button" data-value="yours" aria-pressed="true">');
    const cut = { ...data(), sessions: { ...data().sessions, next: "2026-10-30T01:00:00Z", total: { sessions: 9, cost: 20 } } };
    const c = v.renderSessions(cut, opts());
    expect(c).toContain('<span><b class="num">$20.00</b> this week</span> <span><b class="num">$1.00</b> yours</span>');
    expect(c).toContain("Yours, factory and headless cover the newest 3 of 9 sessions.");
    expect(h).not.toContain("cover the newest");
    expect(h).toContain('<li class="lrow" tabindex="0" data-key="s1"');
    expect(h).not.toContain('data-key="s2"');
    expect(h).toContain('title="s1" href="#/sessions/s1"');
    const own = data();
    own.sessions.sessions[1].who = "you";
    expect(v.renderSessions(own, opts())).toContain('<span class="t" title="dear one">dear one</span><span class="chip">oth</span>');
    expect(h).not.toContain('<span class="chip">aleph</span>');
    for (const s of ["Hooks", "Verify-Gate", "vault-recall", "Failing Most"]) expect(h).not.toContain(s);
  });

  test("a group draws its first 50 rows and says how many are left", () => {
    const d = data();
    d.sessions.sessions = Array.from({ length: 52 }, (_, i) => ({ ...d.sessions.sessions[0], id: `n${i}`, who: "you" }));
    const h = v.renderSessions(d, opts());
    expect(h.match(/<li class="lrow"/g)).toHaveLength(50);
    expect(h).toContain("50 of 52");
  });

  test("the day count and the project reach the head of both views", () => {
    for (const view of ["", "view=tools"]) {
      const h = v.renderSessions(data(), opts("days=30"), new URLSearchParams(view));
      expect(h).toContain('name="project"');
      expect(h).toContain('data-name="days"');
      expect(h).toContain('data-value="30" aria-pressed="true"');
    }
    expect(v.renderSessions(data(), opts(), new URLSearchParams("view=tools"))).toContain('data-view="tools" aria-pressed="true"');
  });

  test("the Tools & Skills view opens with a figure band, then the ranked tools and skills and the failing table", () => {
    const h = v.renderSessions(data(), opts(), new URLSearchParams("view=tools"));
    expect(h).toContain('<section class="band" aria-label="Figures">');
    for (const s of ["Tool Errors", "Bash Errors", "Skill Errors", "Unused Skills", "10%", "59%", "17 of 162 calls", "75%", "6 of 8 uses"]) expect(h).toContain(s);
    for (const s of ["aleph:handoff", 'href="#/skills/tidy"', "<h2>Failing Most</h2>", "5 uses or more", '<th class="num">Rate</th>']) expect(h).toContain(s);
    expect(h).not.toContain("<h2>Hooks</h2>");
    expect(h).not.toContain('data-tile=');
    expect(h).not.toContain('class="factline"');
  });

  test("the counts say one error, not 1 errors, and keep their thousands separator", () => {
    const d = data();
    d.skills.skills[0].errors = 1;
    d.activity.tools[0].calls = 12345;
    d.activity.tools[0].errors = 1500;
    const h = v.renderSessions(d, opts(), new URLSearchParams("view=tools"));
    for (const s of [">1 error</span>", "12,407 calls", "1,507 of 12,407 calls", "1,507 errors", ">1,500 errors</span>"]) expect(h).toContain(s);
  });

  test("the cards use the design parts: a fold of unused skills, a legend key", () => {
    const h = v.renderSessions(data(), opts(), new URLSearchParams("view=tools"));
    const skills = h.slice(h.indexOf('aria-label="Skills"'), h.indexOf("</section>", h.indexOf('aria-label="Skills"')));
    expect(skills).toContain('href="#/skills/tidy"');
    expect(skills).not.toContain("<h3");
    expect(h).toContain('<ul class="legend"><li>162 calls</li><li><i class="c-err"></i>17 errors</li></ul>');
  });

  test("a Langfuse failure puts the reason in Technical details, not as a raw Langfuse failed line", () => {
    const h = v.renderSessions({ ...data(), activity: { langfuse: "error", error: "timeout", tools: [] } }, opts(), new URLSearchParams("view=tools"));
    expect(h).not.toContain("Langfuse failed:");
    expect(h).toContain("The tools did not load.");
    expect(h).toContain("<pre>timeout</pre>");
    expect(h).not.toContain("Check that");
  });

  test("a window past the pages the fetch reads says the counts are of part of it on both views; one inside them says nothing", () => {
    const d = data();
    for (const view of ["", "view=tools"]) {
      expect(v.renderSessions({ ...d, partial: true }, opts(), new URLSearchParams(view))).toContain("cover only part of the window");
      expect(v.renderSessions(d, opts(), new URLSearchParams(view))).not.toContain("cover only part of the window");
    }
  });

  test("a failed part says so and the others still show", () => {
    const bad = { ...data(), activity: { langfuse: "off", tools: [] }, skills: { error: "boom" }, sessions: { error: "down" } };
    const off = v.renderSessions(bad, opts(), new URLSearchParams("view=tools"));
    expect(off).toContain("Langfuse off");
    expect(off).not.toMatch(/(Skills|Sessions) failed:/);
    expect(off).toContain("The skills did not load.");
    expect(off).toContain("<pre>boom</pre>");
    const list = v.renderSessions(bad, opts());
    expect(list).toContain("The sessions did not load.");
    expect(list).toContain("<pre>down</pre>");
    expect(v.renderSessions({ ...data(), skills: { error: "boom" } }, opts())).toContain("cheap one");
  });
});
