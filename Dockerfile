ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS base
ARG APT_MIRROR=
WORKDIR /app
RUN if [ -n "$APT_MIRROR" ]; then sed -i "s|http://deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; fi \
  && apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/src ./src
COPY --chown=node:node --from=build /app/scripts ./scripts
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/tsconfig.json ./tsconfig.json
COPY --chown=node:node --from=build /app/next.config.ts ./next.config.ts
RUN mkdir -p /app/.data/uploads && chown node:node /app/.data /app/.data/uploads
USER node
EXPOSE 3000
CMD ["npm", "start"]
