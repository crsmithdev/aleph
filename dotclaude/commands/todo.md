Manage todos via the goal-tracker MCP tools. Parse the user's intent from: $ARGUMENTS

## Actions

- **list** (default if no args): Call `list_todos` with today's date. Show overdue, today, and completed sections.
- **add <title>**: Call `create_todo`. Parse due date and goal link from context if mentioned.
- **done <id>**: Call `update_todo` with done=true.
- **undone <id>**: Call `update_todo` with done=false.
- **delete <id>**: Call `delete_todo`.
- **recurring**: Call `list_recurring_todos`. Show with period status.
- **recurring add <title> <frequency>**: Call `create_recurring_todo`.
- **recurring done <id>**: Call `complete_recurring_todo` with the current period key.

## Output format

Keep output concise. Use a markdown table for lists. Show IDs so the user can reference them in follow-up commands.
