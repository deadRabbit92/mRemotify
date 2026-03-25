# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-alpine AS builder

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

EXPOSE 3000

# Migrate schema, seed admin user, then start the server
CMD ["sh", "-c", \
  "node_modules/.bin/prisma migrate deploy && \
   node dist/seed.js && \
   node dist/index.js"]
