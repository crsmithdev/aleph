---
name: write-data
description: >
  Data pipeline: get a number from its source event to the page with one
  writer, one key form and a recompute. Use when you add or change an event,
  record field, store migration or API field a page shows. NOT for: auditing
  data (use refit-data).
---

# Write data

Before the first edit, call the Read tool on [write/PROCESS.md](../write/PROCESS.md) and on [RULES.md](./RULES.md).
Follow PROCESS.md's steps, with these as its step 3:

1. **Name the source.** Write down the event or record that holds the fact, its writer, and the moment it is
   written.
2. **Write before you read.** Land the writer and see it write a real row before a view reads the field.
3. **Recompute once.** After the change lands, recompute the number from the raw rows and compare it with the
   live API at the same moment. Report both values.
