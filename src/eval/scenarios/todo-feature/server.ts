/**
 * Todo app server with categories. Serves HTML UI and JSON API.
 * Run: bun server.ts
 */

interface Todo {
  id: number;
  text: string;
  done: boolean;
  category: string;
  createdAt: string;
}

let nextId = 1;
const todos: Todo[] = [];

const HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Todos</title>
  <style>
    body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 0 20px; background: #fafafa; }
    h1 { color: #333; margin-bottom: 24px; }
    .add-form { display: flex; gap: 8px; margin-bottom: 24px; }
    #todo-input { padding: 8px 12px; flex: 1; font-size: 16px; border: 1px solid #ddd; border-radius: 4px; }
    #category-select { padding: 8px; font-size: 14px; border: 1px solid #ddd; border-radius: 4px; }
    #add-btn { padding: 8px 20px; font-size: 16px; cursor: pointer; background: #4a90d9; color: white; border: none; border-radius: 4px; }
    #add-btn:hover { background: #357abd; }
    .filters { display: flex; gap: 8px; margin-bottom: 16px; }
    .filter-btn { padding: 4px 12px; font-size: 13px; cursor: pointer; border: 1px solid #ddd; border-radius: 12px; background: white; }
    .filter-btn.active { background: #4a90d9; color: white; border-color: #4a90d9; }
    .todo-item { display: flex; align-items: center; padding: 12px; margin-bottom: 8px; background: white; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .todo-item.done .todo-text { text-decoration: line-through; color: #999; }
    .todo-text { flex: 1; font-size: 15px; }
    .todo-category { font-size: 11px; color: #888; background: #f0f0f0; padding: 2px 8px; border-radius: 8px; margin-right: 8px; }
    .todo-toggle { cursor: pointer; margin-right: 12px; font-size: 18px; user-select: none; }
    .todo-delete { cursor: pointer; color: #c00; border: none; background: none; font-size: 14px; opacity: 0.5; }
    .todo-delete:hover { opacity: 1; }
    #todo-list { list-style: none; padding: 0; }
    .stats { color: #666; margin-top: 16px; font-size: 14px; display: flex; justify-content: space-between; }
    .empty { text-align: center; color: #999; padding: 40px 0; }
  </style>
</head>
<body>
  <h1>Todo List</h1>
  <div class="add-form">
    <input id="todo-input" placeholder="What needs to be done?" />
    <select id="category-select">
      <option value="general">General</option>
      <option value="work">Work</option>
      <option value="personal">Personal</option>
      <option value="shopping">Shopping</option>
    </select>
    <button id="add-btn">Add</button>
  </div>
  <div class="filters" id="filters">
    <button class="filter-btn active" data-filter="all">All</button>
    <button class="filter-btn" data-filter="active">Active</button>
    <button class="filter-btn" data-filter="done">Done</button>
  </div>
  <ul id="todo-list"></ul>
  <div class="stats" id="stats"></div>

  <script>
    const input = document.getElementById('todo-input');
    const categorySelect = document.getElementById('category-select');
    const list = document.getElementById('todo-list');
    const statsEl = document.getElementById('stats');
    const addBtn = document.getElementById('add-btn');
    const filtersEl = document.getElementById('filters');
    let currentFilter = 'all';

    filtersEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('filter-btn')) {
        filtersEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.dataset.filter;
        refresh();
      }
    });

    async function refresh() {
      const res = await fetch('/api/todos');
      const todos = await res.json();
      const filtered = currentFilter === 'all' ? todos
        : currentFilter === 'active' ? todos.filter(t => !t.done)
        : todos.filter(t => t.done);

      list.innerHTML = '';
      if (filtered.length === 0) {
        list.innerHTML = '<li class="empty">No todos here</li>';
      } else {
        for (const todo of filtered) {
          const li = document.createElement('li');
          li.className = 'todo-item' + (todo.done ? ' done' : '');
          li.innerHTML =
            '<span class="todo-toggle">' + (todo.done ? '☑' : '☐') + '</span>' +
            '<span class="todo-category">' + todo.category + '</span>' +
            '<span class="todo-text">' + todo.text + '</span>' +
            '<button class="todo-delete">✕</button>';
          li.querySelector('.todo-toggle').onclick = () => toggleTodo(todo.id);
          li.querySelector('.todo-delete').onclick = () => deleteTodo(todo.id);
          list.appendChild(li);
        }
      }

      const active = todos.filter(t => !t.done).length;
      const done = todos.filter(t => t.done).length;
      statsEl.innerHTML =
        '<span>' + active + ' remaining</span>' +
        '<span>' + done + ' completed</span>';
    }

    async function addTodo() {
      const text = input.value.trim();
      if (!text) return;
      await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, category: categorySelect.value }),
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

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, { headers: { "Content-Type": "text/html" } });
    }

    // API: list todos, with optional ?category= filter
    if (url.pathname === "/api/todos" && req.method === "GET") {
      const cat = url.searchParams.get("category");
      const filtered = cat ? todos.filter(t => t.category === cat) : todos;
      return Response.json(filtered);
    }

    // API: add todo
    if (url.pathname === "/api/todos" && req.method === "POST") {
      return (async () => {
        const body = await req.json() as { text: string; category?: string };
        const todo: Todo = {
          id: nextId++,
          text: body.text,
          done: false,
          category: body.category ?? "general",
          createdAt: new Date().toISOString(),
        };
        todos.push(todo);
        return Response.json(todo, { status: 201 });
      })();
    }

    // API: toggle todo
    if (url.pathname.match(/^\/api\/todos\/\d+\/toggle$/) && req.method === "PATCH") {
      const id = parseInt(url.pathname.split("/")[3]);
      const todo = todos.find(t => t.id === id);
      if (!todo) return new Response("not found", { status: 404 });
      todo.done = !todo.done;
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

    // API: stats
    if (url.pathname === "/api/stats" && req.method === "GET") {
      const byCategory: Record<string, { total: number; done: number }> = {};
      for (const t of todos) {
        if (!byCategory[t.category]) byCategory[t.category] = { total: 0, done: 0 };
        byCategory[t.category].total++;
        if (t.done) byCategory[t.category].done++;
      }
      return Response.json({ total: todos.length, done: todos.filter(t => t.done).length, byCategory });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`Todo server running on http://localhost:${server.port}`);
