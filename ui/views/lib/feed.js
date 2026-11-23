// The findings list that more than one view draws: the Monitor findings and the Design page.
import { esc } from "./html.js";

/** A finding as HTML: **text** and each number or percentage in bold; all other text escaped. */
export function findingHtml(text) {
  return esc(text).split(/\*\*(.+?)\*\*/).map((part, i) => i % 2 ? `<b>${part}</b>`
    : part.replace(/(&#?\w+;)|(\$?\d+(?:[.,]\d+)*%?)/g, (m, entity) => (entity ? m : `<b>${m}</b>`))).join("");
}

/**
 * The findings of a Monitor report as a numbered list, each through findingHtml().
 * @design findings-list
 */
export const findingsList = (findings) => `<ol class="findings">${findings.map((f) => `<li>${findingHtml(f)}</li>`).join("")}</ol>`;
