# Build de producción de la API (copia el monorepo necesario para workspaces).
# Variante Debian + cron del sistema (estilo CRA): `Dockerfile.api-with-debian-cron`.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
COPY scripts ./scripts
RUN npm install
RUN npm run build -w @radioflow/shared
WORKDIR /app/apps/api
ARG DATABASE_URL="postgresql://radioflow:radioflow_dev@localhost:5432/radioflow"
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate && npx prisma generate --schema=prisma/standalone/schema.prisma && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
RUN npm install --omit=dev
WORKDIR /app/apps/api
RUN npx prisma generate && npx prisma generate --schema=prisma/standalone/schema.prisma
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/packages/shared/dist ../packages/shared/dist
EXPOSE 4000
CMD ["node", "dist/index.js"]
