FROM node:20-alpine

WORKDIR /app

ENV HUSKY=0

COPY package*.json ./
RUN npm install --include=dev

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm run build \
  && node -e "require('fs').accessSync('/app/dist/server.js')" \
  && ls -la dist

# Produção usa PostgreSQL (DATABASE_URL); remove devDependencies após o build.
RUN npm prune --omit=dev --ignore-scripts \
  && node -e "require('fs').accessSync('/app/dist/server.js')"

EXPOSE 3000

CMD ["node", "dist/server.js"]
