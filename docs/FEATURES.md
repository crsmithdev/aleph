# Planned / Possible Features

Feature superset drawn from note-taking (Obsidian, Logseq, SiYuan, AFFiNE, Joplin, Notion), Zettelkasten methodology, personal assistants (OpenClaw, Leon, PyGPT), and personal CRMs (Monica, Clay, Dex, Folk). Not all will be implemented — this is the ceiling, not the plan.

## Solo Adaptive System
- **Single-user, zero-overhead** — no multi-tenancy, no auth layers, no team abstractions; the entire system is shaped for one person
- **AI-native architecture** — AI is not a bolt-on; it is the primary interaction layer, builder, and maintainer of the system itself
- **Self-modifying structure** — the system can rewrite its own rules, skills, schemas, and components; no part is sacred except the principles
- **Convention-driven, fully overridable** — sensible defaults everywhere, but every behavior can be changed by editing a file
- **Schema-free evolution** — data structures grow organically with usage; no migrations, no breaking changes, no versioned APIs
- **Modular hot-swap** — any component (hook, skill, view, integration) can be added, removed, or replaced without affecting others
- **Principles over process** — a small set of immutable commandments governs everything; all other rules are negotiable and AI-modifiable
- **Rapid prototyping loop** — new features go from idea → working code → tested → deployed in a single session; no bureaucracy
- **Observable by default** — every action, decision, and change is logged and queryable; the system explains itself
- **Persistent memory** — user preferences, past decisions, and context survive across sessions; the system never forgets unless told to

## Background Autonomy
- **Autonomous development loops** — dispatch a prompt; AI iterates (build → test → refine) unattended across multiple cycles until done or blocked
- **Overnight feature delivery** — queue features before sleep; wake up to tested, working, commit-ready code on feature branches with summaries of what was built and decisions made
- **Deep research agents** — drop a topic ("I'm interested in X"); come back hours later to synthesized resources, summaries, comparisons, recommendations, and suggested next steps
- **Parallel agent swarms** — multiple independent agents work simultaneously on different features, research topics, or refactoring tasks
- **Quality gates** — autonomous work must pass real tests, linting, and verification before presenting results; no "it should work" — only evidence
- **Progress journals** — each autonomous session produces a structured log: what was attempted, what succeeded, what failed, decisions made, and open questions for the human
- **Completion contracts** — define a verifiable promise ("all tests pass", "API matches spec"); the loop runs until the contract is met or it escalates
- **Escalation protocol** — if an agent is stuck after N attempts, it stops, documents the problem clearly, and waits rather than thrashing
- **Morning briefing** — on session start, surface a digest of all overnight autonomous work: features ready for review, research completed, issues encountered
- **Topic watchlists** — maintain a list of interests; background agents periodically scan for new developments, papers, tools, repos, and surface relevant findings
- **Idea incubation** — seed half-formed ideas; background agents explore feasibility, find prior art, sketch implementations, and return with a "here's what this could look like" package

## Writing & Editing
- **Markdown editing** — full CommonMark + extensions (tables, footnotes, math, diagrams)
- **Rich text / WYSIWYG** — formatted editing without seeing markup
- **Block-based editing** — each paragraph/image/embed is a movable block
- **Outliner mode** — bullet-based hierarchical note structure (indent/outdent)
- **Slash commands** — type `/` to insert blocks, formatting, embeds
- **Code blocks** — syntax-highlighted fenced code with language detection
- **Diagrams** — Mermaid, PlantUML, flowcharts, sequence diagrams rendered inline
- **Embedded media** — images, video, audio, PDFs, web pages inline
- **Audio recording** — record voice notes directly into a note, with speech-to-text
- **Tables** — markdown tables and database-style structured tables
- **Callouts / admonitions** — colored info/warning/tip blocks
- **Horizontal rules, headings (6 levels), checklists**

## Note Types (Zettelkasten)
- **Fleeting notes** — quick captures, disposable, inbox items
- **Literature notes** — takeaways from a single source (book, video, article, podcast)
- **Permanent notes** — refined single-idea notes, written in your own words, the core of the knowledge base
- **Index notes** — top-level entry points that link to clusters of related permanent notes
- **Keyword notes** — tag-like notes that collect all notes related to a theme
- **Maps of Content (MOC)** — curated overview notes linking related ideas into a navigable structure
- **Hub notes** — broader topic hubs connecting multiple MOCs or index notes

## Contact & Relationship Management
- **Contact profiles** — name, photo, employer, job title, social links, addresses, phone, email, automatically from data
- **Relationship mapping** — define relationship types (family, friend, colleague, mentor), link contacts to each other, automatically
- **Contact groups / tags / labels** — arbitrary categorization, smart groups by filter, automatically
- **Contact enrichment** — auto-pull data from LinkedIn, social media, public web (job changes, company info)
- **Interaction timeline** — chronological log of every touchpoint per contact (calls, emails, meetings, texts)
- **Multi-source import** — Gmail, LinkedIn, CSV, vCard, social platforms, phone contacts
- **Contact deduplication** — merge duplicates across sources
- **Per-contact tracking** — notes, debts, gifts given/received/wishlisted, expenses, activity log
- **Relationship intelligence** — health scores based on interaction frequency/recency/sentiment, neglected contact alerts, "Y just changed jobs" insights

## Linking & Knowledge Graph
- **Bi-directional links** — `[[wikilinks]]` that auto-create backlinks on the target note
- **Backlinks panel** — see all notes that reference the current note
- **Outgoing links panel** — see all notes the current note links to
- **Unlinked mentions** — detect text that matches a note title but isn't linked yet
- **Block references** — link to a specific block/paragraph within a note, not just the whole note
- **Block embeds / transclusion** — render another note's content inline
- **Graph visualization** — interactive node-and-edge map of all notes, contacts, and their connections; local graph scoped to neighbors
- **Link aliases** — display different text for a link than the target note's title
- **Atomic note principle** — one idea per note, enforced by convention
- **Mind maps** — visual branching thought maps derived from the knowledge graph

## Organization & Structure
- **Folders / notebooks** — hierarchical directory structure
- **Tags** — `#tag` based categorization, nested tags (`#project/alpha`)
- **Properties / metadata** — YAML frontmatter or structured fields (date, author, status, type)
- **Starred / bookmarked notes** — pin frequently accessed notes, headings, searches, or folders
- **Daily notes / journal** — auto-created note per day, template-driven; mood tracking, life events
- **Templates** — reusable note skeletons with variable substitution (date, title, time)
- **Databases / structured views** — view notes as tables, kanban boards, calendars, galleries, timelines
- **Custom sort / filter** — sort notes by date, title, tags, metadata; filter by any property
- **Note aliases** — multiple names for the same note

## Search & Query
- **Unified search** — full-text, fuzzy, regex, and semantic (meaning-based) search across all notes, contacts, and memories in one interface
- **Search operators** — filter by tag, path, property, date, block type
- **Saved searches / smart folders** — persistent queries that auto-update
- **Dataview / query language** — programmatic queries over note metadata
- **Bookmark searches** — save a search query as a bookmarked item

## Reminders & Automation
- **Contact reminders** — cadence-based (weekly/monthly/quarterly), date-based (birthdays, anniversaries), or one-time follow-ups
- **Scheduled automations** — trigger actions on time or event (e.g., "email X every first Monday")

## Task & Goal Management
- **To-do checkboxes** — `- [ ]` task items within notes
- **Task queries** — aggregate incomplete tasks across all notes
- **Due dates / priorities** — metadata on tasks
- **Kanban boards** — drag-and-drop task boards derived from notes
- **Recurring tasks** — daily/weekly/monthly repeats with completion tracking
- **Goal tracking** — set objectives, track progress, categorize

## Sync & Cross-Platform
- **Local-first storage** — all data on device, works offline
- **End-to-end encrypted sync** — sync across devices with client-side encryption
- **Cloud sync options** — Dropbox, OneDrive, iCloud, Google Drive, S3, self-hosted
- **Git-based sync** — version control via Git repositories
- **Cross-platform** — Windows, macOS, Linux, iOS, Android, web browser

## Import / Export & Interoperability
- **Plain text files** — notes stored as `.md` files on disk, fully portable
- **Import from** — CSV, Gmail, LinkedIn
- **Export to** — PDF, HTML, DOCX, EPUB
- **Open format** — no vendor lock-in, files readable by any text editor
- **Web clipper** — browser extension to save web pages / selections as notes
- **Email to note** — forward emails to create notes
- **API access** — REST or local API for programmatic note creation/query

## Extensibility & Integrations
- **Plugin / extension system** — modules with manifest, isolated directories, lifecycle management
- **Command palette** — fuzzy-searchable list of all available commands
- **MCP / tool protocol** — standardized integration surface for AI agents
- **External channels** — messaging (WhatsApp, Telegram, Slack, Discord, Signal, email, SMS), calendars, voice interaction via integrations
- **Browser automation** — fill forms, navigate sites, scrape data on behalf of user

## AI Features
- **AI knowledge chat** — ask questions about your knowledge base in natural language; ingest documents and query them via RAG
- **AI summarization** — auto-summarize long notes or meetings
- **AI writing assist** — continue writing, rephrase, translate, expand, draft contextual messages
- **AI meeting notes** — auto-join calls, transcribe, summarize

## Privacy & Security
- **Self-hosted** — run on your own server or NAS
