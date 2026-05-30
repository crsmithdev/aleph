// Re-export from `@aleph/logger` so peer packages can share the same logger.
export { log, createLogStream, createViteLogger } from '@aleph/logger';
export type { LogEvent, LogLevel, ViteLogger } from '@aleph/logger';
