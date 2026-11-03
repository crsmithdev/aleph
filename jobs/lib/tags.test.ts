import { describe, expect, test } from "bun:test";
import { lastTagged, parseVerdict, tagged } from "./ledger.ts";

const reply = (tag: string, a: string, b: string) =>
  [`  ${tag}: ${a}`, `${tag.toLowerCase()}: skipped`, `**${tag}: mid**`, `\`${tag}: tick\``, `${tag}: ${b}`].join("\n");

describe("tagged", () => {
  test("reads every capital tag line, unwrapped, not the lowercase one", () => {
    expect(tagged(reply("FACT", "one", "two"), "FACT")).toEqual(["one", "mid", "tick", "two"]);
  });
  test("drops empty values", () => expect(tagged("FACT:\nFACT: x", "FACT")).toEqual(["x"]));
});

describe("lastTagged", () => {
  test("reads the last capital tag line", () => {
    expect(lastTagged(reply("FLAKE", "one", "two"), "FLAKE")).toBe("two");
    expect(lastTagged("  FLAKE: a\n**FLAKE: b**", "FLAKE")).toBe("b");
    expect(lastTagged("flake: a", "FLAKE")).toBeUndefined();
  });
});

describe("parseVerdict", () => {
  test("reads the last capital VERDICT line", () => {
    expect(parseVerdict(reply("VERDICT", "back x", "land"))).toEqual({ call: "land" });
    expect(parseVerdict("verdict: land\n  VERDICT: back x\n`VERDICT: chris q`\n**VERDICT: land**")).toEqual({ call: "land" });
    expect(parseVerdict("  VERDICT: back x\nverdict: land")).toEqual({ call: "back", reason: "x" });
    expect(parseVerdict("`VERDICT: chris q`")).toEqual({ call: "ask", reason: "q" });
  });
});
