/**
 * The updater: the one owner of the UI server's derived data, and the one sender of `change`.
 *
 * A key is a GET route's path and its sorted query (`/api/flow?baseline=1&window=week`); its value is that route's
 * answer, built in the build Worker (ui/build.ts). A build records the sources it read (lib/sources.ts).
 * When a source changes, the updater builds again each kept key that read it, keeps the new answers (the old ones
 * are served until then), and only then sends `change` with the keys whose answer or mark changed.
 *
 * - Kept: a key asked for in the last 10 min is built again on each change and poll. An older one is only marked
 *   dirty, and its next request waits for a build; for a Sessions or Skills key that has an answer, the request gets
 *   that answer with a mark `{ error, since }` while a rebuild runs, and `change` names the key when it ends. A key not asked for in 1 h is dropped.
 *   A Sessions or Skills key's last good answer is also saved to `<aleph>/ui/answers/`; with none in memory (a restart, the drop) a request gets the saved one the same way.
 * - A failed build keeps the last answer and marks the key `{ error, since }`; `change` goes out when a key enters
 *   and when it leaves that state. A failed fetch of the work store marks every key that reads the store.
 * - `aleph.db` is polled for `PRAGMA data_version` every 100 ms; a new event row sends the `ev` rows and changes the source `events`.
 * - The annotations file is watched: a note written by the page or by `shelf note --file` sends `change` for
 *   /api/annotations at once. That route is not kept; the page reads it whole.
 * - The skills folder is watched: a skill folder added or removed, or a SKILL.md written, rebuilds the keys that read the skills.
 * - Langfuse is polled every 30 s (2 min for skills) while a key that reads it is kept; the work store is fetched
 *   every 30 s while a key that reads it is kept.
 * - The keys are saved to `<aleph>/ui/keys.json`; a restart builds them again at once, and requests share the builds.
 * - The status verdict is checked every 30 s; a new tone or text logs a `status` event (ui/state.ts `checkStatus`).
 * - Every POST that succeeds counts as a change of the source `action`, which every key reads: an action can write
 *   what no watcher sees (a systemd timer).
 */
import { Database } from "bun:sqlite";
import { readJsonOr, writeJson } from "../lib/json.ts";
import { existsSync, mkdirSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";
import { conn, dbFile } from "../lib/db.ts";
import { factoryDir, layout, lastSeq } from "../lib/layout.ts";
import { skillsDir } from "../jobs/lib/infra/settings.ts";
import { annotationsFile, handoffsDir, vaultDir } from "../lib/paths.ts";
import { fetchStore, registryDir, storeRefDir } from "../lib/store.ts";
import { build as workerBuild, onLater, type Answer, type Built } from "./build.ts";
import { errText } from "../lib/errtext.ts";
import { checkStatus, logOnce } from "./state.ts";

const SETTLE_MS = 500;
export const KEEP_MS = 10 * 60_000, DROP_MS = 60 * 60_000;
const POLL_MS = 30_000, DATA_VERSION_MS = 100;
const SKILLS_EVERY = 4, FETCH_MS = 30_000, SWEEP_MS = 60_000;

/** The GET routes whose answers the updater keeps. */
export const KEYED = new Set([
  "/api/factory", "/api/status", "/api/flow", "/api/automation", "/api/issues", "/api/issues/:id", "/api/jobs", "/api/jobs/:id",
  "/api/sessions", "/api/skills/:name", "/api/sessions/:id", "/api/sessions/:id/chat", "/api/sessions/:id/turns/:n",
  "/api/memory", "/api/memory/log", "/api/memory/processes", "/api/memory/search", "/api/memory/notes/:title", "/api/memory/files/:source/:key", "/api/context",
  "/api/hooks", "/api/hooks/:event/:name",
]);

/** The key of a request: its path and its non-empty query parameters, sorted. */
export function keyOf(url: URL): string {
  const q = [...url.searchParams].filter(([, v]) => v !== "").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return q.length ? `${url.pathname}?${new URLSearchParams(q)}` : url.pathname;
}

/** A key's answer and, while its last build failed, why and since when (ISO). */
interface Got { answer: Answer; error?: string; since?: string }
type Mark = { error: string; since: string };

interface Slot { asked: number; answer?: Answer; hash?: bigint | number; sources: Set<string>; error?: string; since?: string; /** When the answer was built, and while an old answer is served over its rebuild, why. */ at?: string; note?: string; /** Changes the answer may lack, and how many of them came before the start of the last build that ended. */ marked?: number; built?: number; again?: boolean; building?: Promise<void> }

interface Deps {
  build: (key: string, gens: Record<string, number>) => Promise<Built>;
  now?: () => number;
  /** Where the kept keys are saved; null: nowhere. */
  file?: () => string | null;
  /** Fetch the work store: the error, or null. */
  fetch?: () => Promise<string | null>;
}

const isSkills = (key: string) => key.startsWith("/api/skills/");
/** The keys that read Langfuse: a rebuild can take minutes, so a due key serves its last answer meanwhile. */
const readsLangfuse = (key: string) => key.startsWith("/api/sessions") || isSkills(key);
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
  const markOf = (s: Slot): Mark | null => (s.error ? { error: s.error, since: s.since! } : s.note ? { error: s.note, since: s.at! } : fetchError && s.sources.has("store") ? fetchError : null);
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

  /** Where a Langfuse key's last good answer is kept: beside the key set, one file per key. */
  const answerFile = (key: string) => { const f = file(); return f ? join(dirname(f), "answers", `${Bun.hash(key).toString(16)}.json`) : null; };

  /** A Langfuse key with no answer in memory takes its saved one, due for a rebuild: the request gets it at once. */
  function load(key: string, s: Slot): void {
    const f = answerFile(key);
    if (s.answer || !f || !readsLangfuse(key)) return;
    const old = readJsonOr<{ answer: Answer; at: string } | null>(f, null);
    if (old) { Object.assign(s, old, { hash: Bun.hash(JSON.stringify(old.answer)) }); mark(s); }
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
          else {
            Object.assign(s, { answer, hash: Bun.hash(JSON.stringify(answer)), error: undefined, since: undefined, at: iso() });
            const f = answerFile(key);
            if (f && readsLangfuse(key)) writeJson(f, { answer, at: s.at });
          }
        } catch (e) {
          fail(s, errText(e));
        }
        s.built = marks;
      } while (s.again);
      s.note = undefined;
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
      load(key, s);
      if (s.answer && dirty(s) && readsLangfuse(key)) {
        if (!s.note) {
          s.note = "a rebuild runs; this is the last answer";
          // The note goes when the rebuild ends, so `change` goes out then even when the answer and mark look the same.
          void (s.building ?? run(key, s)).then(() => { if (slots.has(key)) signal([key]); });
        }
      } else if (!s.answer || dirty(s)) await (s.building ?? run(key, s));
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
      const saved = readJsonOr<Record<string, number>>(f, {});
      for (const [k, asked] of Object.entries(saved)) {
        if (now() - asked >= DROP_MS || slots.has(k)) continue;
        const s: Slot = { asked, sources: new Set() };
        slots.set(k, s);
        load(k, s);
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
/** Readers of the events a write added, for the `ev` stream (ui/api/events.ts). */
export const eventTails: (() => void)[] = [];

function follow(dir: string, counts: (file: string) => boolean, source: string, recursive = false): void {
  if (!existsSync(dir)) return;
  let w: FSWatcher;
  try { w = watch(dir, { recursive }, (_e, f) => { if (f && counts(String(f))) updater.changed(source); }); }
  catch (e) { console.error(`ui/updater: cannot watch ${dir}: ${(e as Error).message}`); return; }
  w.on("error", (e) => console.error(`ui/updater: watch of ${dir} failed: ${e.message}`));
  stops.push(() => w.close());
}

/**
 * `data_version` moves when another connection commits: the CLI, a job, or this process's own writes, which go through the
 * other connection of lib/db.ts. When it moves and an event row is new, the `ev` stream sends the rows and the source `events` changes.
 * A write that logs no event (usage, tick, a job row) waits for the quiet refresh timer.
 */
function followEvents(): void {
  conn();
  const db = new Database(dbFile(), { readonly: true });
  const version = db.query("PRAGMA data_version"), newest = db.query("SELECT coalesce(max(seq), 0) AS n FROM events");
  let seen = (version.get() as { data_version: number }).data_version, last = lastSeq();
  const t = setInterval(() => {
    const v = (version.get() as { data_version: number }).data_version;
    if (v === seen) return;
    seen = v;
    const n = (newest.get() as { n: number }).n;
    if (n === last) return;
    last = n;
    for (const tail of eventTails) tail();
    updater.changed("events");
  }, DATA_VERSION_MS);
  t.unref?.();
  stops.push(() => { clearInterval(t); db.close(); });
}

/** The logs change on every line of output and the page does not show them; a temporary file is renamed into place, and the rename counts. */
export const countsInFactory = (file: string): boolean => !file.endsWith(".log") && !file.endsWith(".tmp");

/** A skill folder added or removed, or its SKILL.md written: Memory reads each SKILL.md. */
export const countsInSkills = (file: string): boolean => !file.includes("/") || /^[^/]+\/SKILL\.md$/.test(file);

/** A note, a daily note, MEMORY.md or the recall log counts; git, the search index and Obsidian's settings do not. */
const countsInVault = (file: string): boolean => !/^\.(git|index|obsidian)(\/|$)/.test(file) && (file.endsWith(".md") || /^\.recall(-log)?\.json(l)?$/.test(file));

/** Watch the sources, poll Langfuse, fetch the store and sweep the keys until `stopUpdater`; with `restore`, build the saved keys. */
export function startUpdater({ restore = true }: { restore?: boolean } = {}): void {
  if (stops.length) return;
  mkdirSync(dirname(dbFile()), { recursive: true });
  follow(factoryDir(), countsInFactory, "factory");
  // Each issue write moves this ref; the builds read the issues from it.
  follow(storeRefDir(), (f) => f === "main", "store");
  follow(registryDir(), (f) => f.endsWith("project.md"), "registry", true);
  follow(skillsDir(), countsInSkills, "skills", true);
  followEvents();
  follow(vaultDir(), countsInVault, "vault", true);
  follow(handoffsDir(), (f) => f.endsWith(".md"), "handoffs", true);
  // The file is renamed into place: the rename counts, the temporary file does not.
  const notes = annotationsFile();
  mkdirSync(dirname(notes), { recursive: true });
  follow(dirname(notes), (f) => f === basename(notes), "annotations");
  const every = (ms: number, f: () => unknown) => { const t = setInterval(f, ms); t.unref?.(); stops.push(() => clearInterval(t)); };
  every(POLL_MS, () => updater.poll());
  // No watcher: ~/.claude/projects holds thousands of folders. The sessions of /api/context are due every poll instead.
  every(POLL_MS, () => updater.changed("transcripts"));
  every(FETCH_MS, () => updater.fetchStore());
  every(SWEEP_MS, () => updater.sweep());
  // No page need be open: a red CI is logged as a status event all the same. A throw in a timer would end the server.
  every(POLL_MS, () => { try { checkStatus(); } catch (e) { logOnce("status", e); } });
  if (restore) updater.restore();
}

/** Stop the watchers and timers, and forget every key. */
export function stopUpdater(): void {
  for (const f of stops) f();
  stops = [];
  updater.reset();
}
