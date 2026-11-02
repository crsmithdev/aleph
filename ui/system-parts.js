// Shared by the page and the UI server; imports nothing, so an edit to lib.js does not restart the server.
/** The tags Claude Code and its hooks wrap around text the user did not type. */
const SYSTEM_TAGS = ["task-notification", "system-reminder", "local-command-stdout", "local-command-stderr", "local-command-caveat", "command-name", "command-message", "command-args", "user-prompt-submit-hook", "bash-input", "bash-stdout", "bash-stderr"];
const SYSTEM_RE = new RegExp(`^[ \\t]*<(${SYSTEM_TAGS.join("|")})(?:\\s[^>\\n]*)?>([\\s\\S]*?)(?:</\\1>|$(?![\\s\\S]))`, "gm");
/**
 * A prompt split into its system parts and the text the user typed: `{ system: [{tag, body}], text }`.
 * A tag counts only at the start of a line, so a prompt that quotes `<system-reminder>` keeps it.
 * An unclosed tag (the hooks cut a prompt at 4 KB) runs to the end.
 */
export function systemParts(src) {
  const system = [];
  const text = String(src ?? "").replace(SYSTEM_RE, (_, tag, body) => (system.push({ tag, body: body.trim() }), "")).trim();
  return { system, text };
}
