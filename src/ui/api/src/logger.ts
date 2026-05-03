// Backwards-compatible re-export. The implementation now lives in
// `@construct/logger` so peer packages (research, etc.) can call `log()` too.
export { log, createLogStream, createViteLogger, ingestChildLine } from '@construct/logger';
export type { LogEvent, LogLevel, ViteLogger } from '@construct/logger';
