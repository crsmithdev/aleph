// Load .env from ~/aleph/.env (project root)
// Must be imported before any other module that reads process.env.
import { readFileSync } from 'fs';
import { resolve } from 'path';
try {
  const envPath = resolve(process.env.HOME ?? '', 'aleph', '.env');
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env — keys must be set externally */ }
