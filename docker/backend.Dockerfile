# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:24-alpine AS builder

WORKDIR /app

# Install all dependencies (including devDeps for tsc, prisma CLI, tsx)
COPY backend/package*.json ./
RUN npm install

# Copy backend source files
COPY backend/prisma ./prisma
COPY backend/src ./src
COPY backend/tsconfig.json backend/prisma.config.ts ./

# Prisma 7 emits the client as TypeScript source (see prisma/schema.prisma), so
# it has to be generated before tsc runs — tsc then compiles it into dist/ along
# with the rest of the backend. There are no Rust engine binaries to fetch: the
# client talks to Postgres through the @prisma/adapter-pg driver adapter, which
# is what retired the openssl/binaryTargets juggling this file used to need.
RUN npx prisma generate
RUN npx tsc

# ---- Runtime stage ----
FROM node:24-alpine AS runner

WORKDIR /app

# Copy runtime artifacts. node_modules carries the Prisma CLI too — the start
# command below still runs `migrate deploy`.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/package.json ./

EXPOSE 3000

# Migrate schema, seed admin user, then start the server
CMD ["sh", "-c", \
  "node_modules/.bin/prisma migrate deploy && \
   node dist/seed.js && \
   node dist/index.js"]
