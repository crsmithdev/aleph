# Ideas 

## Background Autonomy
- **Autonomous development** — dispatch a prompt; AI iterates (build → test → refine) unattended across multiple cycles, configurable variation, completion contacts, quality gates, summaries
- **Morning briefing** — on session start, surface a digest of all overnight autonomous work: features ready for review, research completed, issues encountered

## Writing & Editing
- **Rich text / WYSIWYG** — formatted editing without seeing markup
- **Block-based editing** — each paragraph/image/embed is a movable block
- **Outliner mode** — bullet-based hierarchical note structure (indent/outdent)
- **Slash commands** — type `/` to insert blocks, formatting, embeds
- **Code blocks** — syntax-highlighted fenced code with language detection
- **Diagrams** — Mermaid, PlantUML, flowcharts, sequence diagrams rendered inline
- **Embedded media** — images, video, audio, PDFs, web pages inline
- **Audio recording** — record voice notes directly into a note, with speech-to-text
- **Callouts / admonitions** — colored info/warning/tip blocks

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
- **Contact groups / tags / labels** — arbitrary categorization, smart groups by filter, automatically
- **Contact enrichment** — auto-pull data from LinkedIn, social media, public web (job changes, company info)Z
- **Interaction timeline** — chronological log of every touchpoint per contact (calls, emails, meetings, texts)
- **Multi-source import** — Gmail, LinkedIn, CSV, vCard, social platforms, phone contacts
- **Per-contact tracking** — notes, debts, gifts given/received/wishlisted, expenses, activity log
- **Relationship intelligence** — health scores based on interaction frequency/recency/sentiment, neglected contact alerts, "Y just changed jobs" insights

- **Link aliases** — display different text for a link than the target note's titleA
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
