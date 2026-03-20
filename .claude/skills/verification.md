# Construct: verification

## Additional checks

| Claim | Requires | Not sufficient |
|-------|----------|----------------|
| Install works | Run `bun install.ts` + `/construct verify` | "Files copied" |
| Docs match behavior | Run docs-review skill | "I updated the docs" |
| Hook works | Pipe test input, check stdout | "Code looks correct" |
