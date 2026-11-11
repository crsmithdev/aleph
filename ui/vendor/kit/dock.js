/**
 * The corner where kit widgets float, and the styles they share.
 *
 * Each widget is a host element with a shadow root, so page styles and widget styles do not mix.
 * A page themes the widgets through the --kit-* variables on :root; each has a light and a dark default.
 * --kit-bg fills panels and buttons, --kit-field fills selects and text areas, --kit-sunk fills a hovered button.
 */

/** The fixed column at the bottom right of the page that holds the widget buttons. */
export function dock() {
  const found = document.getElementById("kit-dock");
  if (found) return found;
  const el = Object.assign(document.createElement("div"), { id: "kit-dock" });
  el.style.cssText = "position: fixed; right: 16px; bottom: 16px; z-index: var(--kit-z, 2147483000); display: flex; flex-direction: column-reverse; align-items: flex-end; gap: 8px;";
  document.body.append(el);
  return el;
}

/** A host element with an open shadow root that holds the base styles, `css` and `html`. */
export function host(id, css, html) {
  const el = Object.assign(document.createElement("div"), { id });
  el.attachShadow({ mode: "open" }).innerHTML = `<style>${BASE}${css}</style>${html}`;
  return el;
}

/** Copies `text`; navigator.clipboard needs a secure context, so a plain http page falls back to execCommand. */
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const area = Object.assign(document.createElement("textarea"), { value: text });
  area.style.cssText = "position: fixed; opacity: 0;";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

/** Shows `text` on `btn` for 1.5 s. */
export function flash(btn, text) {
  const was = btn.dataset.label ??= btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = was; }, 1500);
}

export const BASE = `
:host {
  --bg: var(--kit-bg, #fff); --field: var(--kit-field, #f6f6f9); --sunk: var(--kit-sunk, #f1f1f4); --ink: var(--kit-ink, #1d1e24); --muted: var(--kit-muted, #6a6d7c);
  --rule: var(--kit-rule, #d6d7de); --accent: var(--kit-accent, #4b63d8); --shadow: var(--kit-shadow, 0 4px 18px rgb(0 0 0 / .18));
  --font: var(--kit-font, system-ui, sans-serif); --code: var(--kit-code, ui-monospace, monospace);
  position: relative; color: var(--ink); font: 13px/1.4 var(--font);
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: var(--kit-bg, #24252d); --field: var(--kit-field, #1e1f26); --sunk: var(--kit-sunk, #1a1b21); --ink: var(--kit-ink, #e6e7ee); --muted: var(--kit-muted, #9a9db0);
    --rule: var(--kit-rule, #3a3c48); --accent: var(--kit-accent, #8da0ff); --shadow: var(--kit-shadow, 0 4px 18px rgb(0 0 0 / .5));
  }
}
* { box-sizing: border-box; }
button, select, textarea { font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 6px; }
button { cursor: pointer; padding: 3px 10px; }
select, textarea { background: var(--field); }
button:hover { background: var(--sunk); border-color: var(--muted); }
select:hover, textarea:hover { border-color: var(--muted); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.fab { width: 40px; height: 40px; padding: 0; display: grid; place-items: center; border-radius: 20px; box-shadow: var(--shadow);
  color: var(--ink); background: var(--bg); border: 1px solid var(--rule); cursor: pointer; }
.fab:hover { background: var(--sunk); border-color: var(--muted); }
.card { background: var(--bg); border: 1px solid var(--rule); border-radius: 10px; box-shadow: var(--shadow); padding: 12px; }
.pop { position: absolute; right: calc(100% + 8px); bottom: 0; width: min(320px, calc(100vw - 32px)); max-height: calc(100vh - 96px); overflow-y: auto; }
`;
