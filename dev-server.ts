#!/usr/bin/env bun
// Dev server — delegates to server.ts with NODE_ENV=development
process.env.NODE_ENV = 'development';
await import('./src/ui/api/src/server.js');
