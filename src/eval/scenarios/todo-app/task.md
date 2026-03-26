The todo app has two bugs that users have reported:

1. Checking off a todo item doesn't work — clicking the checkbox doesn't mark it as done
2. The POST /api/todos endpoint returns 200 with empty body instead of 201 with the created todo

Fix both bugs in server.ts. The app runs on port 3847 with `bun server.ts`.
