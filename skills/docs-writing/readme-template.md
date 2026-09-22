# README template

Put the most important information first. A visitor reads the top screen. A user reads to the end of Usage. A contributor reads everything. Cut a section the project does not need; do not fill it.

Sources: ripgrep (why and why not), uv (claim, proof, then docs link), bat (one example per feature), httpie and size-limit (demo first), choo (FAQ).

## Rules

| Rule | Why |
|---|---|
| One line under the title says what it is, compared with a thing the reader knows | "A `cat(1)` clone with syntax highlighting" needs no more words |
| Proof comes before explanation: output, a screenshot or a benchmark | The reader decides in ten seconds |
| The first command is on the first screen | `structure-quick-start` |
| Every feature has a runnable example with its real output | Prose about a flag is weaker than the flag |
| Say when not to use it | ripgrep's candour earns trust for the rest of the page |
| Tables for layout, commands, options and config | Scannable; a reader looks up, not reads through |
| At most three badges, each a real signal: CI, version, licence | Decoration hides the claim |
| No banner image, no emoji headings, no hand-written TOC | GitHub renders an outline menu for headings |
| The README orients; the docs site explains | Past about 300 lines, move reference into `docs/` and link it |
| No dates, no "coming soon" | `hygiene-no-temporal`, `hygiene-planned-label` |

## Template

````markdown
# <name>

<One sentence: what it is, compared with something the reader knows. Then one sentence: what makes it different.>

<!-- Proof. One of: a fenced block of real command output, a screenshot or GIF with alt text, a benchmark with its method linked. -->

```console
$ <name> <typical command>
<real output>
```

## Install

<!-- One command per supported method. Name the runtime and minimum version. -->

```bash
<install command>
```

Requires <runtime> <version> or later.

## Quick start

<!-- Three to five steps from install to a first useful result. -->

1. <Step>:
   ```bash
   <command>
   ```
2. <Step>:
   ```bash
   <command>
   ```

## Usage

<!-- One subsection per feature, in the order a user meets them. Each has a runnable example and its output. -->

### <Feature>

<One sentence.>

```bash
<command>
```

## Configuration

<!-- Only if there is configuration. A table, with defaults taken from the code. -->

| Setting | Default | Does |
|---|---|---|
| `<NAME>` | `<value>` | <what it changes> |

## Why not <name>

<!-- When a different tool is the better choice. Two to four bullets. -->

- <Case>: use <alternative>.

## Layout

<!-- Only for repos a contributor has to navigate. -->

| Path | Holds |
|---|---|
| `<dir>/` | <what> |

## Development

```bash
<build command>
<test command>
```

<!-- Say what the tests do not cover, if a reader could assume they do. -->

## Credits

<Adapted work with its licence. Then the licence of this project, one line.>
````

## Order by project kind

| Kind | Sections |
|---|---|
| CLI | claim, proof, Install, Quick start, Usage, Configuration, Why not, Development |
| Library | claim, Install, Quick start (the smallest program that works), Usage, link to API docs, Development |
| App or service | claim, screenshot, Quick start (run it locally), Configuration, Layout, Development |
| Plugin or config repo | claim, Layout, what each part does, Install, Development |
| Private tool | claim, Install, Usage, Layout; skip proof and Why not |
