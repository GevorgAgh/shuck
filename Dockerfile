# Shuka — one container: Express serves the API + built React app, SQLite lives on a volume at /data.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 and sharp ship prebuilt Linux binaries, so no compiler or Python is needed:
# skip install scripts (which would try to compile from source) and check the binaries load.
RUN npm ci --ignore-scripts \
 && node -e "new (require('better-sqlite3'))(':memory:'); require('sharp'); console.log('native modules OK')"
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-slim
# Fonts so the seed script can render text into the placeholder product photos.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core sqlite3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./
COPY server ./server
COPY tests ./tests
EXPOSE 8080
# Migrations run on start (server/index.js); seeding is a one-off: fly ssh console -C "node server/seed.js"
CMD ["node", "server/index.js"]
