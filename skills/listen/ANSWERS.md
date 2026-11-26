# Answers

An answer is a send whose second line is `answer: <kind>`. It is the user's decision on one note
(`~/aleph-tools/docs/specs/2026-11-22-design-tool.md`). Its form:

```
send: <n>
answer: ui | language | exception | approve | discard
reason: <text>          (exception only)

<the note as Markdown: the page, the note, `- id: <note-id>`, its element and its replies>
```

The note lives in a scope file. In the commands below, `<scope>` is `<item-id>` for a note on a shelf item page
(`/shelf/i/<item-id>/`), else `--file ~/.aleph/annotations.json`.

1. **Replay.** Run `git log --grep "send <n>$" --oneline` in the repo of the page. A hit means the answer is done:
   go back to `wait`.
2. **Tag.** Find the rule the note falls under with `design rules --for <component>`. The component is the
   `@design <id>` of the helper that draws the element, else the closest component file. Reply on the note with
   `shelf note reply <scope> <note-id> "rule: <id>"`, or `rule: new` when no rule fits.
3. **Act** by the kind:
   Each reply below goes through `shelf note reply <scope> <note-id> "<text>"`.
   - `ui`: change the page so it follows the language. The homes stay as they are.
   - `language`: reply `proposal: <the new or changed rule text>, in <home file and heading or bullet>`, then a
     fenced `diff` block with every line the proposal changes, `@@ <file>:<line>` first. Then go back to `wait`. The user answers it with approve or discard.
   - `approve`: write the proposal of the newest `proposal:` reply into its home.
   - `discard`: reply `discarded`, resolve the note, and go back to `wait`.
   - `exception`: add `except: <place>: <reason>` to the rule. In `design/rules.md` it is a `- except:` line under
     the rule's heading. In a component file it is a nested `  - except:` bullet under the rule.
4. **Commit** the change in a worktree, as CLAUDE.md says. The commit body has the line `note <note-id>, send <n>`.
5. **Resolve** with `shelf note resolve <scope> <note-id>`.

Done when the commit is on main, its body names the note and the send, and the note is resolved.

## First run

A note on a URL that ends `/first-run` is a group of a drafted language (the `design-language` skill, Draft). Its
text starts `proposal:` and ends with `layer:` and `group:` lines.

1. **Replay**, as in step 1 above.
2. **Approve.** Write exactly the lines of the note's diff, and no other line. Run `design rules`. If it exits 2, revert the
   lines, reply with its error and leave the note open. Else commit in a worktree, as CLAUDE.md
   says. The subject names the group, and the body has the line `note <note-id>, send <n>`. Land it on main, reply
   `written <short sha>`, then resolve the note.
3. **Discard.** Change no file. Reply `discarded`, then resolve the note.
4. **Ask** follows Questions below. Go back to `wait`.

## New rules

The inspector's New rule field sends a note of kind `rule`. In the send it reads `[rule] <the rule in plain words>`,
and its last line is `for: <level>`: `global`, `<component>` or `<component>/<part>`. Treat it as a `language`
answer for that level:

1. **Replay**, as in step 1 above.
2. **Check.** Run `design rules --for <component>`, or `design rules` for `global`. If a rule already says the same,
   reply `rule: <id>` with one sentence on how it covers the note, resolve the note, and go back to `wait`.
3. **Draft** the rule at its home. A global rule is a `###` heading of the rules file, with `- id:`, `- scope: global`
   and `- reason:`. A component rule is a bullet under `## Rules` of its file. A part rule is that bullet with a
   nested `  - part: <name>`, and the part must be under `## Parts`.
4. **Propose.** Reply `proposal: <the rule>, in <home file and heading or bullet>`, then a fenced `diff` block of every
   line it adds, `@@ <file>:<line>` first. Go back to `wait`. The user's Approve then follows `approve` above.

## Questions

A question is a send whose second line is `ask: <question>`, then the note as Markdown with its `- id:`. The user
asked it in the note editor, which shows the thread and waits for your reply.

1. Read what the question needs: the note, its replies, the code it names. Change nothing.
2. Reply with `shelf note reply <scope> <note-id> "<answer>"`, in at most three short sentences. When the answer is
   a change, reply `proposal: <the change>` and a fenced `diff` block of every line it changes instead: the editor
   shows Approve and Discard on it, and each comes back as an answer. The user approves only lines they can see.
3. Go back to `wait`. A question gets no commit, and the note stays open.
