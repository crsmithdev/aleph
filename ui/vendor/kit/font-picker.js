/**
 * Font picker: a floating panel that picks a family, and a size, weight and spacing step, for each font role of a page.
 *
 *   import { fontPicker } from "./font-picker.js";
 *   fontPicker();                     // the roles display, sans and mono
 *   fontPicker({ roles: [...], key: "my-app-fonts" });
 *
 * A role `r` is the CSS variable `--r` that the page's stylesheets use as a font family. The picker sets `--r` to the
 * chosen family, and `--r-scale` and `--r-weight` for text no stylesheet reaches, such as a canvas.
 * The steps rewrite each rule of the page's same-origin stylesheets that sets a font. A rule's role is the `var(--r)` it
 * names, or `base` when it names none. Choices persist in localStorage under `key`.
 */
import { copy, dock, flash, host } from "./dock.js";

const byName = (a) => a.sort((x, y) => x.localeCompare(y));
export const SANS = byName(["Work Sans", "Inter", "Roboto", "Open Sans", "Montserrat", "Lato", "Poppins", "Nunito Sans", "Source Sans 3", "Raleway",
  "Noto Sans", "Rubik", "DM Sans", "Manrope", "IBM Plex Sans", "Figtree", "Outfit", "Plus Jakarta Sans", "Lexend", "Barlow"]);
export const SERIF = byName(["Merriweather", "Playfair Display", "Lora", "Roboto Slab", "PT Serif", "Libre Baskerville", "Source Serif 4", "Noto Serif",
  "EB Garamond", "Crimson Pro", "Fraunces", "DM Serif Display", "Bitter", "Cormorant Garamond", "Spectral"]);
export const MONO = byName(["JetBrains Mono", "Fira Code", "IBM Plex Mono", "Roboto Mono", "Source Code Pro", "Space Mono",
  "Ubuntu Mono", "Inconsolata", "DM Mono", "Red Hat Mono", "Geist Mono"]);
const TYPES = [["Serif", SERIF], ["Sans", SANS], ["Mono", MONO]];

// A role: `name` is the variable, `fonts` the choices, `default` the family the page uses when none is chosen
// (empty: the same as the base role), `steps` the step kinds it offers.
export const ROLES = [
  { name: "display", label: "Titles", fonts: [...SERIF, ...SANS], default: "", fallback: "Georgia, serif" },
  { name: "sans", label: "Text", fonts: SANS, default: "", fallback: "system-ui, sans-serif" },
  { name: "mono", label: "Code", fonts: MONO, default: "", fallback: "ui-monospace, monospace" },
];

// Relative steps, not sizes: size scales, weight adds, spacing adds em of letter spacing. Each list is in order, and its
// unset value (1 or 0) is the empty option. `show` is the label of a value.
const sign = (v) => (v > 0 ? `+${v}` : v < 0 ? `\u2212${-v}` : "\u00b10");
const STEPS = {
  size: ["Size", [0.85, 0.92, 1, 1.08, 1.18], (v) => `${Math.round(v * 100)}%`],
  weight: ["Weight", [-200, -100, 0, 100, 200], sign],
  spacing: ["Spacing", [-0.02, -0.01, 0, 0.02, 0.05], (v) => (v ? `${sign(v).replace("0.", ".")}em` : sign(v))],
};

// A size the steps can scale: a length, or a var(), calc(), clamp(), min() or max(). A keyword such as `small` is not one.
const SIZE = /^(?:-?[\d.]+(?:px|r?em|%|pt|vw|vh|vmin|vmax|ch|ex)|(?:var|calc|clamp|min|max)\(.+\))$/;

const CSS = `
summary { list-style: none; }
summary::-webkit-details-marker { display: none; }
.fab { font: 600 18px Georgia, serif; }
.pop { width: min(460px, calc(100vw - 32px)); display: grid; gap: 4px; padding: 10px; }
.head { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
.head b { flex: 1; }
.row { display: grid; grid-template-columns: 3.6em 20px minmax(0, 1fr) 20px 58px 58px 66px; gap: 3px; align-items: center; height: 26px; }
.row > span { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cols { height: auto; color: var(--muted); font-size: 11px; }
.cols span:first-child { grid-column: 2 / 5; }
select { width: 100%; height: 100%; min-width: 0; padding: 0 4px; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.row button { height: 100%; padding: 0; font-size: 15px; line-height: 1; }
`;

/**
 * Mounts the picker in the dock. `local` names families the page loads itself, which the picker does not fetch.
 * `hideBelow` hides the picker on a viewport narrower than that many pixels; 0 shows it at every width.
 */
export function fontPicker({ roles = ROLES, base = "sans", key = "font-picker", local = [], hideBelow = 0 } = {}) {
  if (document.getElementById("kit-fonts")) return;
  const root = document.documentElement.style;
  const chosen = read(key);
  const step = (role, prop) => { const v = chosen[`${role}:${prop}`]; return v === undefined ? (prop === "size" ? 1 : 0) : Number(v); };
  const loaded = new Set(local);
  const load = (family) => { if (family && !loaded.has(family)) { loaded.add(family); fetchFont(family); } };
  const adjusted = document.createElement("style");
  let rules = [];

  function apply() {
    for (const r of roles) {
      const f = chosen[r.name];
      if (f || chosen[`${r.name}:weight`]) load(f || r.default);
      if (f) root.setProperty(`--${r.name}`, `'${f}', ${r.fallback}`);
      else root.removeProperty(`--${r.name}`);
      root.setProperty(`--${r.name}-scale`, step(r.name, "size"));
      root.setProperty(`--${r.name}-weight`, 400 + step(r.name, "weight"));
    }
    adjusted.textContent = rules.map((r) => adjust(r, step)).filter(Boolean).join("\n");
  }

  /** The choices as JSON for an agent: per role variable, the family (null: the page's own) and the three steps. */
  const exported = () => JSON.stringify(Object.fromEntries(roles.map((r) => [`--${r.name}`, {
    family: chosen[r.name] ?? null, fallback: r.fallback,
    sizeScale: step(r.name, "size"), weightDelta: step(r.name, "weight"), letterSpacingEm: step(r.name, "spacing"),
  }])), null, 2);

  const el = host("kit-fonts", CSS + (hideBelow ? `@media (max-width: ${hideBelow}px) { :host { display: none; } }` : ""), `<details><summary class="fab" title="Fonts" aria-label="Fonts">Aa</summary>
    <div class="card pop"><div class="head"><b>Fonts</b><button type="button" class="copy">Copy</button><button type="button" class="reset">Reset</button></div>` +
    `<div class="row cols">${["Family", ...Object.values(STEPS).map(([n]) => n)].map((n) => `<span>${n}</span>`).join("")}</div>` +
    `${roles.map((r) => roleHtml(r, chosen, step, unset(r, roles, base))).join("")}</div></details>`);
  const shadow = el.shadowRoot;
  shadow.addEventListener("change", (e) => {
    const { role, prop } = e.target.dataset;
    if (!role) return;
    const k = prop ? `${role}:${prop}` : role;
    if (e.target.value) chosen[k] = e.target.value;
    else delete chosen[k];
    save(key, chosen);
    apply();
  });
  // The arrows step the select next to them and wrap at the ends.
  shadow.addEventListener("click", (e) => {
    const by = Number(e.target.closest("[data-step]")?.dataset.step);
    if (!by) return;
    const sel = e.target.closest(".row").querySelector("select");
    const n = sel.options.length;
    sel.selectedIndex = (sel.selectedIndex + by + n) % n;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  shadow.querySelector(".copy").addEventListener("click", (e) => copy(exported()).then((ok) => flash(e.target, ok ? "Copied" : "Copy failed")));
  shadow.querySelector(".reset").addEventListener("click", () => {
    for (const k of Object.keys(chosen)) delete chosen[k];
    for (const s of shadow.querySelectorAll("select")) s.value = "";
    save(key, chosen);
    apply();
  });

  document.head.append(adjusted);
  dock().append(el);
  apply();
  sources().then((texts) => { rules = texts.flatMap((t) => scan(t, roles, base)); apply(); });
}

/** The label of a role's unset family: its default, or the base role whose family it then takes. */
function unset(r, roles, base) {
  const from = roles.find((x) => x.name === base);
  if (r.default) return `Default (${r.default})`;
  return r.name === base || !from ? "Default" : `Same as ${from.label.toLowerCase()}`;
}

/** The row of one role: its label, the family with its arrows, then a select per step kind, or a gap where it has none. */
function roleHtml(r, chosen, step, none) {
  const groups = [...TYPES, ["Other", r.fonts.filter((f) => !TYPES.some(([, fs]) => fs.includes(f)))]]
    .map(([type, fonts]) => [type, fonts.filter((f) => r.fonts.includes(f))]).filter(([, fonts]) => fonts.length);
  const lower = r.label.toLowerCase();
  const family = `<select data-role="${r.name}" aria-label="${r.label} font"><option value="">${none}</option>` +
    groups.map(([type, fonts]) => `<optgroup label="${type}">${fonts.map((f) => `<option${chosen[r.name] === f ? " selected" : ""}>${f}</option>`).join("")}</optgroup>`).join("") + `</select>`;
  const steps = Object.entries(STEPS).map(([prop, [, list, show]]) => !(r.steps ?? Object.keys(STEPS)).includes(prop) ? "<span></span>" :
    `<select data-role="${r.name}" data-prop="${prop}" aria-label="${r.label} ${prop}" title="${r.label} ${prop}">` +
    list.map((v) => `<option value="${v === (prop === "size" ? 1 : 0) ? "" : v}"${step(r.name, prop) === v ? " selected" : ""}>${show(v)}</option>`).join("") + `</select>`).join("");
  return `<div class="row"><span title="${r.label}">${r.label}</span><button type="button" data-step="-1" aria-label="Previous ${lower} font">&lsaquo;</button>${family}` +
    `<button type="button" data-step="1" aria-label="Next ${lower} font">&rsaquo;</button>${steps}</div>`;
}

/** The source text of the page's same-origin stylesheets and style elements. */
async function sources() {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).filter((h) => new URL(h).origin === location.origin);
  const inline = [...document.querySelectorAll("head style, body > style")].map((s) => s.textContent);
  return [...inline, ...await Promise.all(links.map((h) => fetch(h).then((r) => r.text(), () => "")))];
}

/**
 * Each rule of `source` that sets a font, with the role whose text it styles.
 * This reads the source: CSSOM gives an empty `font` for a var() shorthand that a longhand follows.
 */
function scan(source, roles, base) {
  const out = [];
  let media = "";
  for (const [, at, selector, body] of source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(@media[^{]+)\{|([^{}]+)\{([^{}]*)\}|\}/g)) {
    if (at) { media = at.trim(); continue; }
    if (!selector) { media = ""; continue; }
    const get = (prop) => body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1].trim() ?? "";
    const font = get("font"), family = get("font-family");
    const role = roles.find((r) => `${font} ${family}`.includes(`var(--${r.name})`))?.name;
    const m = font.match(/^(?:(\d{3})\s+)?(\S+?)(?:\/\S+)?\s/);
    const size = m?.[2] || get("font-size"), spacing = get("letter-spacing");
    out.push({ selector: selector.trim(), media, role: role ?? base, bound: Boolean(role), size: SIZE.test(size) ? size : "",
      weight: Number(m?.[1] || get("font-weight")) || 0, spacing: /em$/.test(spacing) ? spacing : "" });
  }
  return out;
}

/** The override rule for one scanned rule under the chosen steps, or "" when no step changes it. */
function adjust(r, step) {
  const s = step(r.role, "size"), w = step(r.role, "weight"), sp = step(r.role, "spacing");
  const out = [];
  if (s !== 1 && r.size) out.push(`font-size: calc(${r.size} * ${s})`);
  if (w && (r.weight || r.bound)) out.push(`font-weight: ${Math.min(900, Math.max(100, (r.weight || 400) + w))}`);
  if (sp && (r.spacing || r.bound)) out.push(`letter-spacing: calc(${r.spacing || "0em"} + ${sp}em)`);
  if (!out.length) return "";
  const rule = `${r.selector} { ${out.join("; ")}; }`;
  return r.media ? `${r.media} { ${rule} }` : rule;
}

/** Adds a Google Fonts sheet for `family`; asks for five weights, and a family without them gets a plain request instead. */
function fetchFont(family) {
  const q = family.replaceAll(" ", "+");
  const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${q}:wght@300;400;500;600;700&display=swap` });
  link.onerror = () => { link.href = `https://fonts.googleapis.com/css2?family=${q}&display=swap`; link.onerror = null; };
  document.head.append(link);
}

const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
