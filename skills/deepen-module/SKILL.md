---
name: deepen-module
description: Land one agreed deepening in green steps. Pin the current behaviour, build the deep module beside the old code, move the callers, delete what is left.
disable-model-invocation: true
---

# Deepen Module

Execute one deepening that `/aleph:improve-codebase-architecture` picked and grilled. The design is fixed: the module, its interface, what sits behind the seam, the dependency category. This skill lands that design the way Feathers changes legacy code: **pin**, **build**, **move**, **delete**. Behaviour stays constant from the first commit to the last.

Call the Skill tool with `aleph:codebase-design` for the vocabulary (**module**, **interface**, **seam**, **adapter**, **deletion test**) and read its `DEEPENING.md` for the dependency categories and the replace-don't-layer rule. Call the Skill tool with `aleph:tdd` when you write tests at the new interface.

## Givens

The design comes from the conversation or from a spec the user names. When neither holds it, stop and ask for it; this skill does not design.

Before the first edit, write the givens in one message:

- The deepened module: its name (a `CONTEXT.md` term), its interface, its seam.
- The shallow modules it replaces, by path.
- Every caller of those modules, by path. Grep for them; do not work from memory.
- The dependency category from `DEEPENING.md` and the adapters it implies.
- The tests that survive and the tests that go.

## Rules

- **A deepening is a refactor.** A bug the pin reveals goes in the report as a follow-up. Its characterization test keeps asserting today's output.
- **Green after every step.** The full suite runs after each commit. A red suite blocks the next step.
- **A miss goes back to the user.** When a caller needs something the agreed interface lacks, stop and show the gap. The interface changes by decision, not by drift.

## Process

### 1. Pin

Characterization tests record what the code does today through the seams the callers already use, ugly cases included. They are scaffolding: they protect the move and go in step 4.

- Run the existing suite. It is green before the first edit, or you report the red and stop.
- For each caller behaviour the new interface must preserve and no test covers, write a characterization test at the current seam. The expected value is what the code returns now.
- Commit: `pin <module> before deepening`.

Done when every caller in the givens has its behaviour under a test, existing or characterization, and the suite is green.

### 2. Build

Build the deep module beside the old code. Nothing else changes yet.

- Create the module at its seam with the agreed interface.
- Copy the implementation in from the shallow modules. The new module imports nothing from them, so step 4 is a clean cut.
- Add the adapters the dependency category calls for. Categories 1 and 2 need none.
- Write tests at the new interface, red → green. The interface is the test surface: assert on outcomes.
- Commit: `build <module>`.

Done when the new module passes its own interface tests, the suite is green, and no caller uses it yet.

### 3. Move

Move the callers one at a time.

- Point one caller at the new interface. Run the suite.
- Green: commit `move <caller> to <module>`.
- Red: the failing characterization test names the behaviour the design missed. Fix the module. If the fix needs an interface change, apply the miss rule.
- Repeat until a grep for the old modules finds only the old modules and their tests.

Done when every caller in the givens imports the new module.

### 4. Delete

Apply the deletion test for real.

- Delete the shallow modules, their implementation-coupled tests, and the characterization tests from step 1. Run the suite.
- Green: the complexity concentrated. Commit `delete <old modules>`.
- Red, or a build error outside the deleted files: something still earned its keep. Restore it, report what and why, and stop.

Done when the old paths are gone, the suite is green, and the new module's interface tests are the only tests of that behaviour.

### 5. Record

Call the Skill tool with `aleph:domain-modeling`:

- The module's name is a term in `CONTEXT.md`. Add it when it is new.
- A decision made during the move that a future review would re-open (a seam placed away from the obvious spot, a caller left on a shim) becomes an ADR.

Report the commits, the test count replaced (deleted and added), the follow-ups the pin revealed, and anything restored in step 4.
