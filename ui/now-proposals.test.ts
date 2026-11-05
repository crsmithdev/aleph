import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { state } from "./fixtures/status-state.ts";
import { withEnv } from "./test-server.ts";
import { asksOf, prop } from "./test-now.ts";

// ---- proposals ----
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { readList } from "../issues/lib/store.ts";

import { routes as proposalRoutes } from "./api/proposals.ts";
import { storeRepos } from "../tests/git-fixture.ts";

test("the lede says proposals need your attention", () => {
  // A proposal reaches Chris once the director wrote its case text.
  const sent = { ...prop, situation: "The memory proposes a check." };
  const s = { ...state, asks: asksOf([], [], [sent]), stuck: [], factory: { ...state.factory, health: [] } };
  expect(view.renderLede(s)).toContain("<a href=\"#awaiting\">your attention is needed</a>.");
  expect(view.renderLede({ ...s, asks: asksOf([], [], [sent, sent]) })).toContain("your attention is needed");
  expect(view.renderLede({ ...s, asks: asksOf([], [], [prop]) })).not.toContain("your attention is needed");
});

test("approve and decline handlers", async () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-prop-"));
  let restore = () => {};
  try {
    restore = withEnv({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json") });
    storeRepos(base);
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
