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
(`/shelf/i/<item-id>/`). In a project that `tools init` attached, it is empty: run `shelf` in the project, and it uses
the project's notes. Else it is `--file ~/.aleph/annotations.json`. A note's id is the last `- id:` line of its
numbered entry: its text comes before its fields and can hold `- id:` lines of its own.

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

## Designer

A note that starts `[variant]`, `[tune]`, `[text]`, `[steer]` or `[critique]` comes from the dock's designer
(`~/aleph-tools/docs/specs/2026-11-26-design-tool-m3.md`). Each starts with **Replay**, as in step 1 above. Each
reply goes through `shelf note reply <scope> <note-id>`, and each commit is made as in step 4 above, with
`note <note-id>, send <n>` in its body. The page's URL is in the head line of the send, `Annotations on <title> (<url>):`.

### Variants

1. Read the element: its `- html:` line, the helper that draws it (its `data-design` id), and
   `design rules --for <component>`.
2. Reply `variants:`, a blank line, then three variants. Each is `<n>. <the idea, in one line>`, a fenced `html` block
   of the element's whole new HTML with the page's own classes and tokens, an optional fenced `css` block, and
   `new: <part>, <part>` when it uses parts that the component file does not list. The dock draws each one in place
   of the element, and runs no app code in it. Change no file, and go back to `wait`.
3. The user's Use is `answer: ui` with the line `variant: <n>`. Write variant `n` into the helper with the helper's own
   code and tokens, not the HTML as given. Commit, and reply `written <short sha>`. For each part on its `new:` line,
   reply `proposal:` with the part's bullet under `## Parts` of the component file and a fenced `diff` block, and
   leave the note open. With no new part, resolve the note.

### Tune

The note's diff is the user's own change, made and seen on the page. Write exactly its lines, and no other line.
Commit, reply `written <short sha>`, and resolve the note. If a `-` line does not match its file, change nothing and
reply with the line that differs.

### Text edits

The note holds `from: <old>` and `to: <new>`. Search the project's tracked source for the old text with
`git grep -n -F`.

- In exactly one place: change it there, commit, reply `written <short sha>` and a fenced `diff` block, and resolve the
  note.
- In no place or in more than one: change no file, reply with each `file:line` found, or `not found`, and leave the
  note open.

### Steer

1. Read the page's helpers and `design rules`, and find each element that the direction changes.
2. For each, add an agent note on it with `shelf note add <scope> --selector '<css>' --url <the page's URL> -`. Its first
   line says the change, then a fenced `diff` block of every line it changes, and its last lines are `from: steer`
   and `note: <steer note id>`. A change to a token goes on `:root`, with the token's diff.
3. Change no file. Reply `<n> notes`, resolve the steer note, and go back to `wait`. The user answers each note with
   `ui`, `language`, `exception` or `discard`, as above.

### Critique

1. Run `design critique` for the checklist. Read the page: its helpers, its CSS and its states. Score each item 0, 1 or
   2 on its own scale.
2. Reply `critique:`, then a Markdown table of each item's id, score and one line of reason, then
   `total: <sum> of <max>`.
3. For each item below 2 on an element, add an agent note on it, as in Steer, with a fenced `diff` block, and the
   lines `from: critique`, `note: <critique note id>` and `check: <item id>` last. A failure with no element and no lines stays in the
   table only.
4. Change no file. Resolve the critique note, and go back to `wait`.

## Questions

A question is a send whose second line is `ask: <question>`, then the note as Markdown with its `- id:`. The user
asked it in the note editor, which shows the thread and waits for your reply.

1. Read what the question needs: the note, its replies, the code it names. Change nothing.
2. Reply with `shelf note reply <scope> <note-id> "<answer>"`, in at most three short sentences. When the answer is
   a change, reply `proposal: <the change>` and a fenced `diff` block of every line it changes instead: the editor
   shows Approve and Discard on it, and each comes back as an answer. The user approves only lines they can see.
3. Go back to `wait`. A question gets no commit, and the note stays open.
