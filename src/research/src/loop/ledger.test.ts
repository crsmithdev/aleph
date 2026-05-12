import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../ddl';
import { inputHash, lookupOutput, recordEntry, listEntries, runOnce } from './ledger';

type Db = ReturnType<typeof newDb>;

function newDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite as unknown as Parameters<typeof applyResearchDDL>[0]);
  // The five new tables are added by the loop-engine DDL block.
  // Seed a loop + cycle so the FK-constrained inserts work below.
  sqlite.prepare("INSERT INTO loops (id, template_id, prompt) VALUES (?, ?, ?)").run('loop-1', 'noop', '');
  sqlite.prepare("INSERT INTO cycles (id, loop_id, idx) VALUES (?, ?, ?)").run('cycle-1', 'loop-1', 0);
  sqlite.prepare("INSERT INTO cycles (id, loop_id, idx) VALUES (?, ?, ?)").run('cycle-2', 'loop-1', 1);
  return sqlite;
}

describe('loop DDL', () => {
  let sqlite: Db;
  beforeEach(() => { sqlite = newDb(); });

  test('creates all five loop-engine tables', () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('loops','cycles','artifacts','cycle_ledger','milestones') ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map(t => t.name)).toEqual(['artifacts', 'cycle_ledger', 'cycles', 'loops', 'milestones']);
  });

  test('cascading delete: dropping a loop removes its cycles, artifacts, and ledger entries', () => {
    sqlite.prepare("INSERT INTO artifacts (id, loop_id, cycle_id, kind) VALUES (?, ?, ?, ?)").run('a-1', 'loop-1', 'cycle-1', 'noop_output');
    recordEntry(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input_hash: 'h1', output: { ok: true }, cost_usd: 0 });

    sqlite.prepare('DELETE FROM loops WHERE id = ?').run('loop-1');

    const cycles = sqlite.prepare("SELECT * FROM cycles WHERE loop_id = ?").all('loop-1');
    const artifacts = sqlite.prepare("SELECT * FROM artifacts WHERE loop_id = ?").all('loop-1');
    const ledger = sqlite.prepare("SELECT * FROM cycle_ledger WHERE loop_id = ?").all('loop-1');
    expect(cycles).toHaveLength(0);
    expect(artifacts).toHaveLength(0);
    expect(ledger).toHaveLength(0);
  });
});

describe('inputHash', () => {
  test('is stable across object key orderings', () => {
    const a = inputHash({ x: 1, y: 'a', nested: { p: true, q: [1, 2, 3] } });
    const b = inputHash({ nested: { q: [1, 2, 3], p: true }, y: 'a', x: 1 });
    expect(a).toBe(b);
  });

  test('changes when array order changes', () => {
    expect(inputHash([1, 2, 3])).not.toBe(inputHash([3, 2, 1]));
  });

  test('distinguishes null/undefined/false/0/empty', () => {
    const hashes = new Set([
      inputHash(null),
      inputHash(undefined),
      inputHash(false),
      inputHash(0),
      inputHash(''),
      inputHash({}),
      inputHash([]),
    ]);
    expect(hashes.size).toBe(7);
  });
});

describe('cycle ledger', () => {
  let sqlite: Db;
  beforeEach(() => { sqlite = newDb(); });

  test('lookupOutput returns null for an entry that does not exist', () => {
    expect(lookupOutput(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input_hash: 'nope' })).toBeNull();
  });

  test('recordEntry then lookupOutput round-trips', () => {
    recordEntry(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input_hash: 'h1', output: { result: 42 }, cost_usd: 0.001 });
    const got = lookupOutput(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input_hash: 'h1' });
    expect(got).toEqual({ output: { result: 42 }, cost_usd: 0.001 });
  });

  test('recordEntry is idempotent (re-recording the same key is a no-op)', () => {
    recordEntry(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input_hash: 'h1', output: { v: 1 }, cost_usd: 0.01 });
    recordEntry(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input_hash: 'h1', output: { v: 999 }, cost_usd: 9.99 });
    const got = lookupOutput(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input_hash: 'h1' });
    expect(got).toEqual({ output: { v: 1 }, cost_usd: 0.01 }); // first write wins
  });

  test('listEntries returns rows in record order', () => {
    recordEntry(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input_hash: 'h1', output: 1, cost_usd: 0 });
    recordEntry(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'derivation', input_hash: 'h2', output: 2, cost_usd: 0 });
    recordEntry(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-2', step: 'processor', input_hash: 'h3', output: 3, cost_usd: 0 });
    const entries = listEntries(sqlite as never, 'loop-1');
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.output)).toEqual([1, 2, 3]);
  });

  test('listEntries scopes by loop_id', () => {
    sqlite.prepare("INSERT INTO loops (id, template_id, prompt) VALUES (?, ?, ?)").run('loop-2', 'noop', '');
    sqlite.prepare("INSERT INTO cycles (id, loop_id, idx) VALUES (?, ?, ?)").run('cycle-x', 'loop-2', 0);
    recordEntry(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input_hash: 'h1', output: 'a', cost_usd: 0 });
    recordEntry(sqlite as never, { loop_id: 'loop-2', cycle_id: 'cycle-x', step: 'processor', input_hash: 'h2', output: 'b', cost_usd: 0 });
    expect(listEntries(sqlite as never, 'loop-1')).toHaveLength(1);
    expect(listEntries(sqlite as never, 'loop-2')).toHaveLength(1);
  });
});

describe('runOnce', () => {
  let sqlite: Db;
  beforeEach(() => { sqlite = newDb(); });

  test('runs the function once and records its output', async () => {
    let calls = 0;
    const result = await runOnce(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input: { q: 'why' } }, async () => {
      calls++;
      return { output: 'because', cost_usd: 0.02 };
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ output: 'because', cost_usd: 0.02, cached: false });
  });

  test('on a second call with the same input, returns the cached output without running again', async () => {
    let calls = 0;
    const args = { loop_id: 'loop-1' as const, cycle_id: 'cycle-1' as const, step: 'processor' as const, input: { q: 'why' } };
    await runOnce(sqlite as never, args, async () => { calls++; return { output: 'because', cost_usd: 0.02 }; });
    const second = await runOnce(sqlite as never, args, async () => { calls++; return { output: 'WRONG', cost_usd: 999 }; });
    expect(calls).toBe(1);
    expect(second).toEqual({ output: 'because', cost_usd: 0.02, cached: true });
  });

  test('different inputs to the same step do not collide', async () => {
    await runOnce(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input: 'a' }, async () => ({ output: 1, cost_usd: 0 }));
    await runOnce(sqlite as never, { loop_id: 'loop-1', cycle_id: 'cycle-1', step: 'processor', input: 'b' }, async () => ({ output: 2, cost_usd: 0 }));
    expect(listEntries(sqlite as never, 'loop-1')).toHaveLength(2);
  });
});
