# Build from the repo root: docker build -f apps/server/Dockerfile .
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@12.15.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --prod --filter "@look-studio/server..."

COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src

USER node
EXPOSE 8080
# Node 24 strips types natively; shared is resolved through its realpath, so no build step is needed.
CMD ["node", "apps/server/src/index.ts"]
