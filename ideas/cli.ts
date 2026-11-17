import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Ctx } from "../cli/commands.ts";
import { loadRegistry } from "../jobs/lib/records/ledger.ts";
import { refuse } from "../lib/refusal.ts";
import { key, parseId, parseKey, shownKey } from "../lib/naming.ts";
import { projectName } from "../issues/lib/projects.ts";
import * as ideas from "./ideas.ts";

/** An issue named in `idea built`, as its key: `issue.5`, a shown form such as `a1234`, or an old `aleph-5`. */
const builtRef = (ref: string): string => { const k = parseKey(ref) ?? (parseId(ref) && { kind: "issue", n: parseId(ref)!.n }); return k && k.kind === "issue" ? key("issue", k.n) : refuse(`not an issue: ${ref}`); };

/** `aleph idea ...`: the ideas store (ideas/ideas.ts). `-` as a text flag reads stdin. */
export async function ideaCmd(ctx: Ctx, use: string): Promise<void> {
  /** The idea number as text from the first argument, or a usage refusal. */
  const ideaArg = (arg: string | undefined): string => ideas.slugOf(arg ?? refuse(use));
  const [verb, ...args] = ctx.positional;
  const text = async (name: string) => { const v = ctx.flag(name); return v === "-" ? await ctx.stdin() : v ?? ""; };
  const warn = (w: string | null) => { if (w) ctx.err(w); };
  switch (verb) {
    case "add": {
      const target = ctx.flag("target");
      if (target && !loadRegistry()[target]) refuse(`no repo named ${target}`);
      const a = ideas.add(args.join(" "), await text("sketch"), target);
      warn(a.warn);
      ctx.log(shownKey(key("idea", Number(a.slug))));
      return;
    }
    case "list":
      for (const r of ideas.list(ctx.flag("status"))) ctx.log([shownKey(key("idea", Number(r.idea.slug))), projectName(String(r.idea.fm.project ?? "")) ?? "new project", r.lenses.join(",") || "-", r.last].join("  "));
      return;
    case "show": {
      const slug = ideaArg(args[0]);
      ideas.read(slug);
      const results = ideas.lenses(slug).map((l) => `- ${l.lens} ${l.at} ${l.file}`);
      ctx.write(`${readFileSync(ideas.file(slug), "utf8")}\n## Lens results\n\n${results.join("\n") || "none"}\n`);
      return;
    }
    case "edit": return warn(ideas.edit(ideaArg(args[0]), await text("writeup")));
    case "note": return warn(ideas.note(ideaArg(args[0]), args.slice(1).join(" ")));
    case "built": return warn(ideas.built(ideaArg(args[0]), args.slice(1).map(builtRef)));
    case "drop": return warn(ideas.drop(ideaArg(args[0])));
    case "lens": {
      const l = await ideas.lens(ideaArg(args[0]), args[1] ?? refuse(use));
      warn(l.warn);
      ctx.log(l.file);
      return;
    }
    case "save": {
      const [slug, lens, from] = args;
      const s = ideas.save(ideaArg(slug), lens ?? refuse(use), resolve(from ?? refuse(use)));
      warn(s.warn);
      ctx.log(s.file);
      return;
    }
    default: refuse(use);
  }
}
