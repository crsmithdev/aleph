---
name: test-webapp
description: Use when user wants to Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.
license: Complete terms in LICENSE.txt
---

# Web Application Testing

To test local web applications, write native TypeScript Playwright scripts.

**Helper Scripts Available**:
- `scripts/with-server.ts` - Manages server lifecycle (supports multiple servers)

**Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running the script first and find that a customized solution is abslutely necessary. These scripts can be very large and thus pollute your context window. They exist to be called directly as black-box scripts rather than ingested into your context window.

## Decision Tree: Choosing Your Approach

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write Playwright script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Run: bun scripts/with-server.ts --help
        │        Then use the helper + write simplified Playwright script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Navigate and wait for networkidle
            2. Take screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with discovered selectors
```

## Example: Using with-server.ts

To start a server, run `--help` first, then use the helper:

**Single server:**
```bash
bun scripts/with-server.ts --server "npm run dev" --port 3000 -- bun your_automation.ts
```

**Multiple servers (e.g., backend + frontend):**
```bash
bun scripts/with-server.ts \
  --server "cd backend && bun server.ts" --port 3000 \
  --server "cd frontend && npm run dev" --port 3000 \
  -- bun your_automation.ts
```

To create an automation script, include only Playwright logic (servers are managed automatically):
```typescript
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true }); // Always launch chromium in headless mode
const page = await browser.newPage();
await page.goto('http://localhost:3000'); // Server already running and ready
await page.waitForLoadState('networkidle'); // CRITICAL: Wait for JS to execute
// ... your automation logic
await browser.close();
```

## Reconnaissance-Then-Action Pattern

1. **Inspect rendered DOM**:
   ```typescript
   await page.screenshot({ path: '/tmp/inspect.png', fullPage: true });
   const content = await page.content();
   await page.locator('button').all();
   ```

2. **Identify selectors** from inspection results

3. **Execute actions** using discovered selectors

## Common Pitfall

❌ **Don't** inspect the DOM before waiting for `networkidle` on dynamic apps
✅ **Do** wait for `page.waitForLoadState('networkidle')` before inspection

## Best Practices

- **Use bundled scripts as black boxes** - To accomplish a task, consider whether one of the scripts available in `scripts/` can help. These scripts handle common, complex workflows reliably without cluttering the context window. Use `--help` to see usage, then invoke directly. 
- Use `async/await` with the Playwright TypeScript API
- Always close the browser when done
- Use descriptive selectors: `text=`, `role=`, CSS selectors, or IDs
- Add appropriate waits: `page.waitForSelector()` or `page.waitForTimeout()`

## Reference Files

- **examples/** - Examples showing common patterns:
  - `element-discovery.ts` - Discovering buttons, links, and inputs on a page
  - `static-html-automation.ts` - Using file:// URLs for local HTML
  - `console-logging.ts` - Capturing console logs during automation
