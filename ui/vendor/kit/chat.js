/**
 * Chat: a panel in the dock to talk with an agent that runs as `claude -p` on the server.
 *
 *   import { chat } from "./chat.js";
 *   chat({ url: "/api/chat", headers: { "X-My-App": "1" }, context: () => ({ page: location.href }) });
 *
 * Each message is one POST to `url` with `{ text, session, ...context() }`. The answer is a server-sent stream: each
 * `data:` is one line of `claude -p --output-format stream-json --verbose`, as the CLI wrote it, and `event: end` with
 * `{ error? }` closes the turn. The panel shows the agent's text, a line per tool call, and the cost of the turn. The
 * `session_id` of the stream goes with the next message, so the server can `--resume` the conversation.
 *
 * The transcript and the session live in localStorage under `key`, so a reload keeps them; New starts over. `key` may
 * be a function: the panel follows its value on each hash change, so a page can have a transcript of its own.
 *
 * When the page has the annotate tool (annotate.js), the @ button points the next message at annotations: one of the
 * page's notes, or a new one picked there and then. Their ids go with the message as `annotations`. Without the tool,
 * the button does not show.
 *
 * An image pasted or dropped on the panel goes with the next message as `images`, each `{ name, data }` with `data` in
 * base64. The transcript keeps only the count of the images.
 *
 * A message sent while the agent works waits in a queue and goes when the turn ends, one per turn. The queue lives only
 * in the page, so a reload drops it.
 */
import { dock, host } from "./dock.js";

const CSS = `
.pop { width: min(420px, calc(100vw - 32px)); height: min(560px, calc(100vh - 96px)); display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
.pop[hidden] { display: none; }
.head { display: flex; gap: 6px; align-items: center; }
.head b { flex: 1; }
.log { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.log p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.you { align-self: flex-end; max-width: 85%; padding: 6px 10px; border-radius: 10px; background: var(--sunk); }
.tool { color: var(--muted); font: 11px var(--code); }
.tool::before { content: "\\2192  "; }
.meta { color: var(--muted); font-size: 11px; text-align: right; }
.error { color: #d33; }
.busy { color: var(--muted); font-style: italic; }
.empty { color: var(--muted); }
.queued { opacity: .6; }
.queued button { border: 0; padding: 0 0 0 6px; background: none; color: var(--muted); }
form { display: flex; gap: 6px; align-items: end; }
textarea { flex: 1; resize: none; min-height: 36px; max-height: 160px; padding: 6px 8px; }
.you .ref { display: block; color: var(--muted); font-size: 12px; }
.menu { display: grid; gap: 2px; max-height: 180px; overflow-y: auto; padding: 4px; border: 1px solid var(--rule); border-radius: 6px; }
.menu[hidden], .point[hidden] { display: none; }
.menu button { border: 0; text-align: left; overflow-wrap: anywhere; }
.points { display: flex; flex-wrap: wrap; gap: 4px; }
.points:empty { display: none; }
.chip { display: inline-flex; gap: 2px; align-items: center; max-width: 100%; padding: 2px 4px 2px 8px; border-radius: 10px; background: var(--sunk); font-size: 12px; }
.chip img { max-height: 40px; max-width: 80px; border-radius: 4px; }
.chip button { border: 0; padding: 0 4px; background: none; color: var(--muted); }
.fab[aria-expanded="true"] { background: var(--accent); border-color: var(--accent); color: var(--bg); }
`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** One line for a tool call: the tool's name and the input field that says most. */
const call = (b) => {
  const i = b.input ?? {};
  const said = i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.description ?? JSON.stringify(i);
  return `${b.name} ${String(said).split("\n")[0].slice(0, 160)}`;
};

export function chat({ url = "/api/chat", headers = {}, context = () => ({}), key = "kit-chat", title = "Agent" } = {}) {
  if (document.getElementById("kit-chat")) return;
  const keyOf = () => typeof key === "function" ? key() : key;
  let at = keyOf();
  const load = () => { try { return JSON.parse(localStorage.getItem(at)) ?? { items: [] }; } catch { return { items: [] }; } };
  const save = () => { try { localStorage.setItem(at, JSON.stringify(state)); } catch {} };
  let state = load(), busy = false;

  const el = host("kit-chat", CSS, `<button type="button" class="fab" title="${esc(title)}" aria-expanded="false">&#10022;</button>` +
    `<div class="card pop" hidden><div class="head"><b>${esc(title)}</b><button type="button" class="new">New</button></div>` +
    `<div class="log" aria-live="polite"></div><div class="menu" hidden></div><div class="points"></div>` +
    `<form><textarea rows="1" placeholder="Ask, or paste a screenshot."></textarea><button type="button" class="point" title="Point at an annotation" hidden>@</button><button type="submit">Send</button></form></div>`);
  const ui = el.shadowRoot;
  const [fab, pop, log, menu, chips, form, box, point] = [".fab", ".pop", ".log", ".menu", ".points", "form", "textarea", ".point"].map((s) => ui.querySelector(s));
  /** The annotate tool's API when the page has the tool, else undefined. */
  const notes = () => document.getElementById("kit-annotate")?.annotate;
  /** The annotations the next message points at, as { id, label }. */
  let points = [];
  /** The images the next message takes, as { name, data, src }. */
  let shots = [];
  /** The messages that wait for the turn in flight to end, each as `message()` made it. */
  let queue = [];

  function draw() {
    log.innerHTML = state.items.map((m) => `<p class="${m.by}">${esc(m.text)}${(m.points ?? []).map((l) => `<span class="ref">@ ${esc(l)}</span>`).join("")}${m.shots ? `<span class="ref">${m.shots} image${m.shots > 1 ? "s" : ""}</span>` : ""}</p>`).join("") +
      (busy ? `<p class="busy">Working…</p>` : "") +
      queue.map((m, i) => `<p class="you queued">${esc(m.text)}<span class="ref">Queued${m.labels.length || m.images.length ? ` with ${[...m.labels.map((l) => `@ ${esc(l)}`), ...(m.images.length ? [`${m.images.length} image${m.images.length > 1 ? "s" : ""}`] : [])].join(", ")}` : ""}<button type="button" data-q="${i}" aria-label="Drop queued message">&times;</button></span></p>`).join("") || `<p class="empty">No messages yet.</p>`;
    log.scrollTop = log.scrollHeight;
    form.querySelector("button[type=submit]").textContent = busy ? "Queue" : "Send";
    point.hidden = !notes();
    chips.innerHTML = points.map((p, i) => `<span class="chip">@ ${esc(p.label)}<button type="button" data-i="${i}" aria-label="Remove">&times;</button></span>`).join("") +
      shots.map((m, i) => `<span class="chip"><img src="${m.src}" alt="${esc(m.name)}"><button type="button" data-shot="${i}" aria-label="Remove">&times;</button></span>`).join("");
  }
  const add = (by, text, refs, n) => { state.items.push({ by, text, ...(refs?.length ? { points: refs } : {}), ...(n ? { shots: n } : {}) }); save(); draw(); };
  /** Adds the images among `files` to the next message. */
  const attachFiles = async (files) => {
    for (const f of [...files].filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type))) {
      const src = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(f); });
      shots.push({ name: f.name || `pasted.${f.type.split("/")[1]}`, data: src.slice(src.indexOf(",") + 1), src });
    }
    draw();
  };
  /** Points the next message at annotation `a`, the `no`th note of the page. */
  const attach = (a, no) => { points = [...points.filter((p) => p.id !== a.id), { id: a.id, label: `#${no} ${a.note.split("\n")[0].slice(0, 40)}` }]; draw(); };

  /** Moves to the transcript of the current `key`; a turn in flight finishes first. */
  const sync = () => { if (busy || keyOf() === at) return; at = keyOf(); state = load(); points = []; draw(); };
  addEventListener("hashchange", sync);

  /** One stream-json event of the agent. */
  function take(ev) {
    if (ev.session_id) state.session = ev.session_id;
    if (ev.type === "assistant") for (const b of ev.message?.content ?? []) {
      if (b.type === "text" && b.text.trim()) add("agent", b.text.trim());
      if (b.type === "tool_use") add("tool", call(b));
    }
    if (ev.type === "result") {
      if (ev.is_error) add("error", ev.result || "The agent failed.");
      add("meta", [ev.total_cost_usd != null && `$${ev.total_cost_usd.toFixed(2)}`, ev.duration_ms != null && `${Math.round(ev.duration_ms / 1000)} s`].filter(Boolean).join(" · "));
    }
  }

  /** The next message: `text` with the annotations and images it takes, which it clears from the form. */
  function message(text) {
    const m = { text, ids: points.map((p) => p.id), labels: points.map((p) => p.label), images: shots.map(({ name, data }) => ({ name, data })) };
    points = [];
    shots = [];
    return m;
  }

  /** Runs the turn of message `m`, then the turn of the next queued message, if any. */
  async function send({ text, ids, labels, images }) {
    add("you", text, labels, images.length);
    busy = true;
    draw();
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ text, session: state.session, ...(ids.length ? { annotations: ids } : {}), ...(images.length ? { images } : {}), ...context() }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const frames = buf.split("\n\n");
        buf = frames.pop();
        for (const f of frames) {
          const name = /^event: (.*)$/m.exec(f)?.[1] ?? "message";
          const data = f.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
          if (!data) continue;
          let v;
          try { v = JSON.parse(data); } catch { continue; }
          if (name === "end") { if (v.error) add("error", v.error); }
          else take(v);
        }
      }
    } catch (e) {
      add("error", `The message failed: ${e.message}`);
    }
    if (queue.length) return send(queue.shift());
    busy = false;
    save();
    sync();
    draw();
  }

  const show = (open) => {
    pop.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    if (open) { draw(); box.focus(); }
  };
  fab.addEventListener("click", () => show(pop.hidden));
  point.addEventListener("click", () => {
    if (!menu.hidden) { menu.hidden = true; return; }
    menu.innerHTML = (notes()?.notes() ?? []).map((a, i) => `<button type="button" data-id="${esc(a.id)}">#${i + 1} ${esc(a.note.split("\n")[0].slice(0, 60))}</button>`).join("") +
      `<button type="button" class="pick">New: pick an element</button>`;
    menu.hidden = false;
  });
  // The panel hides while you pick, so it covers no element, and opens again with the new note attached.
  menu.addEventListener("click", async (e) => {
    const b = e.target.closest("button"), api = notes();
    if (!b || !api) return;
    menu.hidden = true;
    if (b.classList.contains("pick")) {
      show(false);
      const a = await api.pick();
      show(true);
      if (a) attach(a, api.notes().findIndex((x) => x.id === a.id) + 1);
      return;
    }
    const all = api.notes(), i = all.findIndex((x) => x.id === b.dataset.id);
    if (i >= 0) attach(all[i], i + 1);
  });
  log.addEventListener("click", (e) => {
    const q = e.target.closest("[data-q]")?.dataset.q;
    if (q === undefined) return;
    queue.splice(Number(q), 1);
    draw();
  });
  chips.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b?.dataset.shot !== undefined) shots.splice(Number(b.dataset.shot), 1);
    else if (b?.dataset.i !== undefined) points.splice(Number(b.dataset.i), 1);
    else return;
    draw();
  });
  ui.querySelector(".new").addEventListener("click", () => { if (busy) return; state = { items: [] }; shots = []; save(); draw(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = box.value.trim();
    if (!text) return;
    box.value = "";
    if (busy) { queue.push(message(text)); draw(); } else send(message(text));
  });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  box.addEventListener("input", () => { box.style.height = "auto"; box.style.height = `${box.scrollHeight}px`; });
  pop.addEventListener("paste", (e) => { const fs = e.clipboardData?.files; if (fs?.length) { e.preventDefault(); attachFiles(fs); } });
  pop.addEventListener("dragover", (e) => e.preventDefault());
  pop.addEventListener("drop", (e) => { e.preventDefault(); attachFiles(e.dataTransfer?.files ?? []); });
  dock().append(el);
  draw();
}
