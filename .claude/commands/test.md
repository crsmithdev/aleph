---
name: test
description: "Run Construct functional tests. Subcommands: hooks (Layer 1 unit tests), compare (Layer 2 bare vs scaffolded), all."
argument-hint: "hooks | compare | all"
---

Run Construct evaluation tests.

## Subcommands

Route on `$ARGUMENTS`:

### `hooks` (default if no argument given)

Run Layer 1 hook unit tests. No Claude session needed — tests each hook in isolation with crafted payloads.

```bash
bash .claude/construct/eval/test.sh
```

Accepts optional section filter: `hooks settings`, `hooks memory`, `hooks commands`.

### `compare`

Run Layer 2 bare-vs-scaffolded comparison. Sends the same prompt via `claude -p` twice — once from a bare directory, once from the project root where CLAUDE.md loads automatically. Compares structural signals (ISC, depth, thinking tools) in each response.

```bash
bash .claude/construct/eval/compare.sh
```

Accepts optional prompt: `compare "refactor the auth module"` or `compare --prompt 2`.

### `all`

Run both layers sequentially. Layer 1 first — if it fails, report but still run Layer 2.
