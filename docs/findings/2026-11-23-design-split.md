# Design split: where each section went

`docs/design.md` has 93 headings. Each is in one row below with its new home. The old file stays until the readers of `ui/api/design.ts`, `ui/views/design.js` and the tests move.

"Rewritten" means the text changed beyond a move: a value became a token name, a table row became a rule bullet, or a pointer changed. "Moved" means the same words in the new format.

| Old heading | New home | Status |
|---|---|---|
| # UI design language (line 1) | dropped: the intro describes the old doc; `tools.json` and the `design` CLI replace it | moved |
| ## Principles (line 7) | design/rules.md#one-token-set to design/rules.md#be-terse (6 rules) | moved |
| ### Rules (line 16) | design/rules.md#colour-token, design/rules.md#size-token, design/rules.md#size-literal, design/rules.md#value-token | rewritten |
| ## Foundations (line 36) | dropped: group heading; each part has its own row below | moved |
| ### Colour (line 38) | dropped: group heading | moved |
| #### Surfaces and text (line 40) | ui/app.css token comments (`--bg` to `--sel`) | moved |
| #### Tones (line 58) | ui/app.css token comments (`--run` to `--k`); `--kind`, `--k` and `--k-*` are not `:root` tokens, so they stay in the Ask card and issue row CSS | rewritten |
| #### Data colours (line 73) | ui/app.css token comments (`--series-*`, `--chart-*`, `--seg-*`, `--fill-*`); design/rules.md#colour-use for its Do and Don't | moved |
| #### Contrast (line 90) | design/rules.md#contrast (hex in the validate command removed) | rewritten |
| ### Type (line 110) | dropped: group heading | moved |
| #### Sizes (line 112) | ui/app.css token comments (`--fs-*`) | rewritten |
| #### Weights and families (line 126) | ui/app.css token comments (`--fw-*`, font families, `--chart-*`); design/rules.md#weight-token | moved |
| #### Tracking and line height (line 139) | design/rules.md#tracking, design/rules.md#line-height; ui/app.css token comments (`--ls-*`) | rewritten |
| ### Space and shape (line 151) | dropped: group heading | moved |
| #### Spacing (line 153) | ui/app.css token comments (`--sp-*`, `--dot-*`, `--gap*`, `--measure`); design/rules.md#dot-size, design/rules.md#measure, design/rules.md#sticky-top, design/rules.md#size-literal | rewritten |
| #### Radii (line 188) | ui/app.css token comments (`--r-*`) | moved |
| #### Controls and layers (line 198) | ui/app.css token comments (`--ctl-h`, `--bar-h`, `--dim`, `--z-*`); design/rules.md#state-selected, design/rules.md#state-current, design/rules.md#state-parked | moved |
| #### Breakpoints and motion (line 211) | design/rules.md#breakpoint-literal, design/rules.md#motion | moved |
| ### The dock bridge (line 219) | design/rules.md#dock-bridge; the table is the `--dock-*` token comments in `ui/app.css` | rewritten |
| ### Palettes (line 237) | design/rules.md#palettes, design/rules.md#theme-picker | moved |
| ## Content (line 265) | dropped: group heading | moved |
| ### Values (line 267) | design/rules.md#value-helpers and design/rules.md#value-missing to design/rules.md#value-sub-head; the Bypasses table became `except` lines on `value-helpers` | rewritten |
| ### Words (line 313) | design/rules.md#words-title-case to design/rules.md#words-examples | moved |
| ## Components (line 335) | dropped: group heading; each component has a file | moved |
| ### Every component (line 337) | design/rules.md#component-helper to design/rules.md#component-file | rewritten |
| ### Structure (line 361) | dropped: group label; a component file has no group | moved |
| #### Page head (line 363) | design/components/page-head.md | rewritten |
| #### Card (line 396) | design/components/card.md | moved |
| #### Detail panel (line 426) | design/components/detail-panel.md | rewritten |
| #### KPI strip (line 456) | design/components/kpi-strip.md | moved |
| #### Status row (line 483) | design/components/status-row.md | moved |
| #### Fact list (line 505) | design/components/fact-list.md | moved |
| #### Pair (line 528) | design/components/pair.md | moved |
| #### List and group (line 550) | design/components/list-and-group.md | moved |
| #### Contents (line 572) | design/components/contents.md | rewritten |
| ### Page (line 600) | design/rules.md#page-question, design/rules.md#page-grammar | moved |
| #### Page grammar (line 604) | design/rules.md#page-grammar, design/rules.md#page-first-screen, design/rules.md#page-row-defaults, design/rules.md#page-row-evidence, design/rules.md#page-no-cards-first; the three-view limit is in `design/components/page-head.md` | rewritten |
| #### Attention rows (line 618) | design/components/attention-rows.md | rewritten |
| #### Facts line (line 646) | design/components/facts-line.md | moved |
| #### Figure band (line 669) | design/components/figure-band.md | moved |
| #### List surface (line 693) | design/components/list-surface.md | rewritten |
| #### Inspector (line 730) | design/components/inspector.md | moved |
| #### Row bars (line 752) | design/components/row-bars.md | rewritten |
| ### Data (line 778) | dropped: group label | moved |
| #### Metric card (line 780) | design/components/metric-card.md | moved |
| #### Table (line 818) | design/components/table.md | rewritten |
| #### Row and cell (line 864) | design/components/row-and-cell.md | moved |
| #### Chart panel (line 888) | design/components/chart-panel.md | rewritten |
| #### Legend (line 934) | design/components/legend.md | rewritten |
| #### Meter (line 957) | design/components/meter.md | rewritten |
| #### Split card (line 986) | design/components/split-card.md | rewritten |
| #### Timeline (line 1017) | design/components/timeline.md | rewritten |
| ### Lists of items (line 1049) | dropped: group label | moved |
| #### Ask card (line 1051) | design/components/ask-card.md | moved |
| #### Feed row (line 1080) | design/components/feed-row.md | rewritten |
| #### Findings list (line 1112) | design/components/findings-list.md | moved |
| ### Labels (line 1133) | dropped: group label | moved |
| #### Badge (line 1135) | design/components/badge.md | moved |
| #### Chip (line 1158) | design/components/chip.md | moved |
| #### Status light (line 1180) | design/components/status-light.md | rewritten |
| ### Actions (line 1203) | dropped: group label | moved |
| #### Button (line 1205) | design/components/button.md | rewritten |
| #### Link button (line 1237) | design/components/link-button.md | moved |
| #### Link (line 1257) | design/components/link.md | moved |
| #### Command (line 1283) | design/components/command.md | moved |
| #### Row actions (line 1306) | design/components/row-actions.md | moved |
| #### Form message (line 1328) | design/components/form-message.md | moved |
| #### Two-click confirm (line 1350) | design/components/two-click-confirm.md | moved |
| #### Disclosure (line 1375) | design/components/disclosure.md | moved |
| ### Text (line 1402) | dropped: group label | moved |
| #### Markdown and code (line 1404) | design/components/markdown-and-code.md | moved |
| #### Diff (line 1429) | design/components/diff.md | moved |
| ### Controls (line 1452) | dropped: group label | moved |
| #### Filter bar (line 1454) | design/components/filter-bar.md | moved |
| #### Search box (line 1481) | design/components/search-box.md | moved |
| #### Tabs (line 1507) | design/components/tabs.md | rewritten |
| #### Tab card (line 1533) | design/components/tab-card.md | moved |
| #### Select (line 1557) | design/components/select.md | moved |
| #### Field and form (line 1581) | design/components/field-and-form.md | moved |
| #### Settings list (line 1608) | design/components/settings-list.md | moved |
| #### Edit toggle (line 1639) | design/components/edit-toggle.md | moved |
| #### Pager (line 1665) | design/components/pager.md | moved |
| #### Empty state (line 1694) | design/components/empty-state.md | moved |
| ## States (line 1724) | design/rules.md#state-focus to design/rules.md#state-active (10 rules) | rewritten |
| ## Layout (line 1743) | design/rules.md#layout-sidebar to design/rules.md#layout-grid, design/rules.md#page-kinds | rewritten |
| ### Needs-you strip (line 1760) | design/components/needs-you-strip.md | moved |
| ## Views (line 1783) | design/rules.md#view-module to design/rules.md#view-api-failure | moved |
| ## Accessibility (line 1800) | design/rules.md#a11y-colour-alone to design/rules.md#a11y-aria | moved |
| ## Deviations (line 1809) | design/rules.md#deviations; four "allowed" rows became `except` lines on `breakpoint-literal` (2), `colour-token` and `value-helpers`; the cost axis row and the session waterfall row also stay in the table | rewritten |
| ## Appendix (line 1839) | dropped: group heading | moved |
| ### What could not be determined (line 1841) | dropped: audit notes of one extraction run (earlier decisions, browser checks, colour uses, chart data); the contrast gap is one sentence in design/rules.md#contrast | moved |
| ### Bypasses that stay (line 1851) | `except` lines on design/rules.md#value-helpers | rewritten |
| ### Inventory (line 1861) | dropped: counts from a run of the inventory script; they go stale at the next edit | moved |

## Judgment calls

1. A group heading (Foundations, Structure, Data) has no home. A component file has no group, so these rows read "dropped".
2. The Parts table lost its `#` column. A component file keeps the table as a free section. The Helper and Reference table stays as a `## Helper` section.
3. A component bullet that was a prose sentence stays a bullet. Two prose items became bullets: the Running line of the feed row and the Status page head of the page head. The session waterfall is an `except` on the first chart panel rule.
4. The doc said the page padding was 28px 24px 64px. The code now pads the bottom with a `calc()` for the dock, so `layout-page` follows the code.
5. A px value that equals a token value became a token name or a word. A thin bar replaces 1px, 2px and 3px in the component files, because those sizes are literals in the CSS and have no token.
6. `--kind`, `--k`, `--k-bg` and `--k-ring` are set on `.issue-row` and not on `:root`. They are not tokens for the CLI, so they have no comment. The Ask card file names them in its Parts table.
