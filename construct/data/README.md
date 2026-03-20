# @construct/data

Shared persistence layer for Construct modules. Provides a SQLite client factory with WAL mode and foreign key enforcement.

**Depends on:** nothing

## Usage

```typescript
import { createDb } from '@construct/data';

const { db, sqlite } = createDb(); // ~/.claude/construct/data/construct.db
// or
const { db, sqlite } = createDb(':memory:'); // for tests
```

Default path: `~/.claude/construct/data/construct.db`
Override: `CONSTRUCT_DB_PATH` env var

Each module runs its own `CREATE TABLE IF NOT EXISTS` DDL on connect.
