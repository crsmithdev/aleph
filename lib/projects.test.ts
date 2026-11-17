import { expect, test } from "bun:test";
import { parseProject } from "./projects.ts";

test("parseProject reads the same project from LF and CRLF text", () => {
  const text = "---\nname: Alpha\nstatus: open\n---\n\nBody line.\n";
  expect(parseProject(1, text.replace(/\n/g, "\r\n"))).toEqual(parseProject(1, text));
  expect(parseProject(1, text)).toEqual({ n: 1, name: "Alpha", description: "Body line.", fields: { status: "open" } });
});
