/**
 * The shape of each GET route's answer, checked by ui/schemas.test.ts. A schema is a type name, `[item]` for an
 * array, or `{ key: schema }` for an object; `"*"` as a key is the schema of every value of a map. A type name is
 * string, number, boolean, object, array, any, or time (an ISO 8601 UTC time); `a|b` is either, and a final `?` also allows null. A key
 * with a final `?` may be absent. An answer's top level has only the keys of its schema, and `error` and `since`,
 * the mark of a key that failed to rebuild. A route whose answer is not JSON has the schema "text".
 */
export type Schema = string | Schema[] | { [key: string]: Schema };

const job = { id: "string", name: "string", repo: "string", condition: "string", started: "time?", run: "object" };
const row = { id: "string", subject: "string", name: "string", repo: "string", kind: "string", actor: "string?", state: "string", title: "string?", issue: "string?", started: "time", ended: "time?", seconds: "number?", cost: "number?", model: "string?" };
const issue = { id: "number", ref: "string", repo: "string", title: "string", href: "string", kind: "string", status: "string", priority: "string", stage: "string", createdTime: "string?" };
const turn = { n: "number", traceId: "string", start: "time", seconds: "number?", cost: "number" };

export const SCHEMAS: Record<string, Schema | "text"> = {
  "/api/factory": {
    now: "time", factory: { paused: "boolean", liveCap: "number", liveRuns: "number", runCap: "number", runStarts: "number", nextTick: "time?" },
    herald: { history: [{ at: "time", tone: "string", text: "string" }], events: [{ at: "time", subject: "string", action: "string" }], titles: { "*": "string" } },
    done: [{ id: "string", title: "string", href: "string", finished: "string", jobs: "array" }], doneCount: "number",
    stuck: [job], running: [job], runningIssues: "array",
    queued: [{ repo: "string", id: "number|string", title: "string", stage: "string", kind: "string" }],
    usage: "object?", proposals: "array",
  },
  "/api/automation": {
    now: "time", capEnv: { "*": "boolean" }, settings: { "*": "number?" }, metrics: { days: "number", rate: "object?", catches: "object", held: "object" },
    schedules: [{ name: "string", every: "string?" }], monitor: "object?", backend: "object?", gated: "object?", baseline: "array",
    asks: [{ key: "string", kind: "string", card: "string", label: "string", id: "string", title: "string", at: "string" }], rules: [{ reason: "string", name: "string", line: "string", mode: "string" }],
    repeats: [{ reason: "string", name: "string", answer: "string" }], held: ["string"], repoHeld: "array", log: { days: "number", max: "number", entries: "array" },
  },
  "/api/flow": {
    window: "string", done: "number", kinds: "object", phases: "object", asks: { count: "number", manual: "number" }, checks: "array",
    buckets: [{ at: "time", runs: "number" }], times: [{ id: "string", href: "string", outcome: "string", filed: "time?" }], slowest: "array",
    stages: "object", models: "array", issues: "object", classes: "array", notCounted: "any", lost: "any", hasWeek: "boolean", agents: "any",
    flaky: "number", flakes: "any", "baseline?": "any",
  },
  "/api/issues": { issues: [{ ...issue, runs: "number", cost: "number" }], projects: ["string"], tests: { "*": "array" } },
  "/api/issues/:id": {
    ...issue, labels: "array", after: "array", "created?": "string", "closed?": "string", "closedTime?": "string", "source?": "string", "updated?": "string", "updatedTime?": "string",
    notes: "array", "parent?": "any", "why?": "string", blockers: "array", "ask?": "object", request: "string?", spec: "string?", goals: "array", "issue?": "object",
    media: "array", frontmatter: "object", derived: "object", jobs: [{ id: "string", name: "string", condition: "string" }],
    timeline: { filed: "time?", runs: [{ kind: "string", started: "time", ended: "time?" }] }, holds: "array", commits: "array", specs: ["string"],
  },
  "/api/issues/:id/jobs": { jobs: [row] },
  "/api/issues/:id/media/:name": "text",
  "/api/jobs": { jobs: [row], next: "time?" },
  "/api/jobs/:id": {
    ...job, "item?": "object?", "ended?": "time", "model?": "string", defaults: "array", followups: "array", runs: [{ id: "string", kind: "string", condition: "string", started: "time" }],
    holds: "array", "next?": "object", "rounds?": "number", events: "array", "spec?": "string", "*": "any",
  },
  "/api/jobs/:id/diff": "text",
  "/api/jobs/:id/logs/:file": "text",
  "/api/projects": { "*": "string?" },
  "/api/models": { tiers: { "*": { enabled: "boolean", model: "string" } }, offers: { "*": ["string"] }, down: ["string"], local: "string", spend: "object?" },
  "/api/sessions": {
    window: "number", project: "string?", partial: "boolean", activity: { days: ["string"], langfuse: "string", tools: "array", hooks: "array" },
    skills: "object", sessions: "object", toolSessions: { "*": ["string"] },
  },
  "/api/sessions/:id": { base: "string", id: "string", "label?": "string", project: "string", taskTypes: ["string"], turns: [turn] },
  "/api/sessions/:id/chat": { base: "string", id: "string", "label?": "string", project: "string", taskTypes: ["string"], total: "number", from: "number", turns: [turn] },
  "/api/sessions/:id/turns/:n": {
    "wk?": "any", base: "string", id: "string", "label?": "string", n: "number", total: "number", traceId: "string", project: "string", start: "time",
    prompt: "string", output: "string", cost: "number", seconds: "number?", observations: "array",
  },
  "/api/annotations": "array",
  "/api/skills/:name": { name: "string", days: "number", since: "string", asOf: "time", "failed?": "string", uses: "number", perDay: "array", projects: "array", sessions: "array", tools: "array", errors: "array" },
  "/api/specs/:project/:file": { project: "string", file: "string", date: "string", title: "string", body: "string" },
  "/api/memory": {
    project: "string?", exists: "boolean", total: "number", byKind: { "*": "number" }, byScope: { "*": "number" }, scopes: ["string"], home: "array",
    lint: "object", writes: "array", notes: "array", types: "object", "misses?": "any", "cachedAt?": "time",
  },
  "/api/memory/search": { q: "string", results: [{ type: "string", source: "string", key: "string", title: "string" }] },
  "/api/memory/notes/:title": "object",
  "/api/memory/files/:source/:key": "text",
  "/api/events": "text",
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const MARK = new Set(["error", "since"]);

function typeOk(type: string, v: unknown): boolean {
  if (type.endsWith("?")) return v === null || typeOk(type.slice(0, -1), v);
  if (type.includes("|")) return type.split("|").some((t) => typeOk(t, v));
  switch (type) {
    case "any": return true;
    case "array": return Array.isArray(v);
    case "object": return typeof v === "object" && v !== null && !Array.isArray(v);
    case "time": return typeof v === "string" && ISO.test(v);
    default: return typeof v === type;
  }
}

/** Where `v` breaks `s`, one line per break; none when it fits. */
export function check(s: Schema, v: unknown, at = "$", top = true): string[] {
  if (typeof s === "string") return typeOk(s, v) ? [] : [`${at}: ${JSON.stringify(v)?.slice(0, 60)} is not ${s}`];
  if (Array.isArray(s)) return Array.isArray(v) ? v.flatMap((x, i) => check(s[0], x, `${at}[${i}]`, false)) : [`${at}: not an array`];
  if (typeof v !== "object" || v === null || Array.isArray(v)) return [`${at}: not an object`];
  const o = v as Record<string, unknown>, keys = new Map(Object.keys(s).map((k) => [k.replace(/\?$/, ""), k]));
  const out = [...keys].flatMap(([k, raw]) => k === "*" ? [] : k in o ? check(s[raw], o[k], `${at}.${k}`, false) : raw.endsWith("?") ? [] : [`${at}.${k}: missing`]);
  for (const [k, x] of Object.entries(o)) {
    if (keys.has(k) || (top && MARK.has(k))) continue;
    if (s["*"] !== undefined) out.push(...check(s["*"], x, `${at}.${k}`, false));
    else if (top) out.push(`${at}.${k}: not in the schema`);
  }
  return out;
}

/** The paths of the numbers in `v` that look like epoch ms: times go as ISO strings. */
export function epochs(v: unknown, at = "$"): string[] {
  if (typeof v === "number") return v > 1e11 ? [at] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => epochs(x, `${at}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => epochs(x, `${at}.${k}`));
  return [];
}
