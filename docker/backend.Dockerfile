# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-alpine AS builder

# The Prisma CLI picks the engine binaries to download by probing the OpenSSL
# version, which on Alpine means shelling out to `openssl version -v`. Without
# the openssl package that probe fails and it silently falls back to the
# `linux-musl` (OpenSSL 1.1) engines, while the runtime stage - which does have
# openssl - resolves to `linux-musl-openssl-3.0.x` and tries to download the
# missing engines from binaries.prisma.sh on every container start.
# Installing openssl here and pinning the target keeps both stages in sync so
# the engines are baked into the image and no download is needed at runtime.
RUN apk add --no-cache openssl

ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x

WORKDIR /app

# Install all dependencies (including devDeps for tsc, prisma CLI, tsx)
COPY backend/package*.json ./
RUN npm install

# Copy backend source files
COPY backend/prisma ./prisma
COPY backend/src ./src
COPY backend/tsconfig.json ./

# Generate Prisma client and compile TypeScript
RUN npx prisma generate
RUN npx tsc

# ---- Runtime stage ----
FROM node:20-alpine AS runner

# Prisma needs libssl on Alpine (musl)
RUN apk add --no-cache openssl

WORKDIR /app

# Copy only production runtime artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

# Fail the build - rather than the deployment - if the engines the CLI and the
# client need at runtime did not end up in the image.
RUN test -f node_modules/@prisma/engines/schema-engine-linux-musl-openssl-3.0.x \
 && test -f node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node

EXPOSE 3000

# Migrate schema, seed admin user, then start the server
CMD ["sh", "-c", \
  "node_modules/.bin/prisma migrate deploy && \
   node dist/seed.js && \
   node dist/index.js"]
