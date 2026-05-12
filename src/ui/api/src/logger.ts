// Re-export from `@construct/logger` so peer packages can share the same logger.
export { log, createLogStream, createViteLogger } from '@construct/logger';
export type { LogEvent, LogLevel, ViteLogger } from '@construct/logger';
