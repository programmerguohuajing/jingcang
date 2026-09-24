FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/control-api ./apps/control-api
COPY apps/console-web ./apps/console-web

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jingcang/contracts build \
 && pnpm --filter @jingcang/browser-catalog build \
 && pnpm --filter @jingcang/console-web build \
 && pnpm --filter @jingcang/control-api build

ENV NODE_ENV=production
EXPOSE 8088

CMD ["node", "apps/control-api/dist/server.js"]
