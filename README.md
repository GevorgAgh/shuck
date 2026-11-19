# Shuka — Amazon-style marketplace for Armenia

Shuka («շուկա», "market") is a multi-seller marketplace: anyone can register, sell products, and buy
from several sellers in one cart. Prices are in AMD, delivery is inside Armenia, payment is cash on delivery.

One Node.js process serves the REST JSON API **and** the built React app, and reads one SQLite file.

| Part      | Tech |
|-----------|------|
| Frontend  | React 19 + Vite + React Router (responsive, works on a phone) |
| Backend   | Node.js + Express 5, REST JSON API, every permission checked on the server |
| Database  | One SQLite file via better-sqlite3 — WAL mode, `foreign_keys = ON`, `busy_timeout = 5000`, STRICT tables |
| Images    | multer (memory) + sharp: type sniffed from the bytes, resized to a 400 px thumbnail and a 1200 px large WebP, saved in `uploads/` next to the database |
| Auth      | bcrypt-hashed passwords, httpOnly session cookie (sessions stored hashed in SQLite) |
| Hosting   | Dockerfile + `fly.toml` (Fly.io with a persistent volume) |

## Run it locally (one command)

Requires Node.js 22 or newer.

```bash
npm install && npm run dev
```

That migrates and seeds the database (only the first time), starts the API on http://localhost:3000 and
the Vite dev server on **http://localhost:5173** (open this one).

To run it like production instead (built frontend served by Express on http://localhost:3000):

```bash
npm install && npm run local
```

### Demo accounts (created by the seed script)

All seeded accounts use the password **`shuka12345`** (override with `SEED_PASSWORD=...`).

| Role   | Email | Store |
|--------|-------|-------|
| Seller | `ararat.electronics@example.com` | Ararat Electronics |
| Seller | `vernissage.crafts@example.com` | Vernissage Crafts |
| Seller | `gyumri.home@example.com` | Gyumri Home & Style |
| Buyer  | `anna.buyer@example.com` | — |
| Buyer  | `davit.buyer@example.com` | — |

The seed creates 11 categories, 3 sellers, 47 products with 2–3 generated photos each, 2 buyers,
8 past orders in different states and 9 reviews.

### Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | seed if empty, API with auto-restart + Vite dev server |
| `npm run local` | build frontend, seed if empty, start the production server |
| `npm start` | start the server (runs pending migrations first) |
| `npm run migrate` | apply numbered `.sql` files in `server/migrations/` |
| `npm run seed` / `npm run seed:reset` | seed an empty database / wipe database + uploads and seed again |
| `npm run backup` | write a backup now with `VACUUM INTO` |
| `npm run test:breakit` | run the 9 break-it tests against a running server |

## Break-it tests

Start the server, then in another terminal:

```bash
npm run test:breakit
```

Against the live site: `BASE_URL=https://<your-app>.fly.dev npm run test:breakit`.
One test only: `node tests/break-it.js --only "last units"`.

| Test | What the script does | Expected |
|------|---------------------|----------|
| Last units | product with stock 3; 30 buyers check out 1 unit each at the same time | exactly 3 orders, 27 × 409 naming the product, stock 0, no "database is locked" |
| Double click | same checkout twice in parallel with the same request key | one order (and another user reusing the key gets 409) |
| Price changed | buyer adds item, seller raises price, buyer checks out | 409 `PRICE_CHANGED` with the new price; second try uses the new price |
| Old order after edit | seller edits title and price of an ordered product | buyer's and seller's order still show old title and price |
| Someone else's order | seller A opens/changes seller B's order; buyer A opens/cancels buyer B's order | 404, no data |
| Move not allowed | placed → delivered; buyer (and seller) cancel a shipped order | 409, nothing changed, no history row |
| Cancel returns stock | buyer cancels a placed order | stock goes back up; cancelling twice → 409 |
| Foreign keys | inserts an `order_items` row for a product id that does not exist, directly in SQLite | `FOREIGN KEY constraint failed`; also STRICT type check and `ON DELETE RESTRICT` |
| Bad upload | uploads a 30 MB file and a renamed `.exe` | both 400 with a clear message, nothing stored |

The foreign-key test opens the SQLite file, so on Fly run it on the machine:
`fly ssh console -C "node tests/break-it.js --only foreign"`.

## How the hard parts are solved

1. **Overselling** — checkout (`server/routes/orders.js`) is one `BEGIN IMMEDIATE` transaction in plain SQL.
   Stock is reduced with `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?` and the changed-row
   count is checked; any failing line throws, rolling back the whole order, and the API answers 409 with the product name.
   Cancelling restores stock in the same transaction as the status change (`server/lib/orderStatus.js`).
2. **"Database is locked"** — every connection sets WAL mode and a 5 s busy timeout (`server/db.js`). Transactions are short:
   password hashing, image resizing and file writes all happen *before* the transaction starts.
3. **Prices change after purchase** — `order_items` copies title and unit price; `orders` copies the address.
   `cart_items.price_when_added` is compared with the current price at checkout; a difference stops checkout with 409
   and the new price.
4. **One cart, many sellers** — one `orders` row, one `seller_orders` row per seller, each with its own status and history.
5. **Status changes** — `ALLOWED_MOVES` in `server/lib/orderStatus.js` is the only place moves are decided; the status
   endpoint is the only way to change a status; every move inserts a `status_history` row (insert-only, enforced by triggers).
6. **Other people's data** — every query is scoped, e.g. `WHERE so.id = ? AND so.seller_id = ?`; misses return 404.
7. **Double checkout** — the checkout page sends a random `request_key`; `orders.request_key` is UNIQUE and a repeat
   returns the existing order. The Place order button also locks after one click.
8. **Broken references** — `PRAGMA foreign_keys = ON` on every connection; ordered products use `ON DELETE RESTRICT`
   and sellers can only unpublish.
9. **Images** — size limit 8 MB, format sniffed from the bytes by sharp (a renamed `.exe` fails), thumbnail + large
   WebP written to `DATA_DIR/uploads/products/`, only the path is stored in SQLite.

## Performance (Lighthouse 100)

Lighthouse scores 100 / 100 / 100 / 100 (Performance, Accessibility, Best Practices, SEO) on mobile and desktop
for the storefront, product, search, login, cart, checkout, orders and seller dashboard pages. How:

- `server/page.js` sends the app shell with the **first screen's data embedded** (categories, the signed-in user,
  the current page's products), so the page renders at once with no loading jumps (CLS 0) and no `/me` request.
- The CSS is **inlined** into the HTML (no render-blocking request) and the main product photo is **preloaded**.
- **gzip** on every response; hashed `/assets` files are cached for a year, photos for 30 days.
- Cart, checkout, orders and the seller dashboard are **code-split** and load on demand.
- Per-page `<title>` and meta description, `robots.txt`, a real 404 status for missing products, labelled controls
  and a correct heading order.

## Data model

Ten tables from the brief (`server/migrations/001_init.sql`) plus `sessions` (`002_sessions.sql`) for server-side logout.
Money is always an INTEGER number of dram; dates are ISO-8601 text; booleans are 0/1; all tables are STRICT.
The applied migration version is kept in `PRAGMA user_version`, so no extra bookkeeping table is needed.

`users · categories · products · product_images · cart_items · orders · seller_orders · order_items · status_history · reviews (+ sessions)`

## API

All endpoints live under `/api`. Errors always look like `{ "error": { "code", "message" } }`
(plus `fields` for per-field validation messages) with 400 / 401 / 403 / 404 / 409.

| Area | Endpoints | Who |
|------|-----------|-----|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /me`, `PATCH /me` | anyone / signed in |
| Catalog | `GET /categories`, `GET /products?q=&category=&minPrice=&maxPrice=&sort=&page=`, `GET /products/:id`, `GET /products/:id/reviews` | anyone |
| Cart | `GET /cart`, `PUT /cart/items/:productId` `{quantity}`, `DELETE /cart/items/:productId` | signed in |
| Checkout | `POST /orders` with `request_key` + address | signed in |
| Buyer orders | `GET /orders`, `GET /orders/:id`, `POST /orders/:id/sellers/:sellerOrderId/cancel` | owner of the order |
| Reviews | `POST /products/:id/reviews` `{rating, body}` | buyer with a delivered item |
| Seller | `POST /seller/activate`, `GET /seller/overview` | signed in / seller |
| Seller products | `GET, POST /seller/products`, `GET, PATCH /seller/products/:id`, `POST /seller/products/:id/images` (multipart `images`), `DELETE /seller/products/:id/images?imageId=` | seller, own products |
| Seller orders | `GET /seller/orders?status=`, `GET /seller/orders/:id`, `POST /seller/orders/:id/status` `{to}` | seller, own orders |

`sort` is one of `newest`, `price_asc`, `price_desc`, `rating`.

## Deploy to Fly.io

Serverless hosts lose the SQLite file on every deploy, so Shuka runs as a normal container with a volume.

```bash
fly auth login
fly launch --copy-config --no-deploy        # pick a unique app name, keep the config
fly volumes create shuka_data --size 1 --region fra
fly deploy
fly ssh console -C "node server/seed.js"    # one-time seed of demo data
```

- The database, `uploads/` and `backups/` live in `/data` on the volume (`DATA_DIR`).
- Migrations run automatically on every start.
- **Daily backup**: the server writes `backups/shuka-<timestamp>.db` with `VACUUM INTO` when the newest backup is
  older than 24 h (checked at start-up and every hour) and keeps the last 7. Manual: `fly ssh console -C "node server/backup.js"`.
- Secrets: none are required; anything secret goes in `fly secrets set NAME=value`, never in Git.
  `SEED_PASSWORD` can be set that way before seeding.

## Project layout

```
server/
  index.js            start-up: migrate, listen, schedule backups
  app.js              Express app: /api, /uploads, built frontend
  db.js               connection with WAL, foreign keys, busy timeout
  migrate.js          applies migrations/NNN_*.sql
  seed.js             demo data + generated product photos
  backup.js           VACUUM INTO backups
  lib/                auth, errors, validation, images, order status rules
  routes/             auth, catalog, cart, orders (checkout), reviews, seller
  migrations/         001_init.sql, 002_sessions.sql
client/src/           React app (storefront + seller dashboard)
tests/break-it.js     the 9 break-it tests
```
