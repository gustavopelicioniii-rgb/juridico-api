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
RUN npm install --omit=dev --ignore-scripts

COPY --from=builder /app/node_modules/sqlite3 ./node_modules/sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/server.js"]
