Add a "due date" feature to the todo app. This requires changes to both the server API and the HTML frontend.

Requirements:
1. Todos should optionally have a `dueDate` field (ISO date string, e.g. "2026-04-01")
2. The POST /api/todos endpoint should accept and store `dueDate`
3. GET /api/todos should support `?overdue=true` to filter only past-due incomplete todos
4. GET /api/todos should support `?sort=dueDate` to sort by due date ascending
5. The HTML UI should show a date picker input next to the category selector
6. Todo items with due dates should display the date (with a CSS class `todo-due`)
7. Overdue items should be visually distinct (e.g. red text on the date)

The server runs on port 3847 with `bun server.ts`. Tests are in server.test.ts.
