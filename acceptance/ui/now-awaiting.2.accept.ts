// Archived goal tests from ui/now-awaiting.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "../../ui/views/now.js";
import { attend } from "../../ui/asks.ts";
import { awaitingHeld, held, job, state } from "../../ui/fixtures/status-state.ts";
import { asksOf, withAttn, issue, full, section, rows, problem, prop } from "../../ui/test-now.ts";

test("a held run, a stuck run, an asking issue and a red main are one row each, with the id, title, Problem and buttons", () => {
  const asking = [{ ...issue(7), title: "Which tier?", question: "Haiku or Sonnet for the digest?" }];
  const s = { ...full, asks: asksOf([{ ...held, reviewCall: { call: "ask", reason: "touches hooks" } }], asking), stuck: [job({ name: "aleph-30", condition: "stuck", reason: "no commit", item: { id: 30, title: "Fix it" } })], issues: [], factory: { ...full.factory, health: ["health: aleph main is red at abc1234: tests"], hold: "Held: aleph-30 is stuck (no commit). No run starts or lands until it is cleared." } };
  const page = view.view.render(s);
  const top = section(page, "needs");
  const rs = rows(top);
  expect(rs.length).toBe(4);
  expect(rs.map((x) => x.match(/^([\w-]+)/)![1])).toEqual(["held-path", "question", "error", "stuck"]);
  expect(problem(rs[0])).toContain("changes a path the repo holds");
  expect(rs[0]).toContain("Reviewer: ask: touches hooks");
  expect(problem(rs[3])).toBe("Stuck with no commit.");
  expect(problem(rs[1])).toBe("Haiku or Sonnet for the digest?");
  expect(problem(rs[2])).toBe("Fix: aleph main is red at abc1234: tests");
  expect(rs[2]).not.toContain("<button");
  expect(rs[2]).not.toContain("always");
  // The id comes first, then the title and the Problem, then the buttons.
  for (const [row, id, title, btns] of [[rs[0], ">27</a>", "Digest head and tail", ["land", "drop"]], [rs[3], ">30</a>", "Fix it", ["recheck", "drop"]], [rs[1], ">7</a>", "Which tier?", ["decide", "deny"]]] as const) {
    expect(row).toContain('<span class="idp">aleph</span>');
    expect(row.indexOf(id)).toBeLessThan(row.indexOf(title));
    expect(row.indexOf(title)).toBeLessThan(row.search(/class="(problem|situation)"/));
    expect(row.match(/<details class="more"/g)?.length ?? 0).toBeLessThanOrEqual(1);
    for (const b of btns) expect(row).toContain(`data-act="${b}"`);
  }
  expect(rs[0]).toMatch(/<details class="more"[^]*data-act="diff"/);
  expect(rs[1]).toContain('href="#/issues/aleph/7"');
  expect(top.match(/main is red/g)?.length).toBe(1);
  expect(top).not.toContain("Held: aleph-30");
  expect(section(page, "lane-running")).toContain("aleph-36");
});

test("a held run's details carry the hold note and the reviewer's verdict", () => {
  const why = (call: any) => rows(withAttn({ ...state, stuck: [], factory: { ...state.factory, health: [] }, asks: asksOf([{ ...held, reviewCall: call }]) }))[0];
  expect(why({ call: "back", reason: "lost an assertion" })).toContain("Reviewer: back: lost an assertion");
  expect(why({ call: "error" })).toContain("Reviewer: error");
  expect(why(undefined)).not.toContain("Reviewer:");
  expect(why(undefined)).toContain("Held path: hooks/lib/digest.ts");
});

test("Issues holds the held runs before the stuck and failed ones, and none says whether an agent works", () => {
  const s = { ...state, running: [], stuck: [job({ name: "aleph-30", condition: "failed", agent: true }), job({ name: "aleph-31", condition: "stuck" })], asks: asksOf([{ ...held, agent: false }]) };
  const h = withAttn(s);
  expect(h).toContain(">Awaiting you<");
  expect(h.indexOf("aleph-27")).toBeLessThan(h.indexOf("aleph-30"));
  expect(h.indexOf("aleph-30")).toBeLessThan(h.indexOf("aleph-31"));
  expect(h).toContain('<p class="problem">Failed.</p>');
  // A job with a live run says so, on its own card only.
  expect(h.match(/Agent working/g)?.length).toBe(1);
  expect(h.indexOf("Agent working")).toBeGreaterThan(h.indexOf("aleph-30"));
  expect(h.indexOf("Agent working")).toBeLessThan(h.indexOf("aleph-31"));
  expect(h).not.toContain("aleph drop");
  expect(h).not.toContain("data-cmd");
});

test("text from the state is escaped", () => {
  const bad = { ...state, asks: asksOf([awaitingHeld({ name: "x", item: { id: 1, title: "<script>alert(1)</script>" } })]), queued: [{ repo: "a", id: 1, title: "<script>w</script>" }] };
  for (const h of [withAttn(bad), withAttn(bad)]) {
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  }
});

test("an awaiting entry has Diff, Land and Drop buttons", () => {
  const h = withAttn(state);
  for (const v of ["diff", "land", "drop"]) expect(h).toContain(`data-act="${v}" data-name="aleph-27"`);
  expect(h).toContain("diff-panel");
});

test("a stuck job shows its reason, the failed check and its seconds, and Re-check and Drop buttons", () => {
  const h = withAttn({ ...state, asks: [], stuck: [job({ name: "aleph-30", condition: "stuck", reason: "types failed", checks: [{ name: "lint", ok: true, seconds: 3 }, { name: "tsc", ok: false, seconds: 41 }] })] });
  for (const t of ["types failed", "tsc", "41 s", 'data-act="recheck" data-name="aleph-30"', 'data-act="drop" data-name="aleph-30"']) expect(h).toContain(t);
  expect(h).not.toContain("data-cmd");
});

test("many awaiting jobs all render as rows, each with its details folded and its buttons", () => {
  const runs = [1, 2, 3, 4].map((i) => awaitingHeld({ name: `aleph-${i}`, reason: "Held path", item: { id: i, title: `t${i}` } }));
  const h = withAttn({ ...state, asks: asksOf(runs) });
  expect(h.match(/class="job-card small issue-row held-path"/g)?.length).toBe(4);
  expect(h.match(/<details class="more" data-keep="more:[^"]*">/g)?.length).toBe(4 + 1);
  for (const i of [1, 2, 3, 4]) expect(h).toContain(`data-act="land" data-name="aleph-${i}"`);
});

test("a held row shows the call verdict and its reason in Details", () => {
  const withReview = (call: object) => ({ ...state, asks: asksOf([{ ...held, reviewCall: call }]) });
  const h = withAttn(withReview({ call: "back", reason: "a test lost <an> assertion" }));
  expect(h).toContain("Reviewer: back: a test lost &lt;an&gt; assertion");
  expect(h.indexOf("Reviewer: back")).toBeGreaterThan(h.indexOf("<details"));
  expect(withAttn(state)).not.toContain("Reviewer:");
});

test("an asking issue with fields shows the question, the options, the recommended mark, the context and the buttons in the row", () => {
  const decision = { question: "Haiku or Sonnet for the `digest`?", options: [{ label: "Haiku", line: "Cheaper, `fast`" }, { label: "Sonnet", line: "Better summaries" }], recommended: "Sonnet", kind: "input" as const, reason: "question", why: ["Digests run daily", "Quality matters more"] };
  const s = { ...state, asks: asksOf([], [{ ...issue(152), title: "Which tier?", question: "prose", decision }]), stuck: [], issues: [], factory: { ...state.factory, health: [] } };
  const [row] = rows(withAttn(s));
  expect(row).toContain('<p class="dq">Haiku or Sonnet for the <code>digest</code>?</p>');
  expect(row).toContain("<code>fast</code>");
  expect(row).toMatch(/<li class="rec"><b>Sonnet<\/b> <span class="badge run">Recommended<\/span>/);
  expect(row).toContain("Digests run daily");
  // The row says the question in one sentence; the options and context are in the one Details.
  expect(problem(row)).toBe("Haiku or Sonnet for the digest?");
  expect(row.match(/<details class="more"/g)?.length).toBe(1);
  expect(row.indexOf("<details")).toBeLessThan(row.indexOf('<p class="dq">'));
  expect(row).toContain('href="#/issues/aleph/152"');
  const buttons = [...row.matchAll(/<button class="act( primary)?"[^>]*data-act="(\w+)"[^>]*data-label="([^"]*)"/g)].map((m) => [m[2], m[3], !!m[1]]);
  expect(buttons).toEqual([["decide", "Approve Sonnet", true], ["decide", "Approve Haiku", false], ["deny", "Deny", false]]);
  expect(row).toContain('data-option="Sonnet"');
});

// ---- the ask rows ----
import { ASK_REASONS } from "../../jobs/lib/ask.ts";

const sample = (reason: string): { runs: any[]; issues: any[]; lessons: any[] } => {
  const run = (why: string, o: object = {}) => ({ runs: [job({ name: "aleph-27", condition: "awaiting", ask: { kind: why === "held-path" || why === "review" ? "approval" : "input", reason: why }, reason: "<task-notification>x</task-notification> y", item: { id: 27, title: "T" }, ...o })], issues: [] as any[], lessons: [] as any[] });
  const iss = (o: object) => ({ runs: [] as any[], issues: [{ ...issue(7), title: "T", ...o }], lessons: [] as any[] });
  if (["held-path", "review"].includes(reason)) return run(reason, reason === "review" ? { reviewCall: { call: "ask", reason: "r" } } : {});
  if (reason === "question") return run("question", { question: "<agent-message>q</agent-message> Which?" });
  if (reason.startsWith("proposal-")) return { runs: [] as any[], issues: [] as any[], lessons: [{ ...prop, kind: reason.slice(9), target: { check: "aleph checks", "claude-md": "aleph/CLAUDE.md", skill: "skills/aleph/SKILL.md" }[reason.slice(9)] }] };
  const q: Record<string, object> = {
    proposal: { reason: "proposal", question: "T" },
    "host-check": { reason: "host-check", question: "triage: a live check: run it" },
    "no-commit": { reason: "no-commit", question: "ended with no commit, so the factory stopped" },
    "run-cap": { reason: "run-cap", question: "the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it." },
    "spec-check": { reason: "spec-check", question: "spec check: abc123 hold: the Oracle clause is outside the Edit surface" },
    "triage-failed": { reason: "triage-failed", question: "triage: no verdict in 2 runs: failed: x" },
    "part-dropped": { reason: "part-dropped", question: "A goal was dropped." },
    "acceptance-failed": { reason: "acceptance-failed", question: "acceptance: fail again" },
    rescue: { reason: "rescue", question: "Which one?", decision: { question: "Which?", options: [{ label: "A", line: "a" }], recommended: "A", kind: "input" as const, reason: "question", why: [] } },
    firefighter: { reason: "firefighter", question: "x changes y.ts, a held security path" },
  };
  return iss(q[reason]);
};

for (const reason of Object.keys(ASK_REASONS)) {
  test(`ask row for ${reason}: Problem, named buttons, a hint each, and Always`, () => {
    const sm = sample(reason);
    const items = attend(sm, {}, sm.lessons).items;
    expect(items.map((i) => i.reason)).toEqual([reason]);
    const h = withAttn({ ...state, stuck: [], factory: { ...state.factory, health: [] }, asks: items });
    const row = h.match(new RegExp(`<article class="job-card small issue-row ${reason}"[^]*?</article>`))![0];
    expect(row).toContain(`data-reason="${reason}"`);
    const p = problem(row);
    expect(p.length).toBeGreaterThan(5);
    for (const t of ["<task-notification", "<agent-message", "ask:"]) expect(p).not.toContain(t);
    const buttons = [...row.split('<details class="more"')[0].matchAll(/<button class="act( primary)?" [^>]*data-label="([^"]*)"/g)].map((m) => m[2]);
    expect(buttons).toEqual(items[0].actions.map((a) => a.label));
    expect(row).toContain(`data-kind="${items[0].kind}"`);
    expect(row).toContain('<span class="kind-tag">');
    const always = items[0].always;
    expect(row.match(/<div class="choice">/g)?.length).toBe(buttons.length + (always ? 1 : 0));
    expect(row.match(/<span class="effect">/g)?.length).toBe(buttons.length + (always ? 1 : 0));
    if (!always) { expect(row).not.toContain("act always"); return; }
    expect(row.match(/class="act always"/g)?.length).toBe(1);
    // The order of the choices: positive, positive [auto-yes], then the rest.
    expect(row.indexOf(`data-label="${items[0].actions[0].label}"`)).toBeLessThan(row.indexOf("act always"));
    expect(row.indexOf("act always")).toBeLessThan(row.indexOf(`data-label="${items[0].actions[1].label}"`));
    const keyed = reason.startsWith("proposal-") ? `${reason}:aleph` : reason;
    expect(row).toMatch(new RegExp(`class="act always" type="button" data-act="always" data-reason="${keyed}" data-action="[^"]+" data-first="${items[0].actions[0].act}" data-label="${always.label.replace(/[[\]]/g, "\\$&")}"`));
    expect(row.match(/<details class="more"/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
}

test("the Awaiting-you group is one list; its articles are the asks plus the error lines", () => {
  const sm = sample("rescue");
  const items = [...attend({ runs: [held], issues: sm.issues }, {}, [prop as any]).items];
  const s = { ...state, asks: items, stuck: [], factory: { ...state.factory, health: ["health: aleph main is red at abc1234: tests"] } };
  const h = withAttn(s);
  const grp = h.match(/<div class="grp" id="awaiting">[^]*?<\/section>/)![0];
  expect(grp).toContain('<div class="list">');
  expect(grp).not.toContain('class="cards"');
  expect(grp.match(/<article /g)?.length).toBe(items.length + 1);
  const red = grp.match(/<article class="job-card small issue-row error"[^]*?<\/article>/)![0];
  expect(red).toContain('<p class="problem">Fix: aleph main is red');
  expect(red).not.toContain("always");
  expect(red).not.toContain("<button");
  expect(view.view.render(s)).toContain('<span class="count">4</span>');
});

test("an ask with stored text shows the situation and each effect; one without shows the fixed text and the missing-text span", () => {
  const sm = sample("proposal");
  const [base] = attend(sm, {}, sm.lessons).items;
  const stored = { ...base, situation: "First sentence. Second sentence, longer than one.", explained: true, actions: base.actions.map((a, n) => ({ ...a, hint: `Effect ${n}.`, recommended: n === 0 })) };
  const render = (i: any) => withAttn({ ...state, stuck: [], factory: { ...state.factory, health: [] }, asks: [i] }).match(/<article class="job-card small issue-row proposal"[^]*?<\/article>/)![0];
  const row = render(stored);
  expect(row).toContain('<p class="situation">First sentence. Second sentence, longer than one.</p>');
  expect(row).not.toContain('class="problem"');
  expect(row).not.toContain("case text is missing");
  stored.actions.forEach((_, n) => expect(row).toContain(`Effect ${n}.`));
  expect(row.match(/Recommended<\/span>/g)?.length).toBe(1);
  const plain = render({ ...base, explained: false });
  expect(plain).toContain(base.problem.slice(0, 20));
  expect(plain).toContain("The case text is missing; this is the fixed text for this reason.");
  expect(plain).not.toContain("Recommended");
});

test("an ask card and a stuck card for a critical item show the priority badge", () => {
  const badge = '<span class="badge stuck">critical</span>';
  expect(asksOf([], [{ ...issue(7), question: "Which?", priority: "critical" }]).map((a) => view.askRow(a)).join("")).toContain(badge);
  const stuck = { ...state, asks: [], stuck: [job({ name: "aleph-30", condition: "stuck", repo: "aleph", item: { id: 30, title: "t", priority: "critical" } })] };
  expect(view.renderNeeds(stuck)).toContain(badge);
});

test("an ask card and a stuck card keep their choices in a closed fold, and the head and the problem outside it", () => {
  const h = withAttn({ ...state, asks: asksOf([held]) });
  for (const row of rows(h)) {
    if (!row.includes("choices")) continue;
    const open = row.indexOf('<details class="cfold"');
    expect(open).toBeGreaterThan(-1);
    expect(row.slice(0, open + 30)).not.toMatch(/<details class="cfold"[^>]* open/);
    expect(row.indexOf('class="choices"') > open || row.indexOf("choices") > open).toBe(true);
    expect(row.indexOf('class="kind-tag"')).toBeLessThan(open);
    expect(row.search(/class="(problem|situation)"/)).toBeLessThan(open);
    expect(row.indexOf("<button")).toBeGreaterThan(open);
  }
});

test("a spec-check card's title line starts with its kind; an old 9-sentence situation shows 3 and the rest sits in the closed Details fold", () => {
  const nine = Array.from({ length: 9 }, (_, i) => `Sentence ${i + 1}.`).join(" ");
  const ask = { kind: "input", reason: "spec-check", question: "q", options: [], why: [], situation: nine };
  const h = withAttn({ ...state, asks: asksOf([], [{ ...issue(5), title: "Fix it", reason: "spec-check", question: "spec check: x hold: y", ask }]) });
  const row = h.match(/<article class="job-card small issue-row spec-check"[^]*?<\/article>/)![0];
  expect(row).toContain('<span class="t">Spec check: Fix it</span>');
  expect(problem(row)).toBe("Sentence 1. Sentence 2. Sentence 3.");
  const fold = row.match(/<details class="more"[^]*?<\/details>/)![0];
  expect(fold).not.toContain(" open");
  expect(fold).toContain("Sentence 4. Sentence 5. Sentence 6. Sentence 7. Sentence 8. Sentence 9.");
  expect(row.slice(0, row.indexOf("<details"))).not.toContain("Sentence 4.");
});
