/**
 * Simple todo app server. Serves HTML UI and JSON API.
 * Run: bun run server.ts
 */

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

let nextId = 1;
const todos: Todo[] = [];

const HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Todos</title>
  <style>
    body { font-family: system-ui; max-width: 500px; margin: 40px auto; padding: 0 20px; }
    h1 { color: #333; }
    #todo-input { padding: 8px; width: 300px; font-size: 16px; }
    #add-btn { padding: 8px 16px; font-size: 16px; cursor: pointer; }
    .todo-item { display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee; }
    .todo-item.done .todo-text { text-decoration: line-through; color: #999; }
    .todo-text { flex: 1; font-size: 16px; }
    .todo-toggle { cursor: pointer; margin-right: 12px; font-size: 18px; }
    .todo-delete { cursor: pointer; color: #c00; border: none; background: none; font-size: 14px; }
    #todo-list { list-style: none; padding: 0; }
    .count { color: #666; margin-top: 16px; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Todo List</h1>
  <div>
    <input id="todo-input" placeholder="What needs to be done?" />
    <button id="add-btn">Add</button>
  </div>
  <ul id="todo-list"></ul>
  <div class="count" id="count"></div>

  <script>
    const input = document.getElementById('todo-input');
    const list = document.getElementById('todo-list');
    const countEl = document.getElementById('count');
    const addBtn = document.getElementById('add-btn');

    async function refresh() {
      const res = await fetch('/api/todos');
      const todos = await res.json();
      list.innerHTML = '';
      for (const todo of todos) {
        const li = document.createElement('li');
        li.className = 'todo-item' + (todo.done ? ' done' : '');
        li.innerHTML =
          '<span class="todo-toggle">' + (todo.done ? '☑' : '☐') + '</span>' +
          '<span class="todo-text">' + todo.text + '</span>' +
          '<button class="todo-delete">✕</button>';
        li.querySelector('.todo-toggle').onclick = () => toggleTodo(todo.id);
        li.querySelector('.todo-delete').onclick = () => deleteTodo(todo.id);
        list.appendChild(li);
      }
      const remaining = todos.filter(t => !t.done).length;
      countEl.textContent = remaining + ' item' + (remaining !== 1 ? 's' : '') + ' remaining';
    }

    async function addTodo() {
      const text = input.value.trim();
      if (!text) return;
      await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      input.value = '';
      refresh();
    }

    async function toggleTodo(id) {
      await fetch('/api/todos/' + id + '/toggle', { method: 'PATCH' });
      refresh();
    }

    async function deleteTodo(id) {
      await fetch('/api/todos/' + id, { method: 'DELETE' });
      refresh();
    }

    addBtn.onclick = addTodo;
    input.onkeydown = (e) => { if (e.key === 'Enter') addTodo(); };
    refresh();
  </script>
</body>
</html>`;

const server = Bun.serve({
  port: 3847,
  fetch(req) {
    const url = new URL(req.url);

    // Serve HTML
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, { headers: { "Content-Type": "text/html" } });
    }

    // API: list todos
    if (url.pathname === "/api/todos" && req.method === "GET") {
      return Response.json(todos);
    }

    // API: add todo — BUG: returns wrong status and missing id in response
    if (url.pathname === "/api/todos" && req.method === "POST") {
      return (async () => {
        const body = await req.json() as { text: string };
        const todo: Todo = { id: nextId++, text: body.text, done: false };
        todos.push(todo);
        // BUG: returns 200 with empty body instead of 201 with the todo
        // The frontend doesn't care (it calls refresh), but the API contract is wrong
        return new Response(null, { status: 200 });
      })();
    }

    // API: toggle todo — BUG: toggles the wrong way (sets done to false always)
    if (url.pathname.match(/^\/api\/todos\/\d+\/toggle$/) && req.method === "PATCH") {
      const id = parseInt(url.pathname.split("/")[3]);
      const todo = todos.find(t => t.id === id);
      if (!todo) return new Response("not found", { status: 404 });
      todo.done = false;  // BUG: should be !todo.done
      return Response.json(todo);
    }

    // API: delete todo
    if (url.pathname.match(/^\/api\/todos\/\d+$/) && req.method === "DELETE") {
      const id = parseInt(url.pathname.split("/")[3]);
      const idx = todos.findIndex(t => t.id === id);
      if (idx === -1) return new Response("not found", { status: 404 });
      todos.splice(idx, 1);
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`Todo server running on http://localhost:${server.port}`);
