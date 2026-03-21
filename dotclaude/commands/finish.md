Mark a todo or goal as done via the goal-tracker MCP tools. Parse the user's intent from: $ARGUMENTS

## Actions

- **<id>**: Determine whether the ID belongs to a todo or goal, then mark it done.
  - Todo: Call `update_todo` with done=true.
  - Goal: Call `update_goal` with state=done.
- **undo <id>**: Reverse completion.
  - Todo: Call `update_todo` with done=false.
  - Goal: Call `update_goal` with state=actionable.
- **recurring <id>**: Call `complete_recurring_todo` with the current period key.

If no ID is given, ask the user which item to finish.

## Output format

Confirm the action with the item title. Keep it to one line.
