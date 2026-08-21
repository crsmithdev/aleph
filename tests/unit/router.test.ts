import { test, expect, describe } from "bun:test";
import { Router } from "../../src/routing/router.ts";
import { loadConfig } from "../../src/core/config.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function router(extra = "") {
  const dir = mkdtempSync(join(tmpdir(), "router-"));
  const file = join(dir, "aleph.toml");
  writeFileSync(file, `runner = "echo"
[routing]
default_tier = "T2"
flex = 1
escalate_after_failures = 2
[routing.tiers]
T0 = { model = "local/qwen", enabled = false, backend = "local" }
T1 = { model = "haiku" }
T2 = { model = "sonnet" }
T3 = { model = "opus" }
[routing.classes]
conversation = { tier = "T2", ceiling = "T3" }
classify = { tier = "T1", ceiling = "T1" }
${extra}`);
  return new Router(loadConfig({ file, host: "none", env: {} }).config);
}

describe("router", () => {
  test("uses the class default", () => {
    expect(router().route("conversation").model).toBe("sonnet");
    expect(router().route("classify").model).toBe("haiku");
  });

  test("flex moves one tier and never past the ceiling", () => {
    expect(router().route("conversation", { flex: 1 }).tier).toBe("T3");
    expect(router().route("conversation", { flex: 5 }).tier).toBe("T3");   // clamped to flex=1 then ceiling
    expect(router().route("classify", { flex: 1 }).tier).toBe("T1");       // ceiling == default
    expect(router().route("conversation", { flex: -1 }).tier).toBe("T1");
  });

  test("escalates after N consecutive failures, still bounded by the ceiling", () => {
    const r = router();
    expect(r.route("conversation", { consecutive_failures: 1 }).tier).toBe("T2");
    expect(r.route("conversation", { consecutive_failures: 2 }).tier).toBe("T3");
    expect(r.route("conversation", { consecutive_failures: 9 }).tier).toBe("T3");
    expect(r.route("classify", { consecutive_failures: 9 }).tier).toBe("T1");
  });

  test("a disabled tier falls forward rather than silently returning a dead model", () => {
    const r = router(`local = { tier = "T0", ceiling = "T2" }\n`);
    const route = r.route("local");
    expect(route.tier).toBe("T1");
    expect(route.reason).toContain("disabled");
  });

  test("an unknown class is an error, not a default", () => {
    expect(() => router().route("nope")).toThrow(/unknown routing class/);
  });

  test("the reason string explains the decision", () => {
    expect(router().route("conversation", { consecutive_failures: 2 }).reason)
      .toBe("class conversation default T2; escalated after 2 failures: T2 -> T3");
  });
});
