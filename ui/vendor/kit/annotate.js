/**
 * Annotate: click elements on a page, write a note on each, and copy the notes as Markdown for an agent.
 *
 *   import { annotate } from "./annotate.js";
 *   annotate();
 *
 * The dock button turns pick mode on and off; the count badge on it opens the list and hides while the page has none. In pick mode a click on the page
 * opens a note for the element under the pointer instead of acting on it. Escape leaves pick mode. Each note keeps a
 * numbered pin on its element; a click on a pin edits the note. An element with a `data-annotate` attribute keeps its
 * pin when the page re-renders around it. The note editor moves when you drag it by any part but its fields and
 * buttons. Its unsaved text stays in localStorage under "annotate-draft", so a reload opens it again.
 *
 * `store` holds the annotations: `load()` resolves to all of them, `put(a)` adds or replaces one, `drop(id)` deletes one,
 * and `watch(fn)`, when given, calls `fn` when someone else changed them. `local()` keeps them in localStorage;
 * `remote(base)` keeps them on a server, where an agent can read them, answer them and add its own.
 *
 * An annotation (v 2) is { v, id, url, selector, text, html, note, status, by, replies, at }:
 *   url      the page without its query or anchor; "" puts it on every page where the selector finds an element
 *   status   "open" or "resolved"; a resolved pin fades and Copy leaves it out
 *   by       "you" or "agent"
 *   replies  [{ by, text, at }]
 * A v 1 annotation has no status, by or replies: it reads as open, by you, with none.
 *
 * When the page has the chat tool (chat.js), the list's Send button sends the open notes of the page to the agent as one
 * message. When the agent's turn ends without an error, a "Clear N sent" button drops the notes it got.
 *
 * Other tools reach the notes through `document.getElementById("kit-annotate").annotate`: `notes()` gives the notes of
 * this page in pin order, and `pick()` turns pick mode on for one element and resolves with the saved note, or with
 * null when the pick or the note is cancelled.
 */
import { copy, dock, flash, host } from "./dock.js";

/** A store in localStorage under `key`; another tab's write reaches this one through the storage event. */
export function local(key = "annotations") {
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } };
  const write = (all) => { try { localStorage.setItem(key, JSON.stringify(all)); } catch {} };
  return {
    load: async () => read(),
    put: async (a) => write(upsert(read(), a)),
    drop: async (id) => write(read().filter((x) => x.id !== id)),
    watch: (fn) => addEventListener("storage", (e) => { if (e.key === key) fn(); }),
  };
}

/**
 * A store on a server: GET `base` answers all annotations, POST `base` with one puts it, POST `base/<id>/drop` deletes
 * it. `headers` go on each POST; `watch` is the page's own signal that the server's annotations changed.
 */
export function remote(base, { headers = {}, watch } = {}) {
  const send = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
    .then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); });
  return {
    load: () => fetch(base, { cache: "no-store" }).then((r) => r.json()),
    put: (a) => send(base, a),
    drop: (id) => send(`${base}/${encodeURIComponent(id)}/drop`, {}),
    watch,
  };
}

const upsert = (all, a) => (all.some((x) => x.id === a.id) ? all.map((x) => (x.id === a.id ? a : x)) : [...all, a]);

const BAR = `
.bar { position: relative; width: 40px; }
.bar .pick { font-size: 18px; }
.bar .count { position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 5px; border: 2px solid var(--bg); border-radius: 9px;
  background: var(--accent); color: var(--bg); font: 600 10px/14px var(--font); font-variant-numeric: tabular-nums; }
.bar .count::before { content: ""; position: absolute; inset: -6px; }
.bar .count:hover { background: var(--ink); border-color: var(--bg); }
.bar .count[hidden] { display: none; }
.on .pick { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.on .count, .count[aria-expanded="true"] { background: var(--ink); }
.pop { display: grid; gap: 8px; }
.pop[hidden] { display: none; }
.head { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.head button { white-space: nowrap; }
.head b { flex: 1; }
ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
li { display: grid; grid-template-columns: 22px 1fr auto; gap: 6px; align-items: start; padding: 6px; border-radius: 6px; background: var(--sunk); cursor: pointer; }
li .no { font-weight: 600; color: var(--accent); }
li .sel { display: block; color: var(--muted); font: 11px var(--code); overflow-wrap: anywhere; }
li .gone { color: var(--muted); font-style: italic; }
li.resolved { opacity: .5; }
.by, .reply { display: block; color: var(--muted); font-size: 12px; }
.reply::before { content: "\\21B3 "; }
li button { padding: 0 6px; border: 0; background: none; color: var(--muted); }
.empty { color: var(--muted); margin: 0; }
`;

const LAYER = `
.layer { position: fixed; inset: 0; pointer-events: none; z-index: var(--kit-z, 2147483000); }
.glow { position: fixed; border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); border-radius: 3px; display: none; }
.pin.agent { background: var(--ink); }
.pin.resolved { opacity: .4; }
.edit .replies { display: grid; gap: 4px; max-height: 120px; overflow-y: auto; font-size: 12px; }
.edit .replies p { margin: 0; }
.edit .replies b { color: var(--muted); font-weight: 600; }
.pin { position: fixed; pointer-events: auto; width: 22px; height: 22px; padding: 0; border-radius: 11px; border: 2px solid var(--bg);
  background: var(--accent); color: var(--bg); font: 600 11px/18px var(--font); text-align: center; transform: translate(-50%, -50%); box-shadow: var(--shadow); }
.edit { position: fixed; pointer-events: auto; width: 300px; display: grid; gap: 8px; cursor: move; touch-action: none; }
.edit textarea, .edit button { cursor: auto; }
.edit textarea { width: 100%; min-height: 70px; resize: vertical; padding: 6px; }
.edit code { color: var(--muted); font: 11px var(--code); overflow-wrap: anywhere; }
.edit .acts { display: flex; gap: 6px; }
.edit .acts .del { margin-right: auto; }
.edit .acts .save { background: var(--accent); border-color: var(--accent); color: var(--bg); }
`;

const DRAFT = "annotate-draft";
const draft = { read: () => { try { return JSON.parse(localStorage.getItem(DRAFT)); } catch { return null; } },
  write: (d) => { try { d ? localStorage.setItem(DRAFT, JSON.stringify(d)) : localStorage.removeItem(DRAFT); } catch {} } };

/** Mounts the dock button, the list and the pin layer. */
export function annotate({ store = local() } = {}) {
  if (document.getElementById("kit-annotate")) return;
  let all = [], picking = false, editing = null, wanted = null;
  /** True while the agent works on sent notes; the ids of sent notes whose turn ended without an error. */
  let sending = false, sent = [];
  /** The chat tool's API when the page has the tool, else undefined. */
  const agent = () => document.getElementById("kit-chat")?.chat;
  /** Gives `a` to the pick() that waits for a note, if one does. */
  const give = (a) => { const f = wanted; wanted = null; f?.(a); };
  // A hash that starts with "#/" or "#!/" is a route of a single-page app, so it names a page; any other hash is an anchor.
  const page = () => location.origin + location.pathname + (/^#!?\//.test(location.hash) ? location.hash : "");
  const here = () => all.filter((a) => a.url === page() || (!a.url && find(a)));

  const bar = host("kit-annotate", BAR, `<div class="bar"><button type="button" class="fab pick" title="Annotate: pick an element" aria-pressed="false">&#9998;</button>` +
    `<button type="button" class="count" title="Annotations on this page" aria-expanded="false">0</button></div>` +
    `<div class="card pop" hidden><div class="head"><b>Annotations</b><button type="button" class="send" title="Send the open notes to the agent" hidden>Send</button><button type="button" class="sent" title="The agent's turn ended: clear the notes it got" hidden></button><button type="button" class="copy">Copy</button><button type="button" class="clear">Clear</button></div><ol></ol></div>`);
  const ui = bar.shadowRoot;
  const [pickBtn, countBtn, list, sendBtn, sentBtn] = ["pick", "count", "pop", "send", "sent"].map((c) => ui.querySelector(`.${c}`));

  const top = host("kit-annotate-layer", LAYER, `<div class="layer"><div class="glow"></div><div class="pins"></div></div>`);
  const lay = top.shadowRoot;
  const [glow, pins, layer] = [".glow", ".pins", ".layer"].map((s) => lay.querySelector(s));
  const ours = (e) => e.composedPath().some((n) => n === bar || n === top);

  /** Redraws the pins, the count and the list from `all`. */
  function draw() {
    const notes = here();
    countBtn.textContent = notes.length;
    countBtn.hidden = !notes.length;
    sendBtn.hidden = sending || !agent() || !notes.some((a) => a.status !== "resolved");
    sent = sent.filter((id) => all.some((a) => a.id === id));
    sentBtn.hidden = !sent.length;
    sentBtn.textContent = `Clear ${sent.length} sent`;
    pins.innerHTML = notes.map((a, i) => `<button type="button" class="pin${a.by === "agent" ? " agent" : ""}${a.status === "resolved" ? " resolved" : ""}" data-id="${a.id}" title="${esc(a.note)}">${i + 1}</button>`).join("");
    place();
    ui.querySelector("ol").innerHTML = notes.map((a, i) => `<li data-id="${a.id}"${a.status === "resolved" ? ` class="resolved"` : ""}><span class="no">${i + 1}</span>` +
      `<span>${esc(a.note)}${a.by === "agent" ? `<span class="by">by the agent</span>` : ""}${(a.replies ?? []).map((r) => `<span class="reply">${esc(r.by)}: ${esc(r.text)}</span>`).join("")}` +
      `<span class="sel">${esc(a.selector)}</span>${find(a) ? "" : `<span class="gone">Not on the page now</span>`}</span>` +
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

  /** Loads the store again and redraws. */
  async function sync() {
    all = await store.load();
    draw();
  }

  /** Shows the change at once, then writes it; a failed write loads the store again, so the page shows what it holds. */
  async function write(change, op) {
    change();
    draw();
    try { await op(); } catch (e) { console.error("annotate:", e); await sync(); }
  }
  const put = (a) => write(() => { all = upsert(all, a); }, () => store.put(a));
  const drop = (id) => write(() => { all = all.filter((x) => x.id !== id); }, () => store.drop(id));

  /** Opens the note editor next to `el` for annotation `a`, new or saved, and gives its note and reply fields. */
  function edit(a, el) {
    shut();
    editing = a;
    const saved = all.some((x) => x.id === a.id);
    const box = document.createElement("div");
    box.className = "card edit";
    const replies = a.replies ?? [];
    box.innerHTML = `<code>${esc(a.selector)}</code><textarea class="note" placeholder="What about this element?" aria-label="Note">${esc(a.note)}</textarea>` +
      (replies.length ? `<div class="replies">${replies.map((r) => `<p><b>${esc(r.by)}</b> ${esc(r.text)}</p>`).join("")}</div>` : "") +
      (saved ? `<textarea class="answer" placeholder="Reply" aria-label="Reply"></textarea>` : "") +
      `<div class="acts">${saved ? `<button type="button" class="del">Delete</button><button type="button" class="state">${a.status === "resolved" ? "Reopen" : "Resolve"}</button>` : ""}` +
      `<button type="button" class="cancel">Cancel</button><button type="button" class="save">Save</button></div>`;
    layer.append(box);
    const r = el?.getBoundingClientRect() ?? { left: 16, bottom: 16, top: 16 };
    const below = r.bottom + 8 + 200 < innerHeight;
    Object.assign(box.style, { left: `${Math.max(8, Math.min(r.left, innerWidth - 308))}px`, top: `${below ? r.bottom + 8 : Math.max(8, r.top - 208)}px` });
    const text = box.querySelector(".note"), answer = box.querySelector(".answer");
    box.oninput = () => draft.write({ a, note: text.value, reply: answer?.value ?? "" });
    box.onpointerdown = (e) => {
      if (e.target.closest("textarea, button")) return;
      e.preventDefault();
      const r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (m) => Object.assign(box.style, { left: `${m.clientX - dx}px`, top: `${m.clientY - dy}px` });
      addEventListener("pointermove", move);
      addEventListener("pointerup", () => removeEventListener("pointermove", move), { once: true });
    };
    text.focus();
    // Save keeps the note's text and adds the reply, if any; an empty note deletes a saved note and drops a new one.
    const done = (status = a.status ?? "open") => {
      const f = wanted;
      wanted = null;
      shut();
      const note = text.value.trim(), reply = answer?.value.trim();
      if (!note) { f?.(null); return saved ? drop(a.id) : undefined; }
      const at = new Date().toISOString();
      const b = { ...a, v: 2, note, status, by: a.by ?? "you", replies: [...replies, ...(reply ? [{ by: "you", text: reply, at }] : [])], at };
      return put(b).then(() => f?.(b));
    };
    box.querySelector(".save").onclick = () => done();
    box.querySelector(".cancel").onclick = shut;
    if (saved) {
      box.querySelector(".del").onclick = () => { shut(); drop(a.id); };
      box.querySelector(".state").onclick = () => done(a.status === "resolved" ? "open" : "resolved");
    }
    for (const t of [text, answer].filter(Boolean)) t.onkeydown = (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) done();
      if (e.key === "Escape") { e.stopPropagation(); shut(); }
    };
    return { text, answer };
  }

  /** Closes the note editor; a pick() that waits for its note gets null. */
  function shut() {
    const open = editing;
    editing = null;
    draft.write(null);
    layer.querySelector(".edit")?.remove();
    if (open) give(null);
  }

  function mode(on) {
    picking = on;
    ui.querySelector(".bar").classList.toggle("on", on);
    pickBtn.setAttribute("aria-pressed", String(on));
    document.documentElement.style.cursor = on ? "crosshair" : "";
    if (!on) glow.style.display = "none";
    if (!on && !editing) give(null);
  }

  // In pick mode the page gets no pointer events: the capture listeners take them first.
  const block = (e) => { if (picking && !ours(e)) { e.preventDefault(); e.stopImmediatePropagation(); } };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick"]) document.addEventListener(type, block, true);
  document.addEventListener("click", (e) => {
    if (!picking || ours(e)) return;
    block(e);
    glow.style.display = "none";
    edit({ v: 2, id: uid(), url: page(), selector: selector(e.target), text: words(e.target), html: snippet(e.target), note: "", status: "open", by: "you", replies: [] }, e.target);
    // A pick() wants one element: pick mode ends once its note is open.
    if (wanted) mode(false);
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
  // An open list sits above the chat panel, which shares the dock's corner.
  const show = (on) => {
    list.hidden = !on;
    bar.style.zIndex = on ? "1" : "";
    countBtn.setAttribute("aria-expanded", String(on));
  };
  countBtn.onclick = () => show(list.hidden);
  ui.querySelector(".copy").onclick = (e) => copy(markdown(here().filter((a) => a.status !== "resolved"), find)).then((ok) => flash(e.target, ok ? "Copied" : "Copy failed"));
  // Send gives the open notes to the chat agent; once its turn ends without an error, "Clear N sent" drops them.
  sendBtn.onclick = async () => {
    const ids = here().filter((a) => a.status !== "resolved").map((a) => a.id);
    sending = true;
    show(false);
    draw();
    const error = await agent().send("Work on the open annotations of this page.", ids);
    sending = false;
    if (!error) { sent = [...new Set([...sent, ...ids])]; show(true); }
    draw();
  };
  sentBtn.onclick = async () => { const ids = sent; sent = []; for (const id of ids) await drop(id); };
  // Clear asks twice: the first click arms it for three seconds.
  ui.querySelector(".clear").onclick = async (e) => {
    if (!e.target.dataset.armed) {
      e.target.dataset.armed = "1";
      flash(e.target, "Sure?");
      setTimeout(() => delete e.target.dataset.armed, 3000);
      return;
    }
    for (const a of here()) await drop(a.id);
  };
  ui.querySelector("ol").onclick = (e) => {
    const id = e.target.closest("li")?.dataset.id;
    const a = all.find((x) => x.id === id);
    if (!a) return;
    if (e.target.closest(".del")) return drop(a.id);
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

  bar.annotate = {
    notes: () => here(),
    pick: () => { give(null); mode(true); return new Promise((done) => { wanted = done; }); },
  };
  dock().append(bar);
  document.body.append(top);
  store.watch?.(sync);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });
  // A draft of this page opens again on its saved note, or as a new note when it has none.
  sync().then(() => {
    const d = draft.read();
    if (!d || (d.a.url !== page() && !(d.a.url === "" && find(d.a)))) return;
    const a = all.find((x) => x.id === d.a.id) ?? d.a, el = find(a);
    el?.scrollIntoView({ block: "center" });
    const f = edit(a, el);
    f.text.value = d.note;
    if (f.answer) f.answer.value = d.reply;
    draft.write(d);
  });
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
  const head = `Annotations on ${document.title || "the page"} (${notes[0].url || location.href.split("?")[0]}):`;
  const items = notes.map((a, i) => [
    `${i + 1}. ${a.note.replace(/\n/g, "\n   ")}${a.by === "agent" ? " (by the agent)" : ""}`,
    `   - id: ${a.id}`,
    `   - element: \`${a.selector}\``,
    ...(a.text ? [`   - text: "${a.text}"`] : []),
    ...(a.html ? [`   - html: \`${a.html.replace(/`/g, "'")}\``] : []),
    ...(a.replies ?? []).map((r) => `   - reply from ${r.by}: ${r.text.replace(/\n/g, " ")}`),
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
