import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, `run-${new Date().toISOString().slice(0, 10)}.log`);

let fileReady = false;

function ensureLogDir(): void {
  if (fileReady) return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    fileReady = true;
  } catch {
    // If the log directory cannot be created we still keep printing to console.
    fileReady = false;
  }
}

function write(level: string, message: string): void {
  const line = `[${new Date().toISOString()}] ${level.padEnd(5)} ${message}`;
  ensureLogDir();
  if (fileReady) {
    try {
      appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
    } catch {
      // Logging must never break the run.
    }
  }
}

export const logger = {
  info(message: string): void {
    console.log(message);
    write('INFO', message);
  },
  step(message: string): void {
    console.log(`  ${message}`);
    write('INFO', message);
  },
  warn(message: string): void {
    console.warn(`  ⚠️  ${message}`);
    write('WARN', message);
  },
  error(message: string): void {
    console.error(`  ❌ ${message}`);
    write('ERROR', message);
  },
  blank(): void {
    console.log('');
  },
  logFile: LOG_FILE,
};
