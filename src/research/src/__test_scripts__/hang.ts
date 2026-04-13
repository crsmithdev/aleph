// Test worker: runs indefinitely, exits cleanly on SIGTERM.
// Used to test graceful shutdown and SIGKILL fallback.
process.on('SIGTERM', () => {
  process.exit(0);
});
// Keep the process alive
setInterval(() => {}, 60_000);
