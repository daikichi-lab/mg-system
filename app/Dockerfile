# 戦略MG 本番アプリ（React+Express+node:sqlite）Docker イメージ
# ビルド→ランタイムの2段。DBは /data に永続（ボリューム推奨）。

# --- build ---
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime ---
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV MG_DB=/data/mg.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY server ./server
VOLUME ["/data"]
EXPOSE 3001
CMD ["node", "server/index.js"]
