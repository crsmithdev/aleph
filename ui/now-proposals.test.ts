import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { held, state } from "./fixtures/status-state.ts";
import { withEnv } from "./test-server.ts";
import { asksOf, withAttn, rows, problem, prop } from "./test-now.ts";

// ---- proposals ----
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { readList } from "../todo/lib/store.ts";

import { routes as proposalRoutes } from "./api/proposals.ts";

test("a proposal is a row with Yes-like buttons and its signals folded", () => {
  const h = withAttn({ ...state, asks: asksOf([held], [], [prop]) });
  const row = h.match(/<article class="job-card small issue-row proposal-check"[^]*?<\/article>/)![0];
  expect(problem(row)).toContain("Do not mock the db");
  expect(row).toContain('<span class="t">Lesson: No db mocks</span>');
  expect(row).toContain('class="act primary" type="button" data-act="approve" data-id="l-1234abcd" data-label="Add a check to aleph">Add a check to aleph<');
  expect(row).toContain('data-act="decline" data-id="l-1234abcd" data-label="Add no check">');
  expect(row).toContain('data-reason="proposal-check:aleph"');
  expect(row).toContain('data-label="Add a check to aleph [auto-yes]"');
  expect(row.match(/<details class="more"/g)?.length).toBe(1);
  expect(row).toContain('<a href="https://lf/trace/t2">');
  expect(row).not.toContain("<script>");
  expect(row).toContain("&lt;script&gt;");
});

test("rows are ordered held, then asking, then proposal, then error; the group is a list", () => {
  const s = { ...state, asks: asksOf([held], [{ id: "aleph-5", title: "T", href: "#/x", question: "Pick one?" }], [prop]), factory: { ...state.factory, health: ["main is red"] } };
  const h = withAttn(s);
  expect(h).toContain('<div class="list">');
  expect(h).not.toMatch(/id="awaiting"[^]*class="cards"[^]*id="jobs-stuck"/);
  expect(h.indexOf("aleph-27")).toBeLessThan(h.indexOf("aleph-5"));
  expect(h.indexOf("aleph-5")).toBeLessThan(h.indexOf("l-1234abcd"));
  expect(h.indexOf("l-1234abcd")).toBeLessThan(h.indexOf("main is red"));
  expect(h).toContain(">4<");
});

test("the lede says proposals need your attention", () => {
  const s = { ...state, asks: asksOf([], [], [prop]), stuck: [], factory: { ...state.factory, health: [] } };
  expect(view.renderLede(s)).toContain("<a href=\"#awaiting\">your attention is needed</a>.");
  expect(view.renderLede({ ...s, asks: asksOf([], [], [prop, prop]) })).toContain("your attention is needed");
});

test("approve and decline handlers", async () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-prop-"));
  let restore = () => {};
  const sh = (cwd: string, ...a: string[]) => { const p = Bun.spawnSync(a, { cwd, stdout: "pipe", stderr: "pipe" }); if (p.exitCode) throw new Error(String(p.stderr)); };
  try {
    restore = withEnv({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json") });
    sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
    sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
    sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
    sh(join(base, "items"), "git", "push", "-q", "origin", "main");
    writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: base, sandbox: true } }));
    mkdirSync(join(base, "factory"), { recursive: true });
    const sig = [{ id: "s", source: "chris", at: "2026-10-27T10:00:00Z", quote: "q", link: "" }];
    const lesson = (id: string) => ({ id, sentence: "S " + id, state: "proposed", signals: sig, count: 3, kind: "check" });
    const file = join(base, "factory", "corrections.json");
    writeFileSync(file, JSON.stringify({ minedAt: "", lessons: [lesson("l-a"), lesson("l-b")] }));
    const stored = () => JSON.parse(readFileSync(file, "utf8")).lessons;
    const post = (p: string, h: Record<string, string> = { "x-aleph-ui": "1" }) => new Request(`http://x/api/${p}`, { method: "POST", headers: h });
    const call = (key: string, p: string, id: string, h?: Record<string, string>) => (proposalRoutes as any)[key](post(p, h), { id }, new URL("http://x/"));

    expect((await call("POST /api/approve/:id", "approve/l-a", "l-a", {})).status).toBe(403);
    expect(stored()[0].state).toBe("proposed");
    const ok = await call("POST /api/approve/:id", "approve/l-a", "l-a");
    const body = await ok.json();
    expect(body.code).toBe(0);
    expect(stored()[0].state).toBe("approved");
    const items = readList({ key: "fac" })!.items;
    // The issue and its goal `.1`.
    expect(items.map((i) => i.fm.id)).toEqual(["1"]);
    expect(items[0].fm).toMatchObject({ source: "memory" });
    const again = await call("POST /api/approve/:id", "approve/l-a", "l-a");
    expect(again.status).toBe(422);
    expect((await again.json()).code).toBe(1);

    const d = await call("POST /api/decline/:id", "decline/l-b", "l-b");
    expect(await d.json()).toEqual({ code: 0, stdout: "declined", stderr: "" });
    expect(stored()[1].state).toBe("declined");
  } finally {
    restore();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a held job card has the kind mark in its meta row and no agent line", () => {
  const h = withAttn({ ...state, stuck: [], asks: asksOf([{ ...held, agent: true, reviewCall: { call: "back", reason: "x" } }]) });
  expect(rows(h)[0]).toContain('<span class="kind-tag">');
  expect(rows(h)[0]).not.toContain("Agent working");
});
