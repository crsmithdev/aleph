/**
 * The query of a Bash command that runs the vault CLI's recall (`vault recall …`, `bun …/cli.ts recall …`),
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
      const i = w[0] === "vault" ? 0 : /^(bun|bunx)$/.test(w[0]) ? (w[1] === "run" ? 2 : 1) : -1;
      if (i < 0) continue;
      const ok = i === 0 ? w[1] === "recall" : /(^|\/)cli\.ts$/.test(w[i]) && w[i + 1] === "recall";
      if (!ok) continue;
      const args = w.slice(i === 0 ? 2 : i + 2), q: string[] = [];
      for (let k = 0; k < args.length; k++) {
        if (args[k] === "--scope") k++;
        else if (!args[k].startsWith("--")) q.push(args[k]);
      }
      return q.join(" ");
    }
  }
  return null;
}
