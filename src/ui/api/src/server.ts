import { lstatSync } from 'fs';
import { claudePaths } from '@construct/data';
import { config } from './config.js';

function isLinked(): boolean {
  try { return lstatSync(claudePaths.construct).isSymbolicLink(); } catch { return false; }
}

if (isLinked()) {
  await import('./dev-server.js');
} else {
  const { createApp } = await import('./app.js');
  const app = await createApp();
  await app.listen({ port: config.port, host: config.host });
}
