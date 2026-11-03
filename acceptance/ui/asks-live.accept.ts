// Archived goal tests from ui/asks-live.test.ts: `bun run accept` runs them, `bun run test` does not.
/**
 * The whole path of an Ask's case text: a host-check Ask raised the way triage raises it, the explainer sweep with a fake
 * `claude`, the API, and the page in Chrome (Awaiting you on Status, and the Issue page). Two screenshots are written to `ALEPH_SHOTS_DIR`, or a folder in the system temp dir, outside the temp dir, so they outlive the test and can be committed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { readList, writeList } from "../../todo/lib/store.ts";
import { askOf, plainAsk, setAsk } from "../../jobs/lib/ask.ts";
import { explainStep } from "../../jobs/lib/explain.ts";
import { chromeUsable, startRig, type Page, type Rig } from "../../ui/test-browser.ts";

/** Not under the test's temp dir: afterAll deletes that, and the screenshots are for review. `ui/shots` is tracked, so a run writes there only when asked. */
const SHOTS = process.env.ALEPH_SHOTS_DIR ?? join(tmpdir(), "aleph-asks-live");
const FILES = ["vault/Notes/plan.md", "vault/Notes/people.md"];
const FAKE = `#!/bin/bash
prompt=$(cat)
case $prompt in *"vault/Notes/plan.md"*) ;; *) echo "not the vault case" >&2; exit 3 ;; esac
echo '{"situation":"The run left two untracked vault notes, vault/Notes/plan.md and vault/Notes/people.md, that only the host can check.","effects":[{"action":"checked","text":"Records a claim that you looked at vault/Notes/plan.md and vault/Notes/people.md; it runs nothing."},{"action":"deny","text":"Drops the check, so vault/Notes/plan.md and vault/Notes/people.md stay unchecked."}],"recommend":{"action":"checked","why":"the notes are only on the host"}}'
`;
const FIXED = "It runs nothing and tests nothing.";

describe.skipIf(!chromeUsable)("an explained Ask, from the store to the page", () => {
  let rig: Rig, page: Page, tmp: string, ref = "", shots: string[] = [];
  const saved = { ...process.env };
  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "aleph-asks-live-"));
    writeFileSync(join(tmp, "fake"), FAKE);
    chmodSync(join(tmp, "fake"), 0o755);
    rig = await startRig(async (env) => {
      Object.assign(process.env, env, {
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
        ALEPH_EXPLAIN_CMD: join(tmp, "fake"), ALEPH_FACTORY_DIR: join(tmp, "factory"), ALEPH_DISPATCH: "off", ALEPH_EXPLAIN_CAP: "50", XDG_RUNTIME_DIR: join(tmp, "run"),
      });
      let id = 0;
      writeList({ key: "demo" }, "asks-live", (doc) => {
        const item = issues.add(doc, "Check the vault notes", { request: "Look at the vault notes on the host." });
        setAsk(item, plainAsk("host-check", `A factory sandbox cannot see the untracked vault notes ${FILES.join(" and ")}; check them on the host.`));
        id = item.id;
        return true;
      }, true);
      ref = `demo-${id}`;
      const lines = await explainStep();
      // The fixture has other Asks without text; the fake leaves them as they are (it exits 3), so only this one is explained.
      expect(lines).toContain(`${ref}: explained`);
    });
    page = await rig.open();
  }, 120_000);
  afterAll(() => { rig?.stop(); for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); rmSync(tmp, { recursive: true, force: true }); });

  test("the stored Ask holds the fake's situation", () => {
    const item = issues.find(readList({ key: "demo" } as any)!, Number(ref.slice(5)))!;
    const ask = askOf(item)!;
    expect(ask.situation).toContain(FILES[0]!);
    expect(ask.effects?.map((e) => e.action)).toEqual(["checked", "deny"]);
  });

  const rows = `[...document.querySelectorAll("#view .issue-row")].filter((r) => r.textContent.includes("vault/Notes/plan.md"))`;
  async function check(where: string) {
    const r = await page.ev<{ situation: string; effects: string[] }>(`(() => { const r = ${rows}[0]; return { situation: r.querySelector(".situation").textContent, effects: [...r.querySelectorAll(".choice .effect")].map((e) => e.textContent) }; })()`);
    for (const f of FILES) expect([where, r.situation]).toEqual([where, expect.stringContaining(f)]);
    expect(r.effects.length).toBe(2);
    for (const e of r.effects) expect(e).not.toContain(FIXED);
    expect(r.effects.some((e) => e.includes("runs nothing"))).toBe(true);
  }

  test("Awaiting you and the Issue page show it, at two widths, with two screenshots", async () => {
    await page.until(`${rows}.length > 0`);
    await check("Awaiting you");
    await page.go(`#/issues/demo/${ref.slice(5)}`);
    await page.until(`${rows}.length > 0`);
    await check("Issue page");
    for (const w of [1280, 720]) {
      await page.width(w);
      await page.go("#/");
      await page.until(`${rows}.length > 0`);
      mkdirSync(SHOTS, { recursive: true });
      const path = join(SHOTS, `asks-live-${w}.png`);
      await page.shot(path);
      shots.push(path);
      console.log(`screenshot ${w}px: ${path}`);
    }
    for (const p of shots) { expect(existsSync(p)).toBe(true); expect(statSync(p).size).toBeGreaterThan(1000); }
    expect(page.errors).toEqual([]);
  }, 60_000);
});
