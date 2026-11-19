import { config } from './config.js';
import { getDb } from './db.js';
import { migrate } from './migrate.js';
import { createApp } from './app.js';
import { scheduleDailyBackup } from './backup.js';

const db = getDb();
migrate(db);
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());

const server = createApp().listen(config.port, () => {
  console.log(`Shuka listening on http://localhost:${config.port} (data: ${config.dataDir})`);
});
scheduleDailyBackup();

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
