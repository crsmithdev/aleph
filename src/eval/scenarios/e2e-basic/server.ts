/**
 * Calculator HTTP server — has four arithmetic bugs.
 * Run: bun server.ts
 * Port: 3799 (or PORT env var)
 */
const PORT = parseInt(Bun.env.PORT ?? "3799");

const server = Bun.serve({
  port: PORT,
  fetch(req: Request): Response {
    const url = new URL(req.url);

    if (url.pathname === "/calculate") {
      const a = parseFloat(url.searchParams.get("a") ?? "0");
      const b = parseFloat(url.searchParams.get("b") ?? "0");
      const op = url.searchParams.get("op") ?? "";

      if (isNaN(a) || isNaN(b)) {
        return new Response(JSON.stringify({ error: "invalid numbers" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      let result: number;
      if (op === "add") {
        result = a - b; // BUG: should be a + b
      } else if (op === "subtract") {
        result = a + b; // BUG: should be a - b
      } else if (op === "multiply") {
        result = a / b; // BUG: should be a * b
      } else if (op === "divide") {
        if (b === 0) {
          return new Response(JSON.stringify({ error: "division by zero" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        result = a * b; // BUG: should be a / b
      } else {
        return new Response(JSON.stringify({ error: "unknown op, use: add subtract multiply divide" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Calculator server running on http://localhost:${server.port}`);
