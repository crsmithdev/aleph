---
name: write-data
description: >
  Data pipeline: get a number from its source event to the page with one
  writer, one key form and a recompute. Use when you add or change an event,
  record field, store migration or API field a page shows. NOT for: auditing
  data (use refit-data).
---

# Write data

1. **Name the source.** Write down the event or record that holds the fact, its writer, and the moment it is
   written. A fact is a field, not text in a note that a reader parses.
2. **Use one key form.** The writer and each reader name the entity in the form the repo's naming module or
   glossary gives. Do not build a key from parts in a reader: a key built that way breaks when the form changes.
3. **Write before you read.** Land the writer and see it write a real row before a view reads the field.
4. **Carry the history.** A store migration carries each field that a reader needs, for old rows too. Run each
   reader on the migrated data, and compare its values before and after the migration.
5. **Recompute once.** After the change lands, recompute the number from the raw rows and compare it with the
   live API at the same moment. Report both values.
6. **Check the data.** Read the `## Check` section of [refit-data](../refit-data/SKILL.md) and run its steps on
   what you wrote. Done when your summary lists each item with its verdict, and each verdict other than keep is
   applied.
