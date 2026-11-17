# Agent file rules

The rules an agent file change must meet, numbered so that a check and a refit can cite them. A tag names the
[refit-agents](../refit-agents/SKILL.md) lens that finds a break. [SKILL.md](SKILL.md) explains the ladder, the
pointers and the pruning these rules apply.

Ask these of each new agent file, CLAUDE.md or AGENTS.md line, skill, description, subagent, command, hook, MCP
server, and CLI command or flag.

1. **Valid.** A new file passes agnix and, for a plugin, `claude plugin validate`. Run them, and record the
   counts. (valid)
2. **Loaded only where needed.** A new line loads on every turn only when a branch needs it before any pointer
   fires. Else it goes behind a pointer. (load)
3. **Tiered.** Each new section loads only on the branch that needs it. Each new file has a pointer that says
   when to open it, and a script does each fixed sequence. (structure)
4. **One trigger owner.** No existing description matches the new one's triggers. Search the descriptions for
   each trigger phrase, and record the hits. (triggers)
5. **Not a copy.** A new line restates nothing the code or another agent file says. Point at it instead. (drift)
6. **Followed.** A new line contradicts no line in context, says nothing the agent can find by looking, and gives
   a bar the agent can check, in plain case. (adherence)
7. **Usable.** An agent can find and run each new command, flag or step without reading its source. Name where
   its usage lives. (interface)
8. **Safe.** Name what each new hook, server, grant or script runs, with whose rights, and on what input. (safety)
9. **Installed once.** A new item installs at the scope that needs it, and its file lives in the repo that owns
   it. (install)
