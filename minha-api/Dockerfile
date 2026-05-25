FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# Produção usa PostgreSQL (DATABASE_URL); sqlite3 não é necessário no runtime.
RUN npm install --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/server.js"]
