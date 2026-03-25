#!/bin/sh
set -e

mkdir -p /etc/nginx/certs

if [ "$TLS_ENABLED" = "true" ]; then
  # Handle base64 inline cert if provided
  if [ -n "$TLS_CERT_B64" ]; then
    echo "$TLS_CERT_B64" | base64 -d > /etc/nginx/certs/tls.crt
    echo "$TLS_KEY_B64" | base64 -d > /etc/nginx/certs/tls.key
  else
    # Use file paths — copy to consistent internal location
    cp "$TLS_CERT_FILE" /etc/nginx/certs/tls.crt
    cp "$TLS_KEY_FILE" /etc/nginx/certs/tls.key
  fi
  chmod 600 /etc/nginx/certs/tls.key

  export NGINX_LISTEN="listen 443 ssl;"
  export NGINX_SSL_CONFIG="
    ssl_certificate /etc/nginx/certs/tls.crt;
    ssl_certificate_key /etc/nginx/certs/tls.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;"
  export NGINX_HTTP_REDIRECT="
server {
    listen 80;
    server_name ${APP_HOSTNAME:-localhost};
    return 301 https://\$host\$request_uri;
}"
else
  export NGINX_LISTEN="listen 80;"
  export NGINX_SSL_CONFIG=""
  export NGINX_HTTP_REDIRECT=""
fi

export APP_HOSTNAME="${APP_HOSTNAME:-localhost}"
export BACKEND_HOST="${BACKEND_HOST:-backend}"

envsubst '${APP_HOSTNAME} ${BACKEND_HOST} ${NGINX_LISTEN} ${NGINX_SSL_CONFIG} ${NGINX_HTTP_REDIRECT}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
