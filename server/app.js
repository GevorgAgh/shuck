import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { renderPage } from './page.js';
import { config } from './config.js';
import { loadUser } from './lib/auth.js';
import { errorHandler, notFound } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';
import reviewRoutes from './routes/reviews.js';
import sellerRoutes from './routes/seller.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the host's HTTPS proxy
  app.use(compression()); // gzip HTML, JSON, JS and CSS

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Uploaded images are served as static files; only their paths live in SQLite.
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', immutable: true, fallthrough: false }));

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use(cookieParser());
  api.use(loadUser);
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(authRoutes, catalogRoutes, cartRoutes, orderRoutes, reviewRoutes, sellerRoutes);
  api.use((_req, _res, next) => next(notFound('No such API endpoint.')));
  api.use(errorHandler);
  app.use('/api', api);

  // The built React app. Hashed files in /assets never change, so they are cached for a year.
  if (fs.existsSync(config.clientDist)) {
    app.use(
      express.static(config.clientDist, {
        index: false,
        setHeaders: (res, file) => {
          res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
        },
      })
    );
    // Every other path is a client-side route: send the app shell with the first screen's data.
    app.get(/^\/(?!api\/|uploads\/).*/, cookieParser(), loadUser, renderPage);
  }

  app.use(errorHandler);
  return app;
}
