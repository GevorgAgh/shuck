import fs from 'node:fs';
import Database from 'better-sqlite3';
import { config } from './config.js';

/**
 * Open a connection with the settings the brief requires on EVERY connection:
 * WAL mode, foreign keys on, and a busy timeout so concurrent writers wait instead of crashing.
 */
export function openDb(file = config.dbFile) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

let shared;
export function getDb() {
  if (!shared) shared = openDb();
  return shared;
}

export const now = () => new Date().toISOString();
