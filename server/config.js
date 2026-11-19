import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  port: Number(process.env.PORT || 3000),
  isProd: process.env.NODE_ENV === 'production',
  // The SQLite file, uploads and backups all live under DATA_DIR (a persistent volume in production).
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  get dbFile() { return path.join(this.dataDir, 'shuka.db'); },
  get uploadsDir() { return path.join(this.dataDir, 'uploads'); },
  get backupsDir() { return path.join(this.dataDir, 'backups'); },
  clientDist: path.join(root, 'client', 'dist'),
  sessionDays: 30,
  maxUploadBytes: 8 * 1024 * 1024, // 8 MB per image
  maxImagesPerProduct: 5,
  backupKeep: 7,
};
