# Build context: repository root (see docker-compose.yml)
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @notes/api... --prod=false
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /repo/apps/api
ENV NODE_ENV=production
# Named volume mounts here; owning it as node lets uploads be written.
RUN mkdir -p /data/assets && chown node:node /data/assets
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
