#!/usr/bin/env bun
/**
 * Start one or more servers, wait for them to be ready, run a command, then clean up.
 *
 * Usage:
 *     # Single server
 *     bun scripts/with-server.ts --server "npm run dev" --port 3000 -- bun automation.ts
 *     bun scripts/with-server.ts --server "npm start" --port 3000 -- bun test.ts
 *
 *     # Multiple servers
 *     bun scripts/with-server.ts \
 *       --server "cd backend && bun server.ts" --port 3000 \
 *       --server "cd frontend && npm run dev" --port 3000 \
 *       -- bun test.ts
 */

import * as net from 'node:net';
import { spawn } from 'node:child_process';

function isServerReady(port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();

    function attempt() {
      const socket = net.createConnection({ port, host: 'localhost' });

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start < timeout * 1000) {
          setTimeout(attempt, 500);
        } else {
          resolve(false);
        }
      });
    }

    attempt();
  });
}

function parseArgs(argv: string[]): {
  servers: string[];
  ports: number[];
  timeout: number;
  command: string[];
} {
  const servers: string[] = [];
  const ports: number[] = [];
  let timeout = 30;
  const command: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--server') {
      i++;
      if (i >= argv.length) {
        console.error('Error: --server requires a value');
        process.exit(1);
      }
      servers.push(argv[i]);
    } else if (arg === '--port') {
      i++;
      if (i >= argv.length) {
        console.error('Error: --port requires a value');
        process.exit(1);
      }
      const p = parseInt(argv[i], 10);
      if (isNaN(p)) {
        console.error(`Error: --port value must be a number, got: ${argv[i]}`);
        process.exit(1);
      }
      ports.push(p);
    } else if (arg === '--timeout') {
      i++;
      if (i >= argv.length) {
        console.error('Error: --timeout requires a value');
        process.exit(1);
      }
      timeout = parseInt(argv[i], 10);
      if (isNaN(timeout)) {
        console.error(`Error: --timeout value must be a number, got: ${argv[i]}`);
        process.exit(1);
      }
    } else if (arg === '--') {
      // Everything after -- is the command
      command.push(...argv.slice(i + 1));
      break;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: bun scripts/with-server.ts --server CMD --port PORT [--server CMD --port PORT ...] [--timeout N] -- command [args...]

Options:
  --server CMD    Server command to start (can be repeated)
  --port PORT     Port for each server (must match --server count)
  --timeout N     Timeout in seconds per server (default: 30)
  --              Separator before the command to run

Examples:
  bun scripts/with-server.ts --server "npm run dev" --port 3000 -- bun automation.ts
  bun scripts/with-server.ts \\
    --server "cd backend && bun server.ts" --port 3000 \\
    --server "cd frontend && npm run dev" --port 3000 \\
    -- bun test.ts`);
      process.exit(0);
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      process.exit(1);
    }
    i++;
  }

  return { servers, ports, timeout, command };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { servers, ports, timeout, command } = parseArgs(argv);

  if (servers.length === 0) {
    console.error('Error: At least one --server is required');
    process.exit(1);
  }

  if (command.length === 0) {
    console.error('Error: No command specified to run');
    process.exit(1);
  }

  if (servers.length !== ports.length) {
    console.error('Error: Number of --server and --port arguments must match');
    process.exit(1);
  }

  const serverConfigs = servers.map((cmd, i) => ({ cmd, port: ports[i] }));
  const serverProcesses: ReturnType<typeof spawn>[] = [];
  let exitCode = 0;

  try {
    // Start all servers
    for (let i = 0; i < serverConfigs.length; i++) {
      const server = serverConfigs[i];
      console.log(`Starting server ${i + 1}/${serverConfigs.length}: ${server.cmd}`);

      // Use shell: true to support commands with cd and &&
      const proc = spawn(server.cmd, [], { shell: true, stdio: 'pipe' });
      serverProcesses.push(proc);

      // Wait for this server to be ready
      console.log(`Waiting for server on port ${server.port}...`);
      const ready = await isServerReady(server.port, timeout);
      if (!ready) {
        throw new Error(`Server failed to start on port ${server.port} within ${timeout}s`);
      }

      console.log(`Server ready on port ${server.port}`);
    }

    console.log(`\nAll ${serverConfigs.length} server(s) ready`);

    // Run the command
    console.log(`Running: ${command.join(' ')}\n`);
    const [cmd, ...args] = command;
    exitCode = await new Promise<number>((resolve) => {
      const proc = spawn(cmd, args, { stdio: 'inherit' });
      proc.on('close', (code) => resolve(code ?? 0));
      proc.on('error', (err) => {
        console.error(`Error running command: ${err.message}`);
        resolve(1);
      });
    });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    exitCode = 1;
  } finally {
    // Clean up all servers
    console.log(`\nStopping ${serverProcesses.length} server(s)...`);
    for (let i = 0; i < serverProcesses.length; i++) {
      const proc = serverProcesses[i];
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve();
        }, 5000);

        proc.on('close', () => {
          clearTimeout(killTimer);
          resolve();
        });

        proc.kill('SIGTERM');
      });
      console.log(`Server ${i + 1} stopped`);
    }
    console.log('All servers stopped');
  }

  process.exit(exitCode);
}

main();
