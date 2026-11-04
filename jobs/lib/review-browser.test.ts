import { describe, expect, test } from "bun:test";
import { chromeArgv } from "./review-browser.ts";

describe("review browser argv", () => {
  test("the resolver rule maps every host to NOTFOUND but leaves loopback by name and by address", () => {
    const rule = chromeArgv("/p").find((a) => a.startsWith("--host-resolver-rules="));
    expect(rule).toBeDefined();
    const entries = rule!.slice("--host-resolver-rules=".length).split(",").map((e) => e.trim());
    expect(entries).toContain("MAP * ~NOTFOUND");
    expect(entries).toContain("EXCLUDE localhost");
    expect(entries).toContain("EXCLUDE 127.0.0.1");
  });
});
