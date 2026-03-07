FROM node:lts-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/openclaw/package.json packages/adapters/openclaw/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/cli/node_modules ./cli/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/ui/node_modules ./ui/node_modules
COPY --from=deps /app/packages ./packages
COPY . .
RUN pnpm --filter @paperclipai/db generate
RUN pnpm --filter @paperclipai/db build
RUN pnpm --filter @paperclipai/shared build || true
RUN pnpm --filter @paperclipai/adapter-utils build || true
RUN pnpm --filter @paperclipai/adapter-claude-local build || true
RUN pnpm --filter @paperclipai/adapter-codex-local build || true
RUN pnpm --filter @paperclipai/adapter-cursor-local build || true
RUN pnpm --filter @paperclipai/adapter-openclaw build || true
RUN pnpm --filter @paperclipai/adapter-opencode-local build || true
RUN pnpm --filter @paperclipai/ui build
RUN pnpm --filter @paperclipai/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

# Replace exports from src/*.ts to dist/*.js in packages within the container so node runtime parses properly
RUN find packages -name "package.json" -exec sed -i -e 's|"./src/\(.*\)\.ts"|"./dist/\1.js"|g' {} +

RUN ls -la server/dist/ || echo "server/dist not found"

FROM node:20-bookworm-slim AS production
WORKDIR /app
# Copy built server
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/package.json ./server/
# Copy built UI
COPY --from=build /app/ui/dist ./ui/dist
COPY --from=build /app/ui/package.json ./ui/
# Copy shared packages
COPY --from=build /app/packages ./packages
# Copy cli
COPY --from=build /app/cli ./cli
# Copy root node_modules for shared deps
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/pnpm-lock.yaml ./

RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest

ENV NODE_ENV=production \
  HOME=/paperclip \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default \
  PAPERCLIP_CONFIG=/paperclip/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=public

RUN mkdir -p /paperclip/instances/default

EXPOSE 3100

CMD ["node", "server/dist/index.js"]