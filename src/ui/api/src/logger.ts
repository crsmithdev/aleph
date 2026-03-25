import { Writable } from 'node:stream';

const LEVELS: Record<number, string> = {
  10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL',
};

function formatTime(epoch: number): string {
  const d = new Date(epoch);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function createLogStream(): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      try {
        const obj = JSON.parse(chunk.toString());
        const time = formatTime(obj.time);
        const level = LEVELS[obj.level] || 'INFO';
        const msg = obj.msg || '';

        if (level === 'ERROR' || level === 'FATAL') {
          process.stdout.write(`${time} [${level}] ${msg}\n`);
        } else if (level === 'WARN') {
          process.stdout.write(`${time} [WARN] ${msg}\n`);
        } else {
          process.stdout.write(`${time} ${msg}\n`);
        }
      } catch {
        process.stdout.write(chunk);
      }
      callback();
    },
  });
}
