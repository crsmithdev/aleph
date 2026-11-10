/**
 * The updater: the one owner of the UI server's derived data, and the one sender of `change`.
 *
 * A key is a GET route's path and its sorted query (`/api/flow?baseline=1&window=week`); its value is that route's
 * answer, built in the build Worker (ui/build.ts). A build records the sources it read (jobs/lib/infra/sources.ts).
 * When a source changes, the updater builds again each kept key that read it, keeps the new answers (the old ones
 * are served until then), and only then sends `change` with the keys whose answer or mark changed.
 *
 * - Kept: a key asked for in the last 10 min is built again on each change and poll. An older one is only marked
 *   dirty, and its next request waits for a build. A key not asked for in 1 h is dropped.
 * - A failed build keeps the last answer and marks the key `{ error, since }`; `change` goes out when a key enters
 *   and when it leaves that state. A failed fetch of the work store marks every key that reads the store.
 * - The skills folder is watched: a skill folder added or removed, or a SKILL.md written, rebuilds the keys that read the skills.
 * - Langfuse is polled every 30 s (2 min for skills) while a key that reads it is kept; the work store is fetched
 *   every 30 s while a key that reads it is kept.
 * - The keys are saved to `<aleph>/ui/keys.json`; a restart builds them again at once, and requests share the builds.
 * - Every POST that succeeds counts as a change of the source `action`, which every key reads: an action can write
 *   what no watcher sees (a systemd timer).
 */
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";
import { factoryDir } from "../jobs/lib/gates/factory-status.ts";
import { eventsDir, layout } from "../jobs/lib/infra/layout.ts";
import { expand } from "../jobs/lib/records/ledger.ts";
import { recordsDir } from "../jobs/lib/records/record.ts";
import { handoffsDir, reposFile, skillsDir, vaultDir } from "../jobs/lib/infra/settings.ts";
import { episodesDir } from "../jobs/lib/learning/episode.ts";
import { file as annotationsFile } from "../lib/annotations.ts";
import { fetchStore } from "../issues/lib/store.ts";
import { build as workerBuild, onLater, type Answer, type Built } from "./build.ts";

export const SETTLE_MS = 500, KEEP_MS = 10 * 60_000, DROP_MS = 60 * 60_000;
export const POLL_MS = 30_000, SKILLS_EVERY = 4, FETCH_MS = 30_000, SWEEP_MS = 60_000;

/** The GET routes whose answers the updater keeps. */
export const KEYED = new Set([
  "/api/factory", "/api/flow", "/api/automation", "/api/issues", "/api/issues/:id", "/api/issues/:id/jobs", "/api/jobs", "/api/jobs/:id",
  "/api/sessions", "/api/skills/:name", "/api/sessions/:id", "/api/sessions/:id/chat", "/api/sessions/:id/turns/:n",
  "/api/memory", "/api/memory/search", "/api/memory/notes/:title", "/api/memory/files/:source/:key",
]);

/** The key of a request: its path and its non-empty query parameters, sorted. */
export function keyOf(url: URL): string {
  const q = [...url.searchParams].filter(([, v]) => v !== "").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return q.length ? `${url.pathname}?${new URLSearchParams(q)}` : url.pathname;
}

/** A key's answer and, while its last build failed, why and since when (ISO). */
export interface Got { answer: Answer; error?: string; since?: string }
type Mark = { error: string; since: string };

interface Slot { asked: number; answer?: Answer; hash?: bigint | number; sources: Set<string>; error?: string; since?: string; /** Changes the answer may lack, and how many of them came before the start of the last build that ended. */ marked?: number; built?: number; again?: boolean; building?: Promise<void> }

export interface Deps {
  build: (key: string, gens: Record<string, number>) => Promise<Built>;
  now?: () => number;
  /** Where the kept keys are saved; null: nowhere. */
  file?: () => string | null;
  /** Fetch the work store: the error, or null. */
  fetch?: () => Promise<string | null>;
}

const isSkills = (key: string) => key.startsWith("/api/skills/");
/** Why a 5xx answer failed: its `error`, else its text, else its status. */
const errorOf = (a: Answer) => {
  const b = a.body as { error?: unknown } | string | null;
  return (typeof b === "string" ? b : b?.error !== undefined ? String(b.error) : "") || `answered ${a.status}`;
};

export function createUpdater({ build, now = Date.now, file = () => null, fetch = async () => null }: Deps) {
  const slots = new Map<string, Slot>();
  const gens: Record<string, number> = {};
  const pending = new Set<string>();
  const listeners: ((keys: string[]) => void)[] = [];
  let fetchError: Mark | null = null;
  let settle: Timer | undefined, polls = 0, saved = "";

  const iso = () => new Date(now()).toISOString();
  const kept = (s: Slot) => now() - s.asked < KEEP_MS;
  const markOf = (s: Slot): Mark | null => (s.error ? { error: s.error, since: s.since! } : fetchError && s.sources.has("store") ? fetchError : null);
  const sig = (s: Slot) => `${s.hash}|${markOf(s) ? 1 : 0}`;
  const keysWith = (pick: (key: string, s: Slot) => boolean) => [...slots].filter(([k, s]) => pick(k, s)).map(([k]) => k);
  const bump = (source: string) => { gens[source] = (gens[source] ?? 0) + 1; };
  // A mark is cleared only by a build that started after it: an iteration already running read the sources before the change.
  const mark = (s: Slot) => { s.marked = (s.marked ?? 0) + 1; };
  const dirty = (s: Slot) => (s.marked ?? 0) > (s.built ?? 0);
  // A kept key mid-build builds once more; any other key waits for its next request. Rebuilding a key nobody asks
  // for kept a 30-day Sessions build running back to back, each poll ending in another.
  const due = (s: Slot) => { if (!kept(s)) mark(s); else if (s.building) s.again = true; };

  function save(): void {
    const f = file(), text = JSON.stringify(Object.fromEntries([...slots].map(([k, s]) => [k, s.asked])));
    if (!f || text === saved) return;
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
    saved = text;
  }

  function fail(s: Slot, error: string): void {
    s.error = error;
    s.since ??= iso();
  }

  /** Build `key` again; a change during the build builds it once more after. */
  function run(key: string, s: Slot): Promise<void> {
    if (s.building) { s.again = true; return s.building; }
    s.building = (async () => {
      do {
        s.again = false;
        const marks = s.marked ?? 0;
        try {
          const { answer, sources } = await build(key, { ...gens });
          s.sources = new Set([...sources, "action"]);
          if (answer.status >= 500) fail(s, errorOf(answer));
          else Object.assign(s, { answer, hash: Bun.hash(JSON.stringify(answer)), error: undefined, since: undefined });
        } catch (e) {
          fail(s, e instanceof Error ? e.message : String(e));
        }
        s.built = marks;
      } while (s.again);
      s.building = undefined;
    })();
    return s.building;
  }

  const signal = (keys: string[]) => { if (keys.length) for (const f of listeners) f(keys); };

  /** Build `keys` again, and signal each one whose answer or mark changed as soon as its own build ends:
   * a fast key does not wait for a slow one. */
  async function refresh(keys: string[]): Promise<void> {
    await Promise.all(keys.map(async (k) => {
      const before = sig(slots.get(k)!);
      await run(k, slots.get(k)!);
      if (slots.has(k) && sig(slots.get(k)!) !== before) signal([k]);
    }));
  }

  /** `source` changed: an idle key that read it waits for a build at its next request. */
  function stale(source: string): void {
    bump(source);
    for (const s of slots.values()) if (s.sources.has(source)) due(s);
  }

  /** Build the kept keys that read a source changed since the last flush, then signal. */
  async function flush(): Promise<void> {
    const sources = new Set(pending);
    pending.clear();
    await refresh(keysWith((_, s) => kept(s) && [...s.sources].some((x) => sources.has(x))));
  }

  return {
    gens,
    flush,
    /** The answer of `key`: the kept one, or a build's when the key is new, failed or dirty. */
    async get(key: string): Promise<Got> {
      let s = slots.get(key);
      if (!s) { slots.set(key, (s = { asked: now(), sources: new Set() })); save(); }
      s.asked = now();
      if (!s.answer || dirty(s)) await (s.building ?? run(key, s));
      if (!s.answer) return { answer: { status: 502, body: { error: s.error } } };
      const m = markOf(s);
      return m ? { answer: s.answer, ...m } : { answer: s.answer };
    },
    /** `source` changed: after `SETTLE_MS` of quiet, build the kept keys that read it. After an action every key's
     * next request waits for its build: the page that acted reads the result of its own action. */
    changed(source: string): void {
      stale(source);
      // The notes are not a kept key: the page reads them from a plain route and needs only the signal.
      if (source === "annotations") signal(["/api/annotations"]);
      // A key mid-build is marked too: stale() makes its build run once more, and the request waits for that run.
      if (source === "action") for (const s of slots.values()) mark(s);
      pending.add(source);
      settle ??= setTimeout(() => { settle = undefined; void flush(); }, SETTLE_MS);
    },
    /** One Langfuse poll: every key that reads it is due (skills every `SKILLS_EVERY` polls); the kept ones are built again. */
    async poll(): Promise<void> {
      const all = ++polls % SKILLS_EVERY === 0;
      const keys = keysWith((k, s) => s.sources.has("langfuse") && (all || !isSkills(k)));
      if (!keys.length) return;
      bump("langfuse");
      for (const k of keys) due(slots.get(k)!);
      await refresh(keys.filter((k) => kept(slots.get(k)!)));
    },
    /** One fetch of the work store while a kept key reads it; a failure marks those keys until a fetch works. */
    async fetchStore(): Promise<void> {
      const keys = keysWith((_, s) => kept(s) && s.sources.has("store"));
      if (!keys.length) return;
      const error = await fetch(), was = fetchError;
      fetchError = error ? { error, since: fetchError?.since ?? iso() } : null;
      if (!was !== !fetchError) signal(keys);
    },
    /** Drop the keys not asked for in `DROP_MS`, and save the kept set. */
    sweep(): void {
      for (const [k, s] of slots) if (now() - s.asked >= DROP_MS && !s.building) slots.delete(k);
      save();
    },
    /** Build again every key saved by the last process, without waiting. */
    restore(): void {
      const f = file();
      if (!f || !existsSync(f)) return;
      let saved: Record<string, number> = {};
      try { saved = JSON.parse(readFileSync(f, "utf8")); } catch { return; }
      for (const [k, asked] of Object.entries(saved)) {
        if (now() - asked >= DROP_MS || slots.has(k)) continue;
        const s: Slot = { asked, sources: new Set() };
        slots.set(k, s);
        void run(k, s);
      }
    },
    onChange(f: (keys: string[]) => void): void { listeners.push(f); },
    /** Forget every key and change (a test's fresh start). */
    reset(): void {
      slots.clear();
      pending.clear();
      for (const k of Object.keys(gens)) delete gens[k];
      fetchError = null;
      clearTimeout(settle);
      settle = undefined;
      polls = 0;
      saved = "";
    },
  };
}

export type Updater = ReturnType<typeof createUpdater>;

/** The UI server's updater: the build Worker, `<aleph>/ui/keys.json` and the work store's origin. */
export const updater = createUpdater({ build: workerBuild, file: () => join(dirname(layout().factory), "ui", "keys.json"), fetch: () => fetchStore() });
onLater((source) => updater.changed(source));

/** The answer of the keyed route at `url`, with `x-aleph-keys` and, on an object body, the mark of a failed build. */
export async function respond(url: URL): Promise<Response> {
  const key = keyOf(url), got = await updater.get(key), { answer } = got;
  const headers = new Headers({ "x-aleph-keys": key });
  if (got.error) {
    headers.set("x-aleph-error", got.error.replace(/\s+/g, " ").slice(0, 500));
    headers.set("x-aleph-since", got.since!);
  }
  if (answer.text) return new Response(String(answer.body), { status: answer.status, headers });
  const marked = got.error && answer.body && typeof answer.body === "object" && !Array.isArray(answer.body);
  return Response.json(marked ? { ...(answer.body as object), error: got.error, since: got.since } : answer.body, { status: answer.status, headers });
}

let stops: (() => void)[] = [];
/** Files of the event log that grew, for the `ev` stream (ui/api/events.ts). */
export const eventFiles: ((file: string) => void)[] = [];

function follow(dir: string, counts: (file: string) => boolean, source: string, recursive = false): void {
  if (!existsSync(dir)) return;
  let w: FSWatcher;
  try { w = watch(dir, { recursive }, (_e, f) => { if (f && counts(String(f))) updater.changed(source); }); }
  catch (e) { console.error(`ui/updater: cannot watch ${dir}: ${(e as Error).message}`); return; }
  w.on("error", (e) => console.error(`ui/updater: watch of ${dir} failed: ${e.message}`));
  stops.push(() => w.close());
}

/** A job record counts; its temporary file does not, as the rename that puts it in place does. */
export const countsInRecords = (file: string): boolean => file.endsWith(".json");
/** The logs change on every line of output and the page does not show them; a temporary file is renamed into place, and the rename counts. */
export const countsInFactory = (file: string): boolean => !file.endsWith(".log") && !file.endsWith(".tmp");

/** A skill folder added or removed, or its SKILL.md written: Memory reads each SKILL.md. */
export const countsInSkills = (file: string): boolean => !file.includes("/") || /^[^/]+\/SKILL\.md$/.test(file);

/** A note, a daily note, MEMORY.md or the recall log counts; git, the search index and Obsidian's settings do not. */
export const countsInVault = (file: string): boolean => !/^\.(git|index|obsidian)(\/|$)/.test(file) && (file.endsWith(".md") || /^\.recall(-log)?\.json(l)?$/.test(file));

/** Watch the sources, poll Langfuse, fetch the store and sweep the keys until `stopUpdater`; with `restore`, build the saved keys. */
export function startUpdater({ restore = true }: { restore?: boolean } = {}): void {
  if (stops.length) return;
  const repos = expand(reposFile());
  mkdirSync(recordsDir(), { recursive: true });
  mkdirSync(eventsDir(), { recursive: true });
  follow(recordsDir(), countsInRecords, "records");
  follow(factoryDir(), countsInFactory, "factory");
  // Each issue write moves this ref; the builds read the issues from it.
  follow(join(layout().store, ".git", "refs", "remotes", "origin"), (f) => f === "main", "store");
  follow(dirname(repos), (f) => f === basename(repos), "registry");
  follow(skillsDir(), countsInSkills, "skills", true);
  follow(eventsDir(), (f) => {
    if (!f.endsWith(".jsonl")) return false;
    for (const tail of eventFiles) tail(f);
    return true;
  }, "events");
  follow(vaultDir(), countsInVault, "vault", true);
  follow(handoffsDir(), (f) => f.endsWith(".md"), "handoffs", true);
  mkdirSync(dirname(annotationsFile()), { recursive: true });
  follow(dirname(annotationsFile()), (f) => f === basename(annotationsFile()), "annotations");
  follow(episodesDir(), (f) => f.endsWith(".md"), "episodes");
  const every = (ms: number, f: () => unknown) => { const t = setInterval(f, ms); t.unref?.(); stops.push(() => clearInterval(t)); };
  every(POLL_MS, () => updater.poll());
  every(FETCH_MS, () => updater.fetchStore());
  every(SWEEP_MS, () => updater.sweep());
  if (restore) updater.restore();
}

/** Stop the watchers and timers, and forget every key. */
export function stopUpdater(): void {
  for (const f of stops) f();
  stops = [];
  updater.reset();
}
