/**
 * A `claude -p` reply as a JSON value: `--json-schema` makes the agent end with a value that the schema
 * validates, and the stream's `result` event carries it as `structured_output`. A top-level schema must be
 * `"type": "object"` with no top-level `oneOf`, `anyOf` or `allOf`: the API refuses those.
 */

/** The flags that ask for a reply that `schema` validates. */
export const schemaFlags = (schema: object): string[] => ["--json-schema", JSON.stringify(schema)];

/** The `structured_output` of the last `result` event of a stream-json stdout, or undefined when there is none. */
export function structuredOf(stdout: string): unknown {
  for (const line of stdout.trimEnd().split("\n").reverse()) {
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === "result") return ev.structured_output ?? undefined;
  }
  return undefined;
}

/** The `session_id` of the last `result` event of a stream-json stdout, or undefined: `--resume` takes it. */
export function sessionOf(stdout: string): string | undefined {
  for (const line of stdout.trimEnd().split("\n").reverse()) {
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === "result") return typeof ev.session_id === "string" ? ev.session_id : undefined;
  }
  return undefined;
}

/** The reason a parser gives when the reply has no structured output. */
export const NO_OUTPUT = "no structured output";
