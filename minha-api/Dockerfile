FROM node:20-alpine

WORKDIR /app

ENV HUSKY=0

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm run build && test -f dist/server.js

# Produção usa PostgreSQL (DATABASE_URL); remove devDependencies após o build.
RUN npm prune --omit=dev --ignore-scripts

EXPOSE 3000

CMD ["node", "dist/server.js"]
