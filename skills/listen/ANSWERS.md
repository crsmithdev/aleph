# Answers

An answer is a send whose second line is `answer: <kind>`. It is Chris's decision on one note
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
   - `language`: reply `proposal: <the new or changed rule text>, in <home file and heading or bullet>`. Then go back
     to `wait`. Chris answers it with approve or discard.
   - `approve`: write the proposal of the newest `proposal:` reply into its home.
   - `discard`: reply `discarded`, resolve the note, and go back to `wait`.
   - `exception`: add `except: <place>: <reason>` to the rule. In `design/rules.md` it is a `- except:` line under
     the rule's heading. In a component file it is a nested `  - except:` bullet under the rule.
4. **Commit** the change in a worktree, as CLAUDE.md says. The commit body has the line `note <note-id>, send <n>`.
5. **Resolve** with `shelf note resolve <scope> <note-id>`.

Done when the commit is on main, its body names the note and the send, and the note is resolved.
