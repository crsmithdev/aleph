import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { citationFailure, citedUrls, deliver, fetcher, isPublicAddress, isResearch, pageText, readVerdict, searchUrls, serveFetches, writeWebServer } from "./research.ts";

const tmp = mkdtempSync(join(tmpdir(), "research-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const search = (id: string, ...urls: string[]) => [
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "WebSearch", input: { query: "q" } }] } }),
  JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "links" }] }, tool_use_result: { query: "q", results: [{ tool_use_id: "srv", content: urls.map((url) => ({ title: "t", url })) }, "summary text"] } }),
].join("\n") + "\n";

test("only a WebSearch result adds a URL", () => {
  const page = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "f1", name: "mcp__web__fetch_page", input: { url: "https://a.example/" } }, { type: "text", text: "https://model.example/" }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "f1", content: "https://page.example/" }] }, tool_use_result: { results: [{ content: [{ url: "https://page.example/" }] }] } }),
  ].join("\n");
  expect([...searchUrls(search("s1", "https://a.example/") + page + "not json\n")]).toEqual(["https://a.example/"]);
});

test("private, loopback, link-local and mapped addresses are not public", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.17.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"]) expect([ip, isPublicAddress(ip)]).toEqual([ip, false]);
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect([ip, isPublicAddress(ip)]).toEqual([ip, true]);
});

test("the fetcher refuses a private address, and a redirect to one", async () => {
  await expect(fetcher()("http://127.0.0.1:3010/secret")).rejects.toThrow("not a public address");
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (r) => new URL(r.url).pathname === "/page" ? new Response("<html><head><title>x</title></head><body><script>no()</script><p>hello</p></body></html>", { headers: { "content-type": "text/html" } }) : new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } }) });
  try {
    const only = (ip: string) => ip === "127.0.0.1";
    expect(await fetcher(only)(`http://127.0.0.1:${server.port}/page`)).toBe("hello");
    await expect(fetcher(only)(`http://127.0.0.1:${server.port}/away`)).rejects.toThrow("not a public address");
  } finally { server.stop(true); }
});

test("serveFetches answers a URL from the transcript and refuses any other", async () => {
  const dir = join(tmp, "serve");
  const requests = join(dir, "tmp", "fetches");
  mkdirSync(requests, { recursive: true });
  const log = join(tmp, "serve.log");
  writeFileSync(log, search("s1", "https://a.example/x"));
  const fetched: string[] = [];
  const s = serveFetches(dir, log, async (u) => { fetched.push(u); return "text of the page"; });
  const ask = async (id: string, url: string) => {
    writeFileSync(join(requests, `${id}.json`), JSON.stringify({ url }));
    for (let i = 0; i < 100; i++) { try { return JSON.parse(readFileSync(join(requests, `${id}.result.json`), "utf8")); } catch { await Bun.sleep(50); } }
    throw new Error("no answer");
  };
  expect(await ask("1", "https://a.example/x")).toEqual({ ok: true, text: "text of the page" });
  expect((await ask("2", "https://a.example/x?token=sk-ant-secret")).error).toContain("refused");
  const pages = await s.stop();
  expect(fetched).toEqual(["https://a.example/x"]);
  expect([...pages.keys()]).toEqual(["https://a.example/x"]);
});

test("the MCP server carries a fetch to the harness and back", async () => {
  const dir = join(tmp, "mcp");
  mkdirSync(join(dir, "bin"), { recursive: true });
  const config = JSON.parse(readFileSync(writeWebServer(dir), "utf8")).mcpServers.web;
  const log = join(tmp, "mcp.log");
  writeFileSync(log, search("s1", "https://a.example/x"));
  const s = serveFetches(dir, log, async () => "the page");
  const p = Bun.spawn([process.execPath, ...config.args], { stdin: "pipe", stdout: "pipe" });
  try {
    p.stdin.write(JSON.stringify({ id: 1, method: "tools/call", params: { name: "fetch_page", arguments: { url: "https://a.example/x" } } }) + "\n");
    p.stdin.flush();
    const { value } = await p.stdout.getReader().read();
    const reply = JSON.parse(new TextDecoder().decode(value));
    expect(reply.result).toEqual({ content: [{ type: "text", text: "the page" }], isError: false });
  } finally { p.kill(); await s.stop(); }
}, 15_000);

test("a report must cite, and only pages it read", () => {
  const pages = new Map([["https://a.example/x_(y)", "t"], ["https://b.example/", "t"]]);
  expect(citedUrls("See [a](https://a.example/x_(y)), and https://b.example/.")).toEqual(["https://a.example/x_(y)", "https://b.example/"]);
  expect(citationFailure("See [a](https://a.example/x_(y)).", pages)).toBeNull();
  expect(citationFailure("No links.", pages)).toBe("the report cites no source");
  expect(citationFailure("See https://c.example/.", pages)).toContain("did not read");
});

test("the verdict holds the thresholds", () => {
  const claims = (good: number, bad: number) => [...Array(good).fill({ claim: "c", verdict: "supported" }), ...Array(bad).fill({ claim: "wrong", verdict: "unsupported" })];
  expect(readVerdict(JSON.stringify({ answers_goal: true, claims: claims(9, 1) })).ok).toBe(true);
  expect(readVerdict(JSON.stringify({ answers_goal: true, claims: claims(8, 2) })).reason).toContain("8 of 10");
  expect(readVerdict(JSON.stringify({ answers_goal: false, claims: claims(5, 0) })).ok).toBe(false);
  expect(readVerdict(JSON.stringify({ answers_goal: true, claims: [] })).ok).toBe(false);
  expect(readVerdict("everything is fine").ok).toBe(false);
  expect(readVerdict(`Here: ${JSON.stringify({ answers_goal: true, claims: [{ claim: "c" }] })}`).ok).toBe(false);
});

test("deliver names the file by title and does not overwrite", () => {
  process.env.ALEPH_REPORTS = join(tmp, "reports");
  try {
    const a = deliver("A/B report", "aleph-1", "one");
    const b = deliver("A/B report", "aleph-2", "two");
    expect(a.endsWith("A-B report.md")).toBe(true);
    expect(b.endsWith("A-B report (aleph-2).md")).toBe(true);
    expect(readFileSync(a, "utf8")).toBe("one\n");
  } finally { delete process.env.ALEPH_REPORTS; }
});

test("the area research marks the goal; a plain page keeps its text", async () => {
  expect(isResearch({ fm: { areas: ["research"] } } as any)).toBe(true);
  expect(isResearch({ fm: { areas: ["jobs"] } } as any)).toBe(false);
  expect(await pageText("plain", "text/plain")).toBe("plain");
});
