# Doc tools

Each tool is optional. Run the ones installed; list the others with their install line. Versions as checked on
2026-11-11.

| Tool | Lens | Checks | Install | Run |
|---|---|---|---|---|
| `refs.ts` | true, gaps, find | Broken links, anchors, paths, env vars and own-CLI flags; undocumented env vars; orphans | in this skill | `bun <skill dir>/refs.ts <repo>` |
| lychee 0.24 | true, find | External and internal links, with anchors | `cargo install lychee` | `lychee --include-fragments --offline .` (drop `--offline` to check the web) |
| markdownlint-cli2 0.24 | find | Heading order (MD001), duplicate headings (MD024), one h1 (MD025), alt text (MD045) | `npm i -D markdownlint-cli2` | `npx markdownlint-cli2 "**/*.md" "#node_modules"` |
| Vale 3.26 | clear | Style-guide rules (Google, Microsoft), weasel words, sentence length | GitHub release or `brew install vale` | `vale sync && vale docs README.md` |
| cspell 10 | clear | Spelling, with a project word list | `npm i -D cspell` | `npx cspell "**/*.md"` |
| alex 11 | clear | Insensitive and inconsiderate words | `npm i -D alex` | `npx alex docs README.md` |
| cog 3.6 / embedme 1.22 | true | A snippet that no longer matches its source | `pip install cogapp` / `npm i -D embedme` | `cog --check -r README.md` / `npx embedme --verify README.md` |
| doc-test runners | true | Code blocks that run and give the output the doc shows | Python: `pip install pytest-markdown-docs`; Rust: built in; shell: `pip install byexample` | `pytest --markdown-docs`; `cargo test --doc`; `byexample -l shell README.md` |
| interrogate 1.7 / TypeDoc 0.28 | gaps | Public symbols with no doc block | `pip install interrogate` / `npm i -D typedoc` | `interrogate -vv src`; `typedoc --validation.notDocumented --treatWarningsAsErrors` |

A tool needs the repo's consent to be added: install it in the repo (a dev dependency, a CI step) only when the
user picks the finding whose hold it is.
