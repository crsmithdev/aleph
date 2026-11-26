import { afterEach, describe, expect, test } from "bun:test";
// @ts-ignore the module is plain JS, shared with the page
import { postJson, scope, wireScope, projectKeysOnce, keep, kept } from "./address.js";

test("the scope bar takes a window name, its choices and an extra control; a click on days stays out of aleph.window", () => {
  const days = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];
  const h = scope(new URLSearchParams()).bar({ value: "7", name: "days", options: days, after: "<button>Pause</button>" });
  expect(h).toContain('data-name="days"');
  expect(h.match(/data-value="(7|30|90)"/g)).toHaveLength(3);
  expect(h).toContain('<option value="" selected>All Projects</option>');
  expect(h).toMatch(/<\/div><div class="fg"><button>Pause<\/button><\/div><\/div>$/);
  const g = globalThis as any, set: string[] = [];
  g.localStorage = { getItem: () => null, setItem: (k: string) => set.push(k) };
  g.location = { hash: "#/sessions" };
  try {
    let click: any;
    wireScope({ querySelector: () => ({ querySelector: () => null, addEventListener: (t: string, f: unknown) => { if (t === "click") click = f; } }) });
    click({ target: { closest: () => ({ dataset: { value: "30" }, parentElement: { dataset: { name: "days" } } }) } });
    expect(g.location.hash).toContain("days=30");
    expect(set).toEqual([]);
  } finally { delete g.localStorage; delete g.location; }
});

describe("projectKeysOnce", () => {
  const real = globalThis.fetch;
  afterEach(() => { globalThis.fetch = real; });
  // address.js keeps the keys for the page's life: each test takes a copy of the module of its own.
  let copies = 0;
  const once = async () => (await import(`./address.js?copy=${++copies}`)).projectKeysOnce as typeof projectKeysOnce;
  test("a non-ok response gives an empty list and does not throw, and the next call fetches again", async () => {
    const projectKeysOnce = await once();
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response("no", { status: 500 }); }) as any;
    expect(await projectKeysOnce()).toEqual([]);
    globalThis.fetch = (async () => { calls++; throw new Error("down"); }) as any;
    expect(await projectKeysOnce()).toEqual([]);
    expect(calls).toBe(2);
  });
  test("two calls give the same keys from one request", async () => {
    const projectKeysOnce = await once();
    const urls: string[] = [];
    globalThis.fetch = (async (u: string) => { urls.push(u); return Response.json({ aleph: { code: "a", issues: 1, onboarded: true }, other: { code: null, issues: 0, onboarded: false } }); }) as any;
    expect(await projectKeysOnce()).toEqual(["aleph", "other"]);
    expect(await projectKeysOnce()).toEqual(["aleph", "other"]);
    expect(urls).toEqual(["/api/projects"]);
  });
  test("the Project select has no label and lists All and aleph, the onboarded repos, then the rest with an open issue", async () => {
    const copy = await import(`./address.js?copy=${++copies}`);
    const p = (issues: number, onboarded = false) => ({ code: null, issues, onboarded });
    globalThis.fetch = (async () => Response.json({ zed: p(2), aleph: p(9, true), mid: p(0, true), beta: p(3, true), idle: p(0), alpha: p(1) })) as any;
    await copy.projectKeysOnce();
    const h = copy.scope(new URLSearchParams()).bar();
    expect(h).not.toContain('class="fl"');
    expect(h.match(/<select[^>]*>.*<\/select>/)![0]).toBe('<select name="project" aria-label="Project"><option value="" selected>All Projects</option><option value="aleph">aleph</option>' +
      '<option value="beta">beta</option><option value="mid">mid</option><option value="alpha">alpha</option><option value="zed">zed</option></select>');
    // The chosen project and a name the page adds stay listed, though neither has an open issue in the registry.
    const picked = copy.scope(new URLSearchParams("project=idle")).bar({ more: ["notes"] });
    expect(picked).toContain('<option value="idle" selected>idle</option><option value="zed">zed</option><option value="notes">notes</option>');
    // A name the page adds that the registry holds with no open issue is listed too.
    expect(copy.scope(new URLSearchParams()).bar({ more: ["idle"] })).toContain('<option value="idle">idle</option>');
    // The select keeps the names, for the options that wireScope draws again when the registry answers.
    expect(picked).toContain('aria-label="Project" data-more="notes">');
  });
});

test("postJson posts the JSON body with the UI header and throws the error text of a failed reply", async () => {
  const real = globalThis.fetch, seen: { url: unknown; init: any }[] = [];
  let reply = () => Response.json({ added: 7 });
  globalThis.fetch = (async (url: unknown, init: any) => { seen.push({ url, init }); return reply(); }) as any;
  try {
    expect(await postJson("/api/x", { a: 1 })).toEqual({ added: 7 });
    expect(seen[0].url).toBe("/api/x");
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.headers["X-Aleph-UI"]).toBe("1");
    expect(seen[0].init.body).toBe('{"a":1}');
    reply = () => Response.json({ error: "it cannot wait" }, { status: 422 });
    await expect(postJson("/api/x", {})).rejects.toThrow("it cannot wait");
    reply = () => new Response("no job named x", { status: 404 });
    await expect(postJson("/api/x", {})).rejects.toThrow("no job named x");
    reply = () => new Response("forbidden", { status: 403 });
    await expect(postJson("/api/x", {})).rejects.toThrow("forbidden");
    reply = () => new Response("Bad Gateway", { status: 502 });
    await expect(postJson("/api/x", {})).rejects.toThrow("Bad Gateway");
  } finally { globalThis.fetch = real; }
});

test("keep stores JSON under aleph.<key>, kept reads it back, and with no storage kept gives the fallback", () => {
  const g = globalThis as any, store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  try {
    keep("factory/agents/live", { form: "lines", hidden: ["Worker"] });
    expect(store.get("aleph.factory/agents/live")).toBe('{"form":"lines","hidden":["Worker"]}');
    expect(kept("factory/agents/live", {})).toEqual({ form: "lines", hidden: ["Worker"] });
    expect(kept("nope", {})).toEqual({});
    store.set("aleph.bad", "not json");
    expect(kept("bad", 1)).toBe(1);
    delete g.localStorage;
    expect(kept("factory/agents/live", {})).toEqual({});
    expect(() => keep("x", 1)).not.toThrow();
  } finally { delete g.localStorage; }
});
