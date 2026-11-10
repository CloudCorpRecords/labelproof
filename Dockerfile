# labelproof container image (GHCR).
# Runs the same bin as the npm package: dist/cli.js.
# Default command is "mcp", so `docker run -i <image>` starts a stdio MCP server;
# any other arguments are passed to the CLI.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["mcp"]
LABEL org.opencontainers.image.source="https://github.com/CloudCorpRecords/labelproof" \
      org.opencontainers.image.description="labelproof: read-only EU energy-label preflight checks against supplier-declared EPREL records, forwarded to the hosted preflight service. One bin serves the CLI and a stdio MCP server." \
      org.opencontainers.image.licenses="MIT" \
      io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/labelproof"
