# Data rules

The rules of a data change, numbered so that a check and a refit can cite them. A tag names the
[refit-data](../refit-data/SKILL.md) lens that finds a break.

Ask these of each new number on a page, record field, event action, key form, join and store migration.

1. **A writer for each field.** Name the writer that sets the field, and the commit that adds it. A fact is a
   field, not text in a note that a reader parses. (orphan)
2. **One key form.** The writer and each reader name the entity in the form the repo's naming module or glossary
   gives. A reader builds no key from parts: a key built that way breaks when the form changes. (join)
3. **The label's promise.** Name what the label promises, and the rows the definition leaves out. (scope)
4. **Edges and time zone.** Name the window edges and the time zone of each number. (window)
5. **Carry the history.** A store migration carries each field that a reader needs, for old rows too. Run each
   reader on the migrated data, and compare its values before and after the migration. (migration)
6. **A recompute.** Name the query on the raw source that gives the same value. (recompute)
7. **One row per intent.** A writer that can run twice for one intent (a retry, a second tick) names the intent's
   key and writes one row for it, through a unique constraint or an upsert on that key. (validity)
