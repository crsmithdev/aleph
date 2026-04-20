const USERS = new Map<string, { id: string; name: string; email: string }>([
  ["u1", { id: "u1", name: "alice", email: "alice@example.com" }],
  ["u2", { id: "u2", name: "bob", email: "bob@example.com" }],
  ["u3", { id: "u3", name: "carol", email: "carol@example.com" }],
]);

const PORT = parseInt(process.env.PORT ?? "8234");

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/users") {
      // "Fix": return users from the USERS map. Looks correct; passes type-check
      // and build. At runtime, a MapIterator serializes to {} via JSON.stringify —
      // the endpoint returns an empty object, not a user array.
      return Response.json(USERS.values());
    }
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`listening on http://localhost:${PORT}`);
