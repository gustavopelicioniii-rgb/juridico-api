FROM node:20-alpine AS builder

WORKDIR /app

ARG BUILD_DATE=2026-04-30
COPY minha-api/package*.json ./
RUN npm install

COPY minha-api/tsconfig.json ./
COPY minha-api/src/ ./src/
COPY minha-api/scripts/ ./scripts/

RUN npm run build

FROM node:20-alpine

WORKDIR /app

ARG BUILD_DATE=2026-04-30
COPY minha-api/package*.json ./
# Produção usa PostgreSQL (DATABASE_URL); sqlite3 não é necessário no runtime.
RUN npm install --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/server.js"]
