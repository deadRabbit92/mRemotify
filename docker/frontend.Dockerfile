# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ .
COPY VERSION .

# Read version from VERSION file and build with it
RUN VITE_APP_VERSION=$(cat VERSION | tr -d '[:space:]') npm run build

# ---- Serve stage ----
FROM nginx:1.27-alpine AS runner

# Remove default nginx config to avoid conflicts
RUN rm -f /etc/nginx/conf.d/default.conf

# Create certs directory for optional TLS
RUN mkdir -p /etc/nginx/certs

COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV BACKEND_HOST=backend
ENV TLS_ENABLED=false
ENV APP_HOSTNAME=localhost
ENV TLS_CERT_FILE=/certs/tls.crt
ENV TLS_KEY_FILE=/certs/tls.key

EXPOSE 80 443

ENTRYPOINT ["/docker-entrypoint.sh"]
