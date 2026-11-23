import { expect, test } from "bun:test";
// @ts-ignore the module is plain JS, shared with the page
import { browse, inspector } from "./browse.js";

const row = (key: string, title: string, who: string) => ({ key, lead: key, main: title, cells: ["$1"], text: `${key} ${title}`, data: { who }, inspect: `<p>about ${key}</p>` });
const groups = (more = "") => [
  { title: "Yours", count: "2", heads: ["Cost"], rows: [row("a1", "Alpha", "yours"), row("a2", "Beta", "yours")], ...(more ? { more } : {}) },
  { title: "Factory", count: "1", heads: ["Cost"], rows: [row("a3", "Gamma", "factory")] },
];
const list = (o = {}) => browse({ id: "t", label: "Things", search: "Search", filters: [{ label: "Who", name: "who", options: ["yours", "factory"] }], groups: groups(), ...o });

test("the list draws every row on one grid, the first selected, and the first row's inspector", () => {
  const h = list();
  expect(h.match(/class="lrow"/g)).toHaveLength(3);
  expect(h).toContain('style="--n: 1"');
  expect(h).toContain('data-key="a1" aria-current="true"');
  expect(h).toContain('data-key="a2" aria-current="false"');
  expect(h).toContain('<aside class="card ins" aria-label="Inspector"><p>about a1</p></aside>');
  expect(h.match(/<template data-inspect=/g)).toHaveLength(3);
});

test("a filter starts on its value: the other rows and their group head are not drawn", () => {
  const h = list({ filters: [{ label: "Who", name: "who", options: ["yours", "factory"], value: "yours" }] });
  expect(h).toContain('data-value="yours" aria-pressed="true"');
  expect(h).not.toContain('data-key="a3"');
  expect(h).not.toContain("Factory");
  expect(h).toContain('data-key="a1"');
});

test("a filter with more than 3 options is a select", () => {
  const h = list({ filters: [{ label: "Who", name: "who", options: ["a", "b", "c", "d"], value: "b" }] });
  expect(h).toContain('<select name="who" aria-label="Who">');
  expect(h).toContain('<option value="b" selected>b</option>');
  expect(h).not.toContain("data-name=\"who\"");
});

test("a group draws the first cap of its matches, with an N of M line; a row past the cap has no template, and its inspector is built when asked", () => {
  const rs = Array.from({ length: 5 }, (_, i) => ({ ...row(`k${i}`, `T${i}`, "yours"), inspect: () => `<p>about k${i}</p>` }));
  const h = list({ groups: [{ title: "G", count: "5", heads: [], rows: rs, cap: 2 }] });
  expect(h.match(/class="lrow"/g)).toHaveLength(2);
  expect(h).toContain('<li class="lmore">2 of 5</li>');
  expect(h.match(/<template data-inspect=/g)).toHaveLength(2);
  expect(h).toContain("<p>about k0</p>");
  expect(h).not.toContain("about k3");
});

test("a list cap limits all groups together", () => {
  const h = list({ cap: 2 });
  expect(h.match(/class="lrow"/g)).toHaveLength(2);
  expect(h).toContain('<li class="lmore">2 of 3</li>');
});

test("with no row left, the list says No match, and a group with no row says No data", () => {
  const none = list({ groups: [{ title: "Open", count: "0", heads: [], rows: [] }] });
  expect(none).toContain('<li class="lnone"><div class="empty"><p>No data</p></div></li>');
  expect(none).toContain("<p>Select a row</p>");
  const miss = list({ filters: [{ label: "Who", name: "who", options: ["nobody"], value: "nobody" }] });
  expect(miss).toContain('<li class="lnone" data-nomatch><div class="empty"><p>No match</p></div></li>');
});

test("a list with no group draws one empty line and a grid of no columns", () => {
  const h = list({ groups: [] });
  expect(h).toContain('style="--n: 0"');
  expect(h).toContain('<li class="lnone"><div class="empty"><p>No data</p></div></li>');
});

test("a more line shows with no filter on, and not while one is", () => {
  expect(list({ groups: groups("3 of 128") })).toContain('<li class="lmore">3 of 128</li>');
  expect(list({ groups: groups("3 of 128"), filters: [{ label: "Who", name: "who", options: ["yours"], value: "yours" }] })).not.toContain("3 of 128");
});

test("a row's text and a title are escaped", () => {
  expect(list({ groups: [{ title: "G<", count: "1", heads: [], rows: [row('a"1', "x", "yours")] }] })).toContain('data-key="a&quot;1"');
  expect(inspector({ id: "a1", title: "<b>", href: "#/a1", rows: [["Cost", "$1"], ["Empty", ""]] })).toBe(
    '<div class="inspect-head"><span class="idp">a1</span><a class="act" href="#/a1">Open page</a></div><h3>&lt;b&gt;</h3><dl class="facts"><div><dt>Cost</dt><dd>$1</dd></div></dl>');
});
