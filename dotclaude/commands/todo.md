Manage todos via the goal-tracker MCP tools. Parse the user's intent from: $ARGUMENTS

## Actions

- **no args → list**: Call `list_todos` with today's date. Show overdue, today, and completed sections.
- **any other text → add**: Call `create_todo` with the text as the title. Parse due date and goal link from context if mentioned.
- **recurring / recur / repeat**: Call `list_recurring_todos`. Show with period status.
- **recurring add <title> <frequency>** (or "add recurring/repeating <title> every <freq>"): Call `create_recurring_todo`.
- **delete <id>**: Call `delete_todo`.

For completion, use `/finish` instead.

## Output format

Keep output concise. Use a markdown table for lists. Show IDs so the user can reference them in follow-up commands.
