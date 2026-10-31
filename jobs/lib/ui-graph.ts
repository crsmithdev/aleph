import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

/** The repo-relative files that the aleph-ui server loads: `ui/server.ts` and `ui/api/*.ts` (loaded by a dynamic import), plus every relative import below them. Never throws. */
export function serverGraph(root: string): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  const add = (rel: string) => {
    if (!seen.has(rel)) { seen.add(rel); queue.push(rel); }
  };
  if (isFile(join(root, "ui/server.ts"))) add("ui/server.ts");
  try {
    for (const f of readdirSync(join(root, "ui/api")).sort()) {
      if (f.endsWith(".ts") && !f.endsWith(".test.ts")) add(`ui/api/${f}`);
    }
  } catch {}
  while (queue.length) {
    const rel = queue.pop()!;
    let imports: { path: string }[];
    try {
      const loader = rel.endsWith(".js") ? "js" : "ts";
      imports = new Bun.Transpiler({ loader }).scanImports(readFileSync(join(root, rel), "utf8"));
    } catch { continue; }
    for (const { path: spec } of imports) {
      if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
      const base = posix.join(posix.dirname(rel), spec);
      const hasExt = posix.extname(spec) !== "";
      const candidates = hasExt ? [base] : [`${base}.ts`, `${base}.js`, `${base}/index.ts`];
      for (const c of candidates) {
        if (c.startsWith("../")) continue;
        try {
          if (isFile(join(root, c))) { add(c); break; }
        } catch {}
      }
    }
  }
  return seen;
}
