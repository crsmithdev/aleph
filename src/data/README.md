# @aleph/data

Shared persistence layer for Aleph modules. Provides a SQLite client factory with WAL mode and foreign key enforcement.

**Depends on:** nothing

## Usage

```typescript
import { createDb } from '@aleph/data';

const { db, sqlite } = createDb(); // ~/.claude/aleph/data/aleph.db
// or
const { db, sqlite } = createDb(':memory:'); // for tests
```

Default path: `~/.claude/aleph/data/aleph.db`
Override: `ALEPH_DB_PATH` env var

Each module runs its own `CREATE TABLE IF NOT EXISTS` DDL on connect.
