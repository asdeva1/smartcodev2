# syntax=docker/dockerfile:1.7
# SmartCode API image (AWS ECS Fargate). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t smartcode-api .
# Targets:
#   runtime  (default) — API / worker; non-root, production dependencies only
#   migrator           — one-off task: `prisma migrate deploy` (needs the Prisma CLI)

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@smartcode/api
RUN pnpm --filter @smartcode/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/prisma /out/prisma

FROM build AS migrator
WORKDIR /repo/apps/api
USER node
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production APP_MODE=api PORT=4000
WORKDIR /app
# Apply the OS security fixes published since the base image was built (the image scan fails on fixable HIGH/CRITICAL).
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
