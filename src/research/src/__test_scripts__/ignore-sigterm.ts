// Test worker: ignores SIGTERM, must be SIGKILL'd.
// Used to test the supervisor's force-kill fallback.
process.on('SIGTERM', () => { /* ignored */ });
setInterval(() => {}, 60_000);
