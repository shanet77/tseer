FROM docker.io/library/node:26-slim AS build
WORKDIR /src
RUN npm install --global pnpm@12.8.1
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm -r build \
 && pnpm --filter @tseer/tseer deploy --prod --legacy /out

FROM docker.io/library/node:26-slim
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/.health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/cli.js", "web"]
