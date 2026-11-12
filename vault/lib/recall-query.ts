/**
 * The query of a Bash command that runs the vault CLI's recall (`vault recall …`, `bun …/cli.ts recall …`, `aleph memory recall …`),
 * as a command word after an optional `cd …;` or `&&`; null for anything else. Heredoc bodies are skipped,
 * and a grep or echo that only mentions the text is not a command word. Flags and their values are dropped.
 */
export function recallQuery(cmd: string): string | null {
  const lines: string[] = [];
  let end: string | null = null;
  for (const line of cmd.split("\n")) {
    if (end !== null) { if (line.trim() === end) end = null; continue; }
    lines.push(line);
    const h = /<<-?\s*(?:'([^']+)'|"([^"]+)"|(\w+))/.exec(line);
    if (h) end = h[1] ?? h[2] ?? h[3];
  }
  for (const line of lines) {
    // Quote-aware split into words; ; & | end a command.
    let words: string[] = [], cur = "", has = false, quote = "";
    const cmds: string[][] = [];
    const endWord = () => { if (has) words.push(cur); cur = ""; has = false; };
    const endCmd = () => { endWord(); if (words.length) cmds.push(words); words = []; };
    for (const c of line) {
      if (quote) { if (c === quote) quote = ""; else cur += c; }
      else if (c === '"' || c === "'") { quote = c; has = true; }
      else if (/\s/.test(c)) endWord();
      else if (c === ";" || c === "&" || c === "|") endCmd();
      else { cur += c; has = true; }
    }
    endCmd();
    for (const w of cmds) {
      const j = /^(bun|bunx)$/.test(w[0]) ? (w[1] === "run" ? 2 : 1) : -1;
      const at = w[0] === "vault" ? 1 : w[0] === "aleph" && w[1] === "memory" ? 2 : j >= 0 && /(^|\/)cli\.ts$/.test(w[j]) ? j + 1 : -1;
      if (w[at] !== "recall") continue;
      const args = w.slice(at + 1), q: string[] = [];
      for (let k = 0; k < args.length; k++) {
        if (args[k] === "--scope") k++;
        else if (!args[k].startsWith("--")) q.push(args[k]);
      }
      return q.join(" ");
    }
  }
  return null;
}
