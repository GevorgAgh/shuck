// Seed script: categories, 3 sellers, 45 products with generated photos, 2 demo buyers,
// and a few past orders + reviews so ratings and the seller dashboard have data.
//
//   node server/seed.js           seeds only if the database has no categories yet
//   node server/seed.js --reset   deletes the database and uploads first, then seeds
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { openDb } from './db.js';
import { migrate } from './migrate.js';
import { processImage } from './lib/images.js';

const reset = process.argv.includes('--reset');
const PASSWORD = process.env.SEED_PASSWORD || 'shuka12345';

if (reset) {
  for (const f of ['shuka.db', 'shuka.db-wal', 'shuka.db-shm']) fs.rmSync(path.join(config.dataDir, f), { force: true });
  fs.rmSync(config.uploadsDir, { recursive: true, force: true });
  console.log('seed: reset database and uploads');
}

const db = openDb();
migrate(db, { quiet: true });
if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n > 0) {
  console.log('seed: database already has data, skipping (use --reset to start over)');
  process.exit(0);
}

const CATEGORIES = [
  ['Electronics', 'electronics', 210],
  ['Phones & Tablets', 'phones-tablets', 200],
  ['Computers', 'computers', 225],
  ['Home & Kitchen', 'home-kitchen', 25],
  ['Fashion', 'fashion', 330],
  ['Beauty & Health', 'beauty-health', 300],
  ['Books', 'books', 40],
  ['Sports & Outdoors', 'sports-outdoors', 140],
  ['Toys & Kids', 'toys-kids', 50],
  ['Food & Drinks', 'food-drinks', 15],
  ['Handmade & Crafts', 'handmade-crafts', 10],
];

const SELLERS = [
  { email: 'ararat.electronics@example.com', name: 'Aram Petrosyan', phone: '+374 91 100001', store: 'Ararat Electronics' },
  { email: 'vernissage.crafts@example.com', name: 'Lilit Hakobyan', phone: '+374 93 100002', store: 'Vernissage Crafts' },
  { email: 'gyumri.home@example.com', name: 'Narek Sargsyan', phone: '+374 94 100003', store: 'Gyumri Home & Style' },
];
const BUYERS = [
  { email: 'anna.buyer@example.com', name: 'Anna Grigoryan', phone: '+374 99 200001' },
  { email: 'davit.buyer@example.com', name: 'Davit Mkrtchyan', phone: '+374 77 200002' },
];

// [category slug, seller index, title, price AMD, stock, description]
const PRODUCTS = [
  ['electronics', 0, 'Wireless Noise-Cancelling Headphones', 64900, 12, 'Over-ear Bluetooth 5.3 headphones with active noise cancelling, 40-hour battery and a foldable travel case.'],
  ['electronics', 0, 'Smart LED TV 43"', 189000, 5, 'Full HD smart TV with built-in streaming apps, two HDMI ports and a slim bezel design.'],
  ['electronics', 0, 'Portable Bluetooth Speaker', 22500, 20, 'Waterproof IPX7 speaker with deep bass, 12 hours of playtime and a strap for hiking.'],
  ['electronics', 0, 'Action Camera 4K', 79900, 7, 'Shoots 4K video at 30fps with image stabilisation. Comes with a waterproof case and mounts.'],
  ['electronics', 0, 'Smart Watch Fit Pro', 35900, 15, 'Fitness smart watch with heart-rate, sleep tracking, GPS and a bright AMOLED screen.'],
  ['phones-tablets', 0, 'Android Smartphone 128 GB', 129000, 9, '6.5" display, 50 MP camera, 5000 mAh battery and dual SIM. Unlocked for every Armenian network.'],
  ['phones-tablets', 0, 'Tablet 10" Wi-Fi 64 GB', 99000, 6, 'Lightweight tablet for video, reading and school work, with a 10-inch display and stereo speakers.'],
  ['phones-tablets', 0, 'Fast Charger 65W USB-C', 9900, 40, 'GaN charger with two USB-C and one USB-A port. Charges a laptop and a phone at the same time.'],
  ['phones-tablets', 0, 'Phone Case Clear Shockproof', 3500, 60, 'Transparent case with reinforced corners that protects your phone from drops.'],
  ['computers', 0, 'Laptop 15.6" Core i5 16 GB', 389000, 4, 'Everyday laptop with Core i5 processor, 16 GB RAM, 512 GB SSD and a Full HD screen.'],
  ['computers', 0, 'Mechanical Keyboard RGB', 27900, 14, 'Hot-swappable mechanical keyboard with brown switches and Armenian/English keycaps.'],
  ['computers', 0, 'Wireless Mouse Silent', 6500, 30, 'Quiet-click wireless mouse with a USB receiver and 18 months of battery life.'],
  ['computers', 0, '27" Monitor QHD IPS', 145000, 3, '27-inch QHD IPS monitor with 75 Hz refresh rate, thin bezels and height-adjustable stand.'],
  ['computers', 0, 'External SSD 1 TB', 49900, 10, 'Pocket-sized USB-C SSD with read speeds up to 1000 MB/s. Works with phones and laptops.'],
  ['handmade-crafts', 1, 'Hand-Carved Wooden Backgammon (Nardi)', 85000, 3, 'Traditional Armenian nardi board carved from walnut wood by a master from Vernissage.'],
  ['handmade-crafts', 1, 'Pomegranate Ceramic Plate', 14500, 10, 'Hand-painted ceramic wall plate with a pomegranate motif. Each one is unique.'],
  ['handmade-crafts', 1, 'Obsidian Pendant Necklace', 12000, 18, 'Polished Armenian obsidian pendant on a silver-tone chain.'],
  ['handmade-crafts', 1, 'Hand-Woven Wool Carpet 1×1.5 m', 240000, 2, 'Handmade wool carpet with a traditional Artsakh pattern, natural dyes.'],
  ['handmade-crafts', 1, 'Silver Filigree Earrings', 26000, 8, 'Delicate sterling silver earrings made with traditional filigree technique.'],
  ['handmade-crafts', 1, 'Duduk Souvenir Mini', 9500, 12, 'Small apricot-wood duduk, a beautiful gift and a playable instrument for beginners.'],
  ['food-drinks', 1, 'Dried Apricots 1 kg', 6800, 50, 'Sweet sun-dried apricots from the Ararat valley, no added sugar.'],
  ['food-drinks', 1, 'Armenian Herbal Tea Set', 5900, 35, 'Thyme, mint and mountain herbs collected in Syunik. Three bags of 50 g.'],
  ['food-drinks', 1, 'Gata Sweet Bread Box', 4500, 25, 'Traditional homemade gata with a buttery filling, baked fresh every week.'],
  ['food-drinks', 1, 'Pomegranate Wine 0.75 L', 7900, 20, 'Semi-sweet pomegranate wine from a family winery in Areni.'],
  ['food-drinks', 1, 'Sujukh Walnut Sweets', 5200, 30, 'Walnuts in thickened grape juice, a classic Armenian winter treat.'],
  ['books', 1, 'Armenian Cookbook: Family Recipes', 11500, 15, 'Over 120 recipes from dolma to gata, with photos and step-by-step instructions.'],
  ['books', 1, 'Learn Armenian: Beginner Course', 8900, 20, 'Textbook with audio links for learning the Armenian alphabet and everyday phrases.'],
  ['books', 1, 'Children\'s Picture Book: Mount Ararat Tales', 6500, 18, 'Illustrated folk tales for children aged 4–8.'],
  ['home-kitchen', 2, 'Copper Jazve Coffee Pot', 8500, 25, 'Hand-hammered copper jazve for brewing traditional Armenian coffee, 300 ml.'],
  ['home-kitchen', 2, 'Non-Stick Frying Pan 28 cm', 15900, 18, 'Granite-coated frying pan that works on gas, electric and induction stoves.'],
  ['home-kitchen', 2, 'Electric Kettle 1.7 L', 12900, 22, 'Stainless steel kettle with auto shut-off and a blue LED light.'],
  ['home-kitchen', 2, 'Cotton Bed Linen Set Double', 29900, 10, 'Soft 100% cotton bedding set: duvet cover, sheet and two pillowcases.'],
  ['home-kitchen', 2, 'Set of 6 Armenian Coffee Cups', 11000, 14, 'Porcelain coffee cups with saucers and a gold rim.'],
  ['home-kitchen', 2, 'Robot Vacuum Cleaner', 119000, 4, 'Smart robot vacuum with app control, auto-charging and a 120-minute runtime.'],
  ['fashion', 2, 'Men\'s Leather Belt', 9900, 30, 'Genuine leather belt with a brushed metal buckle. Made in Gyumri.'],
  ['fashion', 2, 'Women\'s Wool Scarf', 13500, 16, 'Warm knitted scarf of soft merino wool, perfect for Yerevan winters.'],
  ['fashion', 2, 'Classic White Sneakers', 32000, 12, 'Comfortable everyday sneakers with a leather upper and cushioned sole.'],
  ['fashion', 2, 'Winter Down Jacket', 69000, 6, 'Light and warm down jacket with a hood, water-repellent fabric.'],
  ['beauty-health', 2, 'Natural Apricot Kernel Oil 100 ml', 4900, 40, 'Cold-pressed apricot kernel oil for skin and hair care.'],
  ['beauty-health', 2, 'Electric Toothbrush Sonic', 17900, 12, 'Sonic toothbrush with 3 modes, a timer and 30-day battery life.'],
  ['beauty-health', 2, 'Herbal Soap Gift Set', 6900, 25, 'Six handmade soaps with lavender, rose and Armenian mountain herbs.'],
  ['sports-outdoors', 2, 'Hiking Backpack 40 L', 27500, 9, 'Durable backpack with rain cover — ready for the trails of Dilijan.'],
  ['sports-outdoors', 2, 'Yoga Mat 6 mm', 8900, 20, 'Non-slip TPE yoga mat with a carrying strap.'],
  ['sports-outdoors', 2, 'Adjustable Dumbbells 2×10 kg', 39000, 5, 'A pair of adjustable dumbbells for home workouts.'],
  ['toys-kids', 2, 'Wooden Building Blocks 100 pcs', 14900, 15, 'Colourful wooden blocks for creative play, safe paint, ages 2+.'],
  ['toys-kids', 2, 'Remote Control Car Off-Road', 21900, 8, 'Fast 4WD RC car with a rechargeable battery and 2.4 GHz remote.'],
  ['toys-kids', 2, 'Kids\' Puzzle: Map of Armenia', 5500, 20, '100-piece puzzle with the regions and landmarks of Armenia.'],
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function wrap(text, max = 18) {
  const lines = [];
  let line = '';
  for (const w of text.split(' ')) {
    if ((line + ' ' + w).trim().length > max && line) { lines.push(line); line = w; }
    else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/** A generated "product photo" (placeholder) — a coloured card with the product name. */
async function placeholder(title, category, hue, variant) {
  const h2 = (hue + 25 + variant * 35) % 360;
  const lines = wrap(title);
  const shapes = [
    `<circle cx="600" cy="600" r="${330 - variant * 30}" fill="hsla(${h2},70%,92%,0.35)"/>`,
    `<rect x="250" y="250" width="700" height="700" rx="${80 + variant * 60}" fill="hsla(${h2},70%,92%,0.3)" transform="rotate(${variant * 12} 600 600)"/>`,
    `<path d="M600 200 L1000 900 L200 900 Z" fill="hsla(${h2},70%,92%,0.3)"/>`,
  ][variant % 3];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},62%,52%)"/><stop offset="1" stop-color="hsl(${h2},58%,32%)"/>
    </linearGradient></defs>
    <rect width="1200" height="1200" fill="url(#g)"/>
    ${shapes}
    <text x="600" y="${600 - (lines.length - 1) * 45}" font-family="Helvetica, Arial, sans-serif" font-size="78" font-weight="700" fill="#fff" text-anchor="middle">
      ${lines.map((l, i) => `<tspan x="600" dy="${i ? 92 : 0}">${esc(l)}</tspan>`).join('')}
    </text>
    <text x="600" y="1110" font-family="Helvetica, Arial, sans-serif" font-size="40" fill="rgba(255,255,255,.85)" text-anchor="middle">${esc(category)} · view ${variant + 1}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

const iso = (daysAgo, hours = 0) => new Date(Date.now() - daysAgo * 864e5 - hours * 36e5).toISOString();

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);

  // Categories
  const catIds = {};
  const catHue = {};
  const catName = {};
  const insCat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)');
  for (const [name, slug, hue] of CATEGORIES) {
    catIds[slug] = insCat.run(name, slug).lastInsertRowid;
    catHue[slug] = hue;
    catName[slug] = name;
  }

  // Users
  const insUser = db.prepare('INSERT INTO users (email, password_hash, name, phone, store_name, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const sellerIds = SELLERS.map((s) => insUser.run(s.email, hash, s.name, s.phone, s.store, iso(120)).lastInsertRowid);
  const buyerIds = BUYERS.map((b) => insUser.run(b.email, hash, b.name, b.phone, null, iso(90)).lastInsertRowid);

  // Products + images (images are generated and resized first, outside any transaction)
  const insProduct = db.prepare(
    `INSERT INTO products (seller_id, category_id, title, description, price_amd, stock, is_published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  const insImage = db.prepare('INSERT INTO product_images (product_id, file_path, position) VALUES (?, ?, ?)');
  const productIds = [];
  for (let i = 0; i < PRODUCTS.length; i++) {
    const [slug, sellerIdx, title, price, stock, description] = PRODUCTS[i];
    const nImages = 2 + (i % 2); // 2 or 3 photos
    const paths = [];
    for (let v = 0; v < nImages; v++) {
      paths.push(await processImage(await placeholder(title, catName[slug], catHue[slug] + (i % 4) * 8, v), `${slug}-${i}-${v}.jpg`));
    }
    const created = iso(PRODUCTS.length - i, i % 7); // later in the list = newer
    db.transaction(() => {
      const id = insProduct.run(sellerIds[sellerIdx], catIds[slug], title, description, price, stock, created, created).lastInsertRowid;
      paths.forEach((p, pos) => insImage.run(id, p, pos));
      productIds.push(id);
    }).immediate();
  }

  // A few past orders through the same rules as checkout (stock decremented, history written).
  const placeOrder = (buyerIdx, lines, daysAgo, moves) =>
    db.transaction(() => {
      const buyerId = buyerIds[buyerIdx];
      const b = BUYERS[buyerIdx];
      const rows = lines.map(([pi, qty]) => ({ ...db.prepare('SELECT * FROM products WHERE id = ?').get(productIds[pi]), qty }));
      const total = rows.reduce((s, r) => s + r.price_amd * r.qty, 0);
      const ts = iso(daysAgo);
      const orderId = db
        .prepare(
          `INSERT INTO orders (buyer_id, recipient, phone, region, city, street, apartment, note, total_amd, request_key, created_at)
           VALUES (?, ?, ?, 'Yerevan', 'Yerevan', ?, ?, ?, ?, ?, ?)`
        )
        .run(buyerId, b.name, b.phone, buyerIdx ? 'Komitas Ave 12' : 'Abovyan St 5', buyerIdx ? '7' : '21', 'Call before delivery', total, `seed-${buyerIdx}-${daysAgo}-${lines[0][0]}`, ts)
        .lastInsertRowid;
      const bySeller = new Map();
      for (const r of rows) (bySeller.get(r.seller_id) || bySeller.set(r.seller_id, []).get(r.seller_id)).push(r);
      for (const [sellerId, items] of bySeller) {
        const subtotal = items.reduce((s, r) => s + r.price_amd * r.qty, 0);
        const soId = db.prepare(`INSERT INTO seller_orders (order_id, seller_id, status, subtotal_amd, updated_at) VALUES (?, ?, 'placed', ?, ?)`).run(orderId, sellerId, subtotal, ts).lastInsertRowid;
        for (const r of items) {
          const ok = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(r.qty, r.id, r.qty).changes;
          if (ok !== 1) throw new Error('seed: not enough stock for ' + r.title);
          db.prepare('INSERT INTO order_items (seller_order_id, product_id, title, unit_price_amd, quantity) VALUES (?, ?, ?, ?, ?)').run(soId, r.id, r.title, r.price_amd, r.qty);
        }
        db.prepare(`INSERT INTO status_history (seller_order_id, from_status, to_status, changed_by, created_at) VALUES (?, NULL, 'placed', ?, ?)`).run(soId, buyerId, ts);
        let from = 'placed';
        moves.forEach((to, k) => {
          const t = iso(daysAgo - (k + 1) * 0.5);
          db.prepare('UPDATE seller_orders SET status = ?, updated_at = ? WHERE id = ?').run(to, t, soId);
          db.prepare('INSERT INTO status_history (seller_order_id, from_status, to_status, changed_by, created_at) VALUES (?, ?, ?, ?, ?)').run(soId, from, to, to === 'cancelled' ? buyerId : sellerId, t);
          from = to;
        });
      }
      return rows;
    }).immediate();

  const delivered = ['confirmed', 'shipped', 'delivered'];
  placeOrder(0, [[0, 1], [15, 1]], 20, delivered);
  placeOrder(0, [[28, 2], [20, 1]], 12, delivered);
  placeOrder(1, [[0, 1], [28, 1]], 9, delivered);
  placeOrder(1, [[2, 1], [14, 1], [34, 1]], 6, delivered);
  placeOrder(0, [[5, 1]], 3, ['confirmed', 'shipped']);
  placeOrder(1, [[11, 1], [38, 2]], 2, ['confirmed']);
  placeOrder(0, [[44, 1], [16, 1]], 1, []);
  placeOrder(1, [[30, 1]], 4, ['cancelled']);

  const REVIEWS = [
    [0, 0, 5, 'Great sound and the noise cancelling really works on the metro.'],
    [0, 15, 4, 'Beautiful plate, arrived well packed. Colours slightly darker than the photo.'],
    [0, 28, 5, 'Makes perfect Armenian coffee. Fast delivery in Yerevan.'],
    [1, 0, 4, 'Comfortable for long use, battery lasts days.'],
    [1, 28, 4, 'Good quality copper, handle gets a bit warm.'],
    [1, 2, 5, 'Loud and clear, took it to Sevan and it survived the rain.'],
    [1, 14, 5, 'Stunning craftsmanship, a perfect gift.'],
    [0, 20, 5, 'Very tasty and fresh apricots!'],
    [1, 34, 3, 'Linen is soft but the colour faded after the first wash.'],
  ];
  const insReview = db.prepare('INSERT INTO reviews (product_id, buyer_id, rating, body, created_at) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    REVIEWS.forEach(([bi, pi, rating, body], k) => insReview.run(productIds[pi], buyerIds[bi], rating, body, iso(5 - k * 0.4)));
    db.prepare(
      `UPDATE products SET rating_count = (SELECT COUNT(*) FROM reviews r WHERE r.product_id = products.id),
                           rating_avg = COALESCE((SELECT ROUND(AVG(rating), 2) FROM reviews r WHERE r.product_id = products.id), 0)`
    ).run();
  }).immediate();

  console.log(`seed: ${CATEGORIES.length} categories, ${SELLERS.length} sellers, ${BUYERS.length} buyers, ${PRODUCTS.length} products, 8 orders, ${REVIEWS.length} reviews`);
  console.log(`seed: every demo account uses the password from SEED_PASSWORD (default in README)`);
}

main()
  .then(() => db.close())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
