FROM node:20-alpine

WORKDIR /app

ENV HUSKY=0

COPY minha-api/package*.json ./
RUN npm install

COPY minha-api/tsconfig.json ./
COPY minha-api/src/ ./src/
COPY minha-api/scripts/ ./scripts/

RUN npm run build && test -f dist/server.js

# Produção usa PostgreSQL (DATABASE_URL); remove devDependencies após o build.
RUN npm prune --omit=dev --ignore-scripts

EXPOSE 3000

CMD ["node", "dist/server.js"]
