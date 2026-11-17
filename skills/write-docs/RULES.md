# Doc rules

The rules a doc change must meet, numbered so that a check and a refit can cite them. A tag names the
[refit-docs](../refit-docs/SKILL.md) lens that finds a break. The writing rules by category live in
[rules/](rules/_sections.md), and these rules cite them by name.

Ask these of each new page, section, CLI command or flag, env var, config key, public symbol and example.

1. **Backed by code.** Each new doc line that names a path, command, flag, default or behaviour points at the
   line of code that backs it. (true)
2. **Each surface documented.** A new command, flag, env var, config key or public symbol has a page or usage line
   that documents it. (gaps)
3. **One reading.** Each new sentence has one reading, and holds on every platform and version it claims. The
   `voice-` and `clarity-` rules apply. (clear)
4. **One reader task.** Each new page has one Diátaxis type (`structure-diataxis`), and each new section serves
   that type's reader. (shape)
5. **Reachable.** A page links to each new page, and its headings are words a reader would search for. The `nav-`
   rules apply. (find)
6. **Said once.** A new section says nothing another doc or the code already says. Link to it. (copies)
7. **Stays true.** A new line says no "now", "new" or date. Write it so it stays true, or put it in the changelog.
   (rot)
