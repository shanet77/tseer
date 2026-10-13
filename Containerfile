FROM docker.io/library/node:26-alpine AS build
WORKDIR /src
RUN npm install --global pnpm@12.8.1
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm -r build \
 && pnpm --filter @tseer/tseer deploy --prod --legacy /out

FROM docker.io/library/node:26-alpine
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/.health || exit 1
CMD ["node", "dist/cli.js", "web"]
