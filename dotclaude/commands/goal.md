Manage goals via the goal-tracker MCP tools. Parse the user's intent from: $ARGUMENTS

## Actions

- **list** (default if no args): Call `list_goals`. Show as a compact table: title, state, priority, categories.
- **create <title>**: Call `create_goal` with the given title. Infer priority/state from context if mentioned.
- **update <id> <fields>**: Call `update_goal`. Fields: title, priority, state, archived.
- **delete <id>**: Call `delete_goal` after confirming.
- **show <id>**: Call `get_goal`. Show full detail including categories, latest note, and recent history via `get_history`.
- **archive <id>**: Shortcut for `update_goal` with archived=true.

For completion, use `/finish` instead.

## Output format

Keep output concise. Use a markdown table for lists. Show IDs so the user can reference them in follow-up commands.
