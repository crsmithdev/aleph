// Archived goal tests from ui/now-proposals.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "../../ui/views/now.js";
import { held, state } from "../../ui/fixtures/status-state.ts";
import { asksOf, withAttn, rows, prop } from "../../ui/test-now.ts";

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

test("a held job card has the kind mark in its meta row and no agent line", () => {
  const h = withAttn({ ...state, stuck: [], asks: asksOf([{ ...held, agent: true, reviewCall: { call: "back", reason: "x" } }]) });
  expect(rows(h)[0]).toContain('<span class="kind-tag">');
  expect(rows(h)[0]).not.toContain("Agent working");
});
