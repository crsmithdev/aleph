/**
 * Skill A/B harness, run by hand: `bun evals/ab.ts --variant a=./plugin-a --variant b=./plugin-b --cases cases.json [--runs 3]`.
 * `cases.json` is an array of `{ "prompt": …, "cwd": … }`. Each case runs `--runs` times per variant, one headless
 * `claude -p --plugin-dir <variant>` per run. A judge then sees a case's outputs under shuffled anonymous labels, and its
 * scores go to Langfuse on each run's session, with the run's `total_cost_usd`.
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { langfuseConfig, type LangfuseConfig } from "../lib/env.ts";
import { postScore } from "../lib/otlp.ts";
import { subscriptionEnv } from "../jobs/lib/roles/agent-call.ts";

interface Variant { name: string; dir: string }
export interface Case { prompt: string; cwd: string }
export interface Row { case: number; variant: string; session: string; cost: number; scores: Record<string, number> }
export interface Options {
  variants: Variant[];
  cases: Case[];
  /** Runs of each case per variant; else 3. */
  runs?: number;
  cmd?: string;
  /** Langfuse to post the scores to; null posts none. */
  cfg: LangfuseConfig | null;
  /** The order of the outputs' indexes the judge sees; else random. */
  shuffle?: (indexes: number[]) => number[];
}

const JUDGE_SCHEMA = {
  type: "object",
  properties: { scores: { type: "array", items: { type: "object", properties: { label: { type: "string" }, scores: { type: "object", additionalProperties: { type: "number" } } }, required: ["label", "scores"] } } },
  required: ["scores"],
};

const fisherYates = (xs: number[]): number[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};

/** The judge's prompt for `outputs` under labels `O1…`; `order[k]` is the index of the output that `O${k + 1}` labels. */
export function blind(task: string, outputs: string[], shuffle = fisherYates): { prompt: string; order: number[] } {
  const order = shuffle(outputs.map((_, i) => i));
  const parts = order.map((at, k) => `## O${k + 1}\n${outputs[at]}`);
  const prompt = `Compare anonymous outputs for one task. Score each output from 1 to 10 on \`quality\` and on \`instruction-following\`. Give every label a score for each.\n\n## Task\n${task}\n\n${parts.join("\n\n")}`;
  return { prompt, order };
}

/** The judge's scores by output index: its answer is scored on the labels of `order`. */
export function unblind(answer: { scores: { label: string; scores: Record<string, number> }[] }, order: number[]): Map<number, Record<string, number>> {
  return new Map(answer.scores.map(({ label, scores }) => {
    const at = order[Number(label.slice(1)) - 1];
    if (at === undefined) throw new Error(`the judge scored a label that does not exist: ${label}`);
    return [at, scores];
  }));
}

/** One `claude -p --output-format json` call: its parsed result event. */
async function claude(cmd: string, flags: string[], prompt: string, cwd: string): Promise<any> {
  const p = Bun.spawn([cmd, "-p", "--output-format", "json", ...flags], {
    cwd, env: subscriptionEnv(), stdin: new Response(prompt), stdout: "pipe", stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${cmd} exited ${code}: ${err.slice(0, 300)}`);
  return JSON.parse(out);
}

export async function runAb(o: Options): Promise<Row[]> {
  const cmd = o.cmd ?? "claude";
  const rows: Row[] = [];
  for (const [n, c] of o.cases.entries()) {
    const runs: { variant: Variant; session: string; cost: number; text: string }[] = [];
    for (const variant of o.variants) {
      for (let i = 0; i < (o.runs ?? 3); i++) {
        const r = await claude(cmd, ["--plugin-dir", variant.dir], c.prompt, c.cwd);
        runs.push({ variant, session: r.session_id, cost: r.total_cost_usd, text: r.result });
      }
    }
    const { prompt, order } = blind(c.prompt, runs.map((r) => r.text), o.shuffle);
    const judged = unblind((await claude(cmd, ["--tools", "", "--json-schema", JSON.stringify(JUDGE_SCHEMA)], prompt, tmpdir())).structured_output, order);
    for (const [i, r] of runs.entries()) {
      const scores = judged.get(i) ?? {};
      rows.push({ case: n + 1, variant: r.variant.name, session: r.session, cost: r.cost, scores });
      if (!o.cfg) continue;
      for (const [name, value] of Object.entries({ ...scores, cost: r.cost })) {
        const res = await postScore(o.cfg, { sessionId: r.session, name, value, comment: `ab ${r.variant.name} case ${n + 1}` });
        if (!res.ok) console.error(`score ${name} on ${r.session}: ${res.error ?? res.status}`);
      }
    }
  }
  return rows;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { variant: { type: "string", multiple: true }, cases: { type: "string" }, runs: { type: "string" } } });
  const variants = (values.variant ?? []).map((v) => { const [name, ...dir] = v.split("="); return { name, dir: dir.join("=") }; });
  if (variants.length < 2 || variants.some((v) => !v.dir) || !values.cases) {
    console.error("usage: bun evals/ab.ts --variant name=dir --variant name=dir [...] --cases cases.json [--runs 3]");
    process.exit(2);
  }
  const rows = await runAb({ variants, cases: JSON.parse(readFileSync(values.cases, "utf8")), runs: values.runs ? Number(values.runs) : undefined, cfg: langfuseConfig() });
  console.log(JSON.stringify(rows, null, 2));
}
