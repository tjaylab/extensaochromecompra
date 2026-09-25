# Build from the repository root:  docker build -f apps/api/Dockerfile -t compras-api .
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/extension/package.json apps/extension/
RUN npm ci -w @compras/api -w @compras/shared --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app/apps/api
EXPOSE 8787
# Migrations run on boot.
CMD ["npx", "tsx", "src/server.ts"]
