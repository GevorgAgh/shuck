// Applies numbered .sql files from server/migrations in order.
// The applied version is tracked in PRAGMA user_version, so no extra table is needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function migrate(db = getDb(), { quiet = false } = {}) {
  const current = db.pragma('user_version', { simple: true });
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  let applied = 0;
  for (const file of files) {
    const version = parseInt(file, 10);
    if (version <= current) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    }).immediate();
    applied++;
    if (!quiet) console.log(`migrate: applied ${file}`);
  }
  if (!quiet) console.log(`migrate: database at version ${db.pragma('user_version', { simple: true })} (${applied} applied)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate();
}
