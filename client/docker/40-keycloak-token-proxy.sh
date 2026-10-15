#!/bin/sh
# 40-keycloak-token-proxy.sh — run by the nginx image's entrypoint at container
# start (every *.sh in /docker-entrypoint.d/), BEFORE nginx loads its config.
#
# Copied from Bibo Bus's twin (uwb/transit/bibo-bus/twin/docker/), central-specs decision 0003.
#
# The dashboard logs in with a CONFIDENTIAL Keycloak client (`demo-application`):
# Keycloak only issues tokens when the client authenticates. A browser cannot
# hold a client secret — everything the bundle contains is public — so the
# token requests go to this container instead (`/auth/token`, see nginx.conf),
# and nginx adds the client's credentials (HTTP Basic, `client_secret_basic`)
# on the way to Keycloak. The secret lives only in the container's RUNTIME
# environment (KEYCLOAK_CLIENT_SECRET, set in the twin's .env on the VM): never a build
# arg, never in the image, never in the bundle.
#
# Writes /etc/nginx/keycloak-token.conf, included by the /auth/token location.
# Without a secret the proxy still forwards (a public client needs none), so
# the location always exists and nginx always starts.
set -eu

out=/etc/nginx/keycloak-token.conf
endpoint="${KEYCLOAK_TOKEN_ENDPOINT:-https://ciam-uat.styl.solutions/realms/demo/protocol/openid-connect/token}"
host=$(printf '%s' "$endpoint" | sed -E 's#^https?://([^/:]+).*#\1#')

umask 077
{
  echo "set \$kc_token_endpoint \"$endpoint\";"
  echo "proxy_pass \$kc_token_endpoint;"
  echo "proxy_set_header Host $host;"
  echo "proxy_ssl_server_name on;"
  echo "proxy_ssl_verify on;"
  echo "proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;"
  echo "proxy_ssl_verify_depth 4;"
  # Nothing of the visitor's own session travels to Keycloak.
  echo "proxy_set_header Cookie \"\";"
  # This is a server-to-server call, so it carries no browser origin: Keycloak
  # checks an Origin header against the client's Web Origins and refused the
  # visitor's with {"error":"Invalid origin"} (28 Sep 2026). The browser's own
  # request is same-origin to this container, so no CORS applies to it.
  echo "proxy_set_header Origin \"\";"
  echo "proxy_set_header Referer \"\";"
  if [ -n "${KEYCLOAK_CLIENT_SECRET:-}" ]; then
    basic=$(printf '%s:%s' "${KEYCLOAK_CLIENT_ID:-demo-application}" "$KEYCLOAK_CLIENT_SECRET" | base64 | tr -d '\n')
    echo "proxy_set_header Authorization \"Basic $basic\";"
  fi
} > "$out"

if [ -n "${KEYCLOAK_CLIENT_SECRET:-}" ]; then
  echo "40-keycloak-token-proxy: /auth/token -> $host (client credentials set)"
else
  echo "40-keycloak-token-proxy: /auth/token -> $host (no KEYCLOAK_CLIENT_SECRET: forwarding as a public client)"
fi
