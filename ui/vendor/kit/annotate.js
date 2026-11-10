/**
 * Annotate: click elements on a page, write a note on each, and copy the notes as Markdown for an agent.
 *
 *   import { annotate } from "./annotate.js";
 *   annotate();
 *
 * The dock button turns pick mode on and off; the count next to it opens the list. In pick mode a click on the page
 * opens a note for the element under the pointer instead of acting on it. Escape leaves pick mode. Each note keeps a
 * numbered pin on its element; a click on a pin edits the note. An element with a `data-annotate` attribute keeps its
 * pin when the page re-renders around it.
 *
 * `store` holds the annotations: `load()` resolves to all of them, `put(note)` adds or replaces one, `drop(id)` removes one,
 * and `watch(callback)` calls `callback(all)` when another writer changes them. The default keeps them in localStorage.
 * An annotation is { v: 2, id, url, selector, text, html, note, at, status, by, replies }; `url` is the page without its
 * query or anchor, `status` is "open" or "resolved", and a reply is { by, text, at }.
 */
import { dock, host } from "./dock.js";

export const local = (key = "annotations") => {
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || "[]").map((a) => ({ status: "open", by: "user", replies: [], ...a, v: 2 })); } catch { return []; } };
  const write = (all) => { try { localStorage.setItem(key, JSON.stringify(all)); } catch {} };
  return {
    load: async () => read(),
    put: async (a) => { const all = read(); write(all.some((x) => x.id === a.id) ? all.map((x) => (x.id === a.id ? a : x)) : [...all, a]); },
    drop: async (id) => write(read().filter((x) => x.id !== id)),
    // Another tab's write fires `storage`; this tab's own writes do not.
    watch: (fn) => { const on = (e) => { if (e.key === key) fn(read()); }; addEventListener("storage", on); return () => removeEventListener("storage", on); },
  };
};

const BAR = `
.bar { display: flex; border-radius: 20px; box-shadow: var(--shadow); }
.bar button { height: 40px; border-radius: 0; box-shadow: none; }
.bar .pick { width: 44px; border-radius: 20px 0 0 20px; font-size: 18px; }
.bar .count { min-width: 40px; border-left: 0; border-radius: 0 20px 20px 0; font-variant-numeric: tabular-nums; }
.on .pick { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.pop { display: grid; gap: 8px; }
.pop[hidden] { display: none; }
.head { display: flex; gap: 6px; align-items: center; }
.head b { flex: 1; }
ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
li { display: grid; grid-template-columns: 22px 1fr auto auto; gap: 6px; align-items: start; padding: 6px; border-radius: 6px; background: var(--sunk); cursor: pointer; }
li .no { font-weight: 600; color: var(--accent); }
li .sel { display: block; color: var(--muted); font: 11px var(--code); overflow-wrap: anywhere; }
li .st { color: var(--muted); font-size: 11px; }
li .rep { display: block; margin-top: 2px; padding-left: 8px; border-left: 2px solid var(--rule); color: var(--muted); }
li.resolved .txt { text-decoration: line-through; }
li .gone { color: var(--muted); font-style: italic; }
li button { padding: 0 6px; border: 0; background: none; color: var(--muted); }
.empty { color: var(--muted); margin: 0; }
`;

const LAYER = `
.layer { position: fixed; inset: 0; pointer-events: none; z-index: var(--kit-z, 2147483000); }
.glow { position: fixed; border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); border-radius: 3px; display: none; }
.pin.resolved { opacity: .5; }
.pin { position: fixed; pointer-events: auto; width: 22px; height: 22px; padding: 0; border-radius: 11px; border: 2px solid var(--bg);
  background: var(--accent); color: var(--bg); font: 600 11px/18px var(--font); text-align: center; transform: translate(-50%, -50%); box-shadow: var(--shadow); }
.edit { position: fixed; pointer-events: auto; width: 300px; display: grid; gap: 8px; }
.edit textarea { width: 100%; min-height: 70px; resize: vertical; padding: 6px; }
.edit code { color: var(--muted); font: 11px var(--code); overflow-wrap: anywhere; }
.edit .acts { display: flex; gap: 6px; }
.edit .acts .del { margin-right: auto; }
.edit .acts .save { background: var(--accent); border-color: var(--accent); color: var(--bg); }
`;

/** Mounts the dock button, the list and the pin layer. */
export function annotate({ store = local() } = {}) {
  if (document.getElementById("kit-annotate")) return;
  let all = [], picking = false, editing = null;
  // A hash that starts with "#/" or "#!/" is a route of a single-page app, so it names a page; any other hash is an anchor.
  const page = () => location.origin + location.pathname + (/^#!?\//.test(location.hash) ? location.hash : "");
  const here = () => all.filter((a) => a.url === page());

  const bar = host("kit-annotate", BAR, `<div class="bar"><button type="button" class="pick" title="Annotate: pick an element" aria-pressed="false">&#9998;</button>` +
    `<button type="button" class="count" title="Annotations on this page" aria-expanded="false">0</button></div>` +
    `<div class="card pop" hidden><div class="head"><b>Annotations</b><button type="button" class="copy">Copy</button><button type="button" class="clear">Clear</button></div><ol></ol></div>`);
  const ui = bar.shadowRoot;
  const [pickBtn, countBtn, list] = ["pick", "count", "pop"].map((c) => ui.querySelector(`.${c}`));

  const top = host("kit-annotate-layer", LAYER, `<div class="layer"><div class="glow"></div><div class="pins"></div></div>`);
  const lay = top.shadowRoot;
  const [glow, pins, layer] = [".glow", ".pins", ".layer"].map((s) => lay.querySelector(s));
  const ours = (e) => e.composedPath().some((n) => n === bar || n === top);

  /** Redraws the pins, the count and the list from `all`. */
  function draw() {
    const notes = here();
    countBtn.textContent = notes.length;
    pins.innerHTML = notes.map((a, i) => `<button type="button" class="pin ${a.status}" data-id="${a.id}" title="${esc(a.note)}">${i + 1}</button>`).join("");
    place();
    ui.querySelector("ol").innerHTML = notes.map((a, i) => `<li class="${a.status}" data-id="${a.id}"><span class="no">${i + 1}</span>` +
      `<span><span class="txt">${esc(a.note)}</span> <span class="st">${a.status}${a.by ? ` · ${esc(a.by)}` : ""}</span>` +
      a.replies.map((x) => `<span class="rep">${esc(x.by)}: ${esc(x.text)}</span>`).join("") + `<span class="sel">${esc(a.selector)}</span>${find(a) ? "" : `<span class="gone">Not on the page now</span>`}</span>` +
      `<button type="button" class="res" aria-label="${a.status === "open" ? "Resolve" : "Reopen"} annotation ${i + 1}">${a.status === "open" ? "&check;" : "&#8634;"}</button>` +
      `<button type="button" class="del" aria-label="Delete annotation ${i + 1}">&times;</button></li>`).join("") || `<p class="empty">No annotations on this page.</p>`;
  }

  /** Moves each pin to the top right corner of its element; a pin whose element is gone or hidden hides. */
  function place() {
    for (const pin of pins.children) {
      const el = find(all.find((a) => a.id === pin.dataset.id));
      const r = el?.getBoundingClientRect();
      pin.hidden = !r || !r.width || !r.height;
      if (!pin.hidden) Object.assign(pin.style, { left: `${r.right}px`, top: `${r.top}px` });
    }
  }

  /** Saves `a` in its place, or at the end when it is new; an empty note deletes it. */
  async function put(a) {
    if (a.note) {
      all = all.some((x) => x.id === a.id) ? all.map((x) => (x.id === a.id ? a : x)) : [...all, a];
      await store.put(a);
    } else {
      all = all.filter((x) => x.id !== a.id);
      await store.drop(a.id);
    }
    draw();
  }

  /** Opens the note editor next to `el` for annotation `a`, new or saved. */
  function edit(a, el) {
    shut();
    editing = a;
    const saved = all.some((x) => x.id === a.id);
    const box = document.createElement("div");
    box.className = "card edit";
    box.innerHTML = `<code>${esc(a.selector)}</code><textarea placeholder="What about this element?" aria-label="Note">${esc(a.note)}</textarea>` +
      `<div class="acts">${saved ? `<button type="button" class="del">Delete</button>` : ""}<button type="button" class="cancel">Cancel</button><button type="button" class="save">Save</button></div>`;
    layer.append(box);
    const r = el?.getBoundingClientRect() ?? { left: 16, bottom: 16, top: 16 };
    const below = r.bottom + 8 + 200 < innerHeight;
    Object.assign(box.style, { left: `${Math.max(8, Math.min(r.left, innerWidth - 308))}px`, top: `${below ? r.bottom + 8 : Math.max(8, r.top - 208)}px` });
    const text = box.querySelector("textarea");
    text.focus();
    const done = (note) => { shut(); return put({ ...a, note, at: new Date().toISOString() }); };
    box.querySelector(".save").onclick = () => done(text.value.trim());
    box.querySelector(".cancel").onclick = shut;
    if (saved) box.querySelector(".del").onclick = () => done("");
    text.onkeydown = (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) done(text.value.trim());
      if (e.key === "Escape") { e.stopPropagation(); shut(); }
    };
  }

  function shut() {
    editing = null;
    layer.querySelector(".edit")?.remove();
  }

  function mode(on) {
    picking = on;
    ui.querySelector(".bar").classList.toggle("on", on);
    pickBtn.setAttribute("aria-pressed", String(on));
    document.documentElement.style.cursor = on ? "crosshair" : "";
    if (!on) glow.style.display = "none";
  }

  // In pick mode the page gets no pointer events: the capture listeners take them first.
  const block = (e) => { if (picking && !ours(e)) { e.preventDefault(); e.stopImmediatePropagation(); } };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick"]) document.addEventListener(type, block, true);
  document.addEventListener("click", (e) => {
    if (!picking || ours(e)) return;
    block(e);
    glow.style.display = "none";
    edit({ v: 2, id: uid(), url: page(), selector: selector(e.target), text: words(e.target), html: snippet(e.target), note: "", status: "open", by: "user", replies: [] }, e.target);
  }, true);
  document.addEventListener("mousemove", (e) => {
    if (!picking || editing) return;
    if (ours(e)) { glow.style.display = "none"; return; }
    const r = e.target.getBoundingClientRect();
    Object.assign(glow.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (editing) shut();
    else if (picking) mode(false);
  });

  pickBtn.onclick = () => mode(!picking);
  countBtn.onclick = () => {
    list.hidden = !list.hidden;
    countBtn.setAttribute("aria-expanded", String(!list.hidden));
  };
  ui.querySelector(".copy").onclick = (e) => copy(markdown(here(), find)).then((ok) => flash(e.target, ok ? "Copied" : "Copy failed"));
  // Clear asks twice: the first click arms it for three seconds.
  ui.querySelector(".clear").onclick = async (e) => {
    if (!e.target.dataset.armed) {
      e.target.dataset.armed = "1";
      flash(e.target, "Sure?");
      setTimeout(() => delete e.target.dataset.armed, 3000);
      return;
    }
    const gone = here();
    all = all.filter((a) => a.url !== page());
    await Promise.all(gone.map((a) => store.drop(a.id)));
    draw();
  };
  ui.querySelector("ol").onclick = (e) => {
    const id = e.target.closest("li")?.dataset.id;
    const a = all.find((x) => x.id === id);
    if (!a) return;
    if (e.target.closest(".del")) return put({ ...a, note: "" });
    if (e.target.closest(".res")) return put({ ...a, status: a.status === "open" ? "resolved" : "open" });
    find(a)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  pins.onclick = (e) => {
    const a = all.find((x) => x.id === e.target.dataset.id);
    if (a) edit(a, find(a));
  };

  // A scroll moves the pins; a change to the page can also add or remove their elements, so it redraws the list too.
  const replace = frame(place), redraw = frame(draw);
  addEventListener("scroll", replace, { capture: true, passive: true });
  addEventListener("resize", replace);
  addEventListener("hashchange", draw);
  new MutationObserver(redraw).observe(document.body, { childList: true, subtree: true, characterData: true });

  dock().append(bar);
  document.body.append(top);
  store.load().then((saved) => { all = saved; draw(); });
  store.watch((saved) => { all = saved; draw(); });
}

/** The element an annotation names, or null when the page no longer has it. */
function find(a) {
  try { return a && document.querySelector(a.selector); } catch { return null; }
}

/** A selector for `el`: from the nearest `data-annotate` or unique id up the tree, else a path of nth-of-type steps from body. */
export function selector(el) {
  const parts = [];
  for (let at = el; at && at !== document.documentElement; at = at.parentElement) {
    if (at.dataset.annotate) return [`[data-annotate="${CSS.escape(at.dataset.annotate)}"]`, ...parts].join(" > ");
    if (at.id && document.querySelectorAll(`#${CSS.escape(at.id)}`).length === 1) return [`#${CSS.escape(at.id)}`, ...parts].join(" > ");
    const tag = at.tagName.toLowerCase();
    const same = [...at.parentElement.children].filter((c) => c.tagName === at.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(at) + 1})` : tag);
  }
  return parts.join(" > ");
}

/** The annotations of one page as Markdown, numbered as their pins are. */
export function markdown(notes, locate = find) {
  if (!notes.length) return "";
  const head = `Annotations on ${document.title || "the page"} (${notes[0].url}):`;
  const items = notes.map((a, i) => [
    `${i + 1}. ${a.note.replace(/\n/g, "\n   ")}`,
    `   - element: \`${a.selector}\``,
    ...(a.text ? [`   - text: "${a.text}"`] : []),
    `   - html: \`${a.html.replace(/`/g, "'")}\``,
    ...(locate(a) ? [] : ["   - not on the page now"]),
  ].join("\n"));
  return [head, "", ...items].join("\n");
}

/** `fn`, run at most once per animation frame. */
const frame = (fn) => { let queued = false; return () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(); }); }; };
const words = (el) => (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
const snippet = (el) => { const h = el.outerHTML.replace(/\s+/g, " "); return h.length > 300 ? `${h.slice(0, 300)}…` : h; };
// crypto.randomUUID needs a secure context, and a page on a plain http name is not one.
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Copies `text`; navigator.clipboard needs a secure context, so a plain http page falls back to execCommand. */
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const area = Object.assign(document.createElement("textarea"), { value: text });
  area.style.cssText = "position: fixed; opacity: 0;";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

function flash(btn, text) {
  const was = btn.dataset.label ??= btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = was; }, 1500);
}
