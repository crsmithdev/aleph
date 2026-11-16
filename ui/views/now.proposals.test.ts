import { expect, test } from "bun:test";
import { getJson, putJson } from "../../lib/db.ts";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./now.js";
import { state } from "../fixtures/status-state.ts";
import { withEnv } from "../server.testkit.ts";
import { asksOf, prop } from "../now.testkit.ts";

// ---- proposals ----
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { readList } from "../../issues/lib/store.ts";

import { routes as proposalRoutes } from "../api/proposals.ts";
import { storeRepos } from "../../tests/git.testkit.ts";
import { writeRepos } from "../../tests/projects.testkit.ts";

test("the lede says proposals need your attention", () => {
  // A proposal reaches Chris once the director wrote its case text.
  const sent = { ...prop, situation: "The memory proposes a check." };
  const s = { ...state, asks: asksOf([], [], [sent]), stuck: [], factory: { ...state.factory, health: [] } };
  expect(view.renderLede(s)).toContain("<a href=\"#awaiting\">Attention is needed</a>.");
  expect(view.renderLede(s)).not.toMatch(/\byour?\b/i);
  expect(view.renderLede({ ...s, asks: asksOf([], [], [sent, sent]) })).toContain("Attention is needed");
  expect(view.renderLede({ ...s, asks: asksOf([], [], [prop]) })).not.toMatch(/attention is needed/i);
});

test("approve and decline handlers", async () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-prop-"));
  let restore = () => {};
  try {
    restore = withEnv({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_ITEMS: join(base, "items"), ALEPH_DB: join(base, "aleph.db"), });
    storeRepos(base);
    writeRepos({ fac: { path: base, sandbox: true } }, join(base, "items"));
    mkdirSync(join(base, "factory"), { recursive: true });
    const sig = [{ id: "s", source: "chris", at: "2026-10-27T10:00:00Z", quote: "q", link: "" }];
    const lesson = (id: string) => ({ id, sentence: "S " + id, state: "proposed", signals: sig, count: 3, kind: "check" });
    putJson("state", "corrections", { minedAt: "", lessons: [lesson("l-a"), lesson("l-b")] });
    const stored = () => getJson<any>("state", "corrections", null).lessons;
    const post = (p: string, h: Record<string, string> = { "x-aleph-ui": "1" }) => new Request(`http://x/api/${p}`, { method: "POST", headers: h });
    const call = (key: string, p: string, id: string, h?: Record<string, string>) => (proposalRoutes as any)[key](post(p, h), { id }, new URL("http://x/"));

    expect((await call("POST /api/proposals/:id/approve", "approve/l-a", "l-a", {})).status).toBe(403);
    expect(stored()[0].state).toBe("proposed");
    const ok = await call("POST /api/proposals/:id/approve", "approve/l-a", "l-a");
    const body = await ok.json();
    expect(body.issue).toMatch(/^fac-\d+$/);
    expect(stored()[0].state).toBe("approved");
    const items = readList({ key: "fac" })!.items;
    expect(items.map((i) => i.id)).toEqual([1]);
    expect(items[0].fm).toMatchObject({ source: "memory" });
    const again = await call("POST /api/proposals/:id/approve", "approve/l-a", "l-a");
    expect(again.status).toBe(422);
    expect((await again.json()).error).toBeTruthy();

    const d = await call("POST /api/proposals/:id/decline", "decline/l-b", "l-b");
    expect(await d.json()).toEqual({ declined: "l-b" });
    expect(stored()[1].state).toBe("declined");
  } finally {
    restore();
    rmSync(base, { recursive: true, force: true });
  }
});

test("the approve refusal names the issue when no registry repo is sandboxed", async () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-prop-"));
  const restore = withEnv({ });
  try {
    writeRepos({ fac: { path: base, sandbox: false } }, join(base, "items"));
    const req = new Request("http://x/api/proposals/l-a/approve", { method: "POST", headers: { "x-aleph-ui": "1" } });
    const res = await (proposalRoutes as any)["POST /api/proposals/:id/approve"](req, { id: "l-a" }, new URL("http://x/"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("no sandboxed repo in the registry to reopen the issue in");
  } finally {
    restore();
    rmSync(base, { recursive: true, force: true });
  }
});
