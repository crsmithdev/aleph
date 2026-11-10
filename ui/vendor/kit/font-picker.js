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
import { dock, host } from "./dock.js";

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

// Relative steps, not sizes. The first entry of each is the label of its unset state; spacing is letter spacing in em.
const STEPS = {
  size: ["Size", [["Smaller", 0.85], ["Small", 0.92], ["Large", 1.08], ["Larger", 1.18]]],
  weight: ["Weight", [["Lighter", -200], ["Light", -100], ["Heavy", 100], ["Heavier", 200]]],
  spacing: ["Spacing", [["Tighter", -0.02], ["Tight", -0.01], ["Wide", 0.02], ["Wider", 0.05]]],
};

const CSS = `
summary { list-style: none; }
summary::-webkit-details-marker { display: none; }
.fab { font: 600 18px Georgia, serif; }
.pop { display: grid; gap: 10px; }
.role { display: grid; gap: 4px; color: var(--muted); }
.row { display: flex; gap: 4px; height: 30px; }
select { flex: 1; min-width: 0; padding: 4px 6px; text-overflow: ellipsis; }
.row button { flex: none; width: 30px; padding: 0; font-size: 16px; line-height: 1; }
pre { height: 6em; overflow: auto; margin: 0; padding: 8px; font: 11px/1.4 var(--code); white-space: pre-wrap; background: var(--sunk); border-radius: 6px; }
.reset { justify-self: start; }
@media (max-width: 720px) { :host { display: none; } }
`;

/** Mounts the picker in the dock; `local` names families the page loads itself, which the picker does not fetch. */
export function fontPicker({ roles = ROLES, base = "sans", key = "font-picker", local = [] } = {}) {
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
    out.textContent = roles.flatMap((r) => [
      ...(chosen[r.name] ? [`--${r.name}: '${chosen[r.name]}', ${r.fallback};`] : []),
      ...Object.keys(STEPS).filter((p) => chosen[`${r.name}:${p}`] !== undefined)
        .map((p) => `${r.label} ${p}: ${STEPS[p][1].find(([, v]) => v === step(r.name, p))[0]}`),
    ]).join("\n") || "(the defaults)";
  }

  const el = host("kit-fonts", CSS, `<details><summary class="fab" title="Fonts" aria-label="Fonts">Aa</summary>
    <div class="card pop">${roles.map((r) => roleHtml(r, chosen, step, unset(r, roles, base))).join("")}<pre></pre><button type="button" class="reset">Reset</button></div></details>`);
  const shadow = el.shadowRoot;
  const out = shadow.querySelector("pre");
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

/** The select rows of one role: the family with its arrows, then one select per step kind. */
function roleHtml(r, chosen, step, none) {
  const groups = [...TYPES, ["Other", r.fonts.filter((f) => !TYPES.some(([, fs]) => fs.includes(f)))]]
    .map(([type, fonts]) => [type, fonts.filter((f) => r.fonts.includes(f))]).filter(([, fonts]) => fonts.length);
  const lower = r.label.toLowerCase();
  const family = `<select data-role="${r.name}" aria-label="${r.label} font"><option value="">${none}</option>` +
    groups.map(([type, fonts]) => `<optgroup label="${type}">${fonts.map((f) => `<option${chosen[r.name] === f ? " selected" : ""}>${f}</option>`).join("")}</optgroup>`).join("") + `</select>`;
  const steps = Object.entries(STEPS).filter(([prop]) => (r.steps ?? Object.keys(STEPS)).includes(prop)).map(([prop, [name, list]]) =>
    `<select data-role="${r.name}" data-prop="${prop}" aria-label="${r.label} ${prop}"><option value="">${name}</option>` +
    list.map(([n, v]) => `<option value="${v}"${step(r.name, prop) === v ? " selected" : ""}>${n}</option>`).join("") + `</select>`).join("");
  return `<div class="role"><span>${r.label}</span>` +
    `<div class="row"><button type="button" data-step="-1" aria-label="Previous ${lower} font">&lsaquo;</button>${family}` +
    `<button type="button" data-step="1" aria-label="Next ${lower} font">&rsaquo;</button></div><div class="row">${steps}</div></div>`;
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
    out.push({ selector: selector.trim(), media, role: role ?? base, bound: Boolean(role), size: /px$|em$|var\(--fs/.test(size) ? size : "",
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
