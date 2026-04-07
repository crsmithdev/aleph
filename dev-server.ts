#!/usr/bin/env bun
// Dev server — delegates to server.ts with NODE_ENV=development
process.env.NODE_ENV = 'development';
// Use a separate DB for dev so workers don't share state with prod
if (!process.env.CONSTRUCT_DB_PATH) {
  process.env.CONSTRUCT_DB_PATH = `${process.env.HOME}/.construct/construct-dev.db`;
}
await import('./src/ui/api/src/server.js');
