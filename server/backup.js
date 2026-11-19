// Daily backup with VACUUM INTO: a consistent copy of the live database, safe while the app runs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDb } from './db.js';

export function backupNow(db = getDb()) {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(config.backupsDir, `shuka-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  // Keep only the newest N backups.
  const all = fs.readdirSync(config.backupsDir).filter((f) => /^shuka-.*\.db$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(all.length - config.backupKeep, 0))) fs.rmSync(path.join(config.backupsDir, old));
  return file;
}

function lastBackupAge() {
  if (!fs.existsSync(config.backupsDir)) return Infinity;
  const files = fs.readdirSync(config.backupsDir).filter((f) => /^shuka-.*\.db$/.test(f));
  if (!files.length) return Infinity;
  const newest = Math.max(...files.map((f) => fs.statSync(path.join(config.backupsDir, f)).mtimeMs));
  return Date.now() - newest;
}

/** Runs a backup at start-up if the last one is older than a day, then checks every hour. */
export function scheduleDailyBackup() {
  const DAY = 864e5;
  const tick = () => {
    try {
      if (lastBackupAge() >= DAY) console.log('backup: wrote', backupNow());
    } catch (e) {
      console.error('backup failed', e);
    }
  };
  setTimeout(tick, 10_000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('backup: wrote', backupNow());
}
