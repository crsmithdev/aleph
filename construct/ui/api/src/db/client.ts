import { createDb as createDbBase, type Db, type Sqlite } from '@construct/data';

export function createDb(url?: string): { db: Db; sqlite: Sqlite } {
  return createDbBase(url);
}

export type { Db, Sqlite };
