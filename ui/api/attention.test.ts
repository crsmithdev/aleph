import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { putJson } from "../../lib/db.ts";
import { layout } from "../../lib/layout.ts";
import { withEnv, withServer, type TestServer } from "../server.testkit.ts";
import { routes } from "./attention.ts";

// The attention rows on fixtures: a backend hold, a monitor report, a hook error and a vault with a dangling link.
const NOW = new Date("2026-11-19T12:00:00Z"), HOUR_AGO = "2026-11-19T11:00:00.000Z";
let base: string, restore: () => void, server: TestServer, stop: () => void;
const facts = async () => (await routes["GET /api/attention/facts"](new Request("http://x"), {}, new URL("http://x/"))).json() as Promise<Record<string, any[]>>;

beforeAll(async () => {
  setSystemTime(NOW);
  base = mkdtempSync(join(tmpdir(), "aleph-ui-attention-"));
  const projects = join(base, "projects", "-home-u-repo"), vault = join(base, "vault");
  mkdirSync(projects, { recursive: true });
  mkdirSync(join(layout().factory, "monitor"), { recursive: true });
  mkdirSync(join(vault, "wiki"), { recursive: true });
  const fail = { type: "attachment", timestamp: HOUR_AGO, sessionId: "s", entrypoint: "cli", cwd: "/home/u/repo", attachment: { type: "hook_non_blocking_error", hookEvent: "SessionStart", command: "factory report", stderr: 'Module not found "/x/cli.ts"' } };
  const transcript = join(projects, "s.jsonl");
  writeFileSync(transcript, `${JSON.stringify(fail)}\n${JSON.stringify(fail)}\n`);
  utimesSync(transcript, NOW, NOW);
  writeFileSync(join(layout().factory, "monitor", "2026-11-18.json"), JSON.stringify({ day: "2026-11-18", table: {}, findings: ["a", "b"] }));
  writeFileSync(join(vault, "VAULT.md"), "# Vault\n");
  writeFileSync(join(vault, "MEMORY.md"), "- see [[Nowhere]]\n");
  putJson("state", "backend-hold", { via: "openrouter", why: "API Error: 402 Insufficient credits. Add credits at https://openrouter.ai/settings/credits", since: HOUR_AGO });
  restore = withEnv({ ALEPH_CLAUDE_PROJECTS: join(base, "projects"), ALEPH_VAULT: vault });
  ({ server, stop } = await withServer({ warm: false }));
});
afterAll(() => { stop(); restore(); setSystemTime(); putJson("state", "backend-hold", null); rmSync(base, { recursive: true, force: true }); });

test("each source makes its page's rows from the fact it reads", async () => {
  const rows = await facts();
  expect(rows["/automation"]).toEqual([
    { tone: "error", text: "OpenRouter: API Error: 402 Insufficient credits", act: { label: "Add credits", href: "https://openrouter.ai/settings/credits" } },
    { tone: "need", text: "Monitor, Nov 18: 2 findings", act: { label: "Read", href: "#/automation?monitor=1" } },
  ]);
  expect(rows["/hooks"]).toEqual([{ tone: "error", text: "2 hook errors, 2 from a moved hook file", act: { label: "Errors", href: "#/hooks?view=errors" } }]);
  expect(rows["/memory"]).toEqual([{ tone: "error", text: "1 lint finding, 1 refused", act: { label: "Health", href: "#/memory?view=health" } }]);
  expect(rows["/issues"]).toEqual([]);
  expect(rows["/factory/jobs"]).toEqual([]);
});

test("the endpoint answers every page by its route, and the Sessions row waits for a mark", async () => {
  const res = await fetch(`http://127.0.0.1:${server.port}/api/attention`);
  const body = await res.json() as Record<string, unknown[]>;
  expect(Object.keys(body).sort()).toEqual(["/automation", "/factory/agents", "/factory/jobs", "/hooks", "/issues", "/memory", "/sessions"]);
  expect(body["/sessions"]).toEqual([]);
  expect(body["/hooks"]).toHaveLength(1);
});
