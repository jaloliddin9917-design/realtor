# Build the SPA, serve the static output with Caddy (which also proxies /api — see
# deploy/Caddyfile, bind-mounted by compose; no COPY of it here needs a second context).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
