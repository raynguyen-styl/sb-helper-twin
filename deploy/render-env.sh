#!/bin/sh
# render-env.sh — print the twin's .env from GitLab CI/CD variables (central-specs change ci-deploy-pipeline,
# decision 0009).
#
#   sh deploy/render-env.sh > .env      (the deploy-ssh-build component does this in deploy_staging)
#
# What bootstrap-env.sh assembles by hand on the VM, this writes in the deploy job, so the host's .env is replaced on
# every deploy and never edited there. The sign-in uses the presales-prototypes group's shared Keycloak client:
# KEYCLOAK_ISSUER (the realm's issuer URL, https://<host>/realms/<realm>), KEYCLOAK_CLIENT and KEYCLOAK_SECRET, mapped
# to the VITE_KEYCLOAK_* build arguments and the token proxy's runtime KEYCLOAK_* settings docker-compose.yml reads
# (central-specs decision 0003: realm demo, client demo-application, the secret only in the container's runtime
# environment). Optional project variables: STAGING_HOST_PORT (the published host port, 8097 when unset) and
# SHARED_NETWORK_NAME (the shared Docker network, the platform's when unset).
#
# No broker value and no backend credential is written here (decision 0007): the chat asks the backend's chat route,
# and the backend's deploy renders its own .env.
#
# A value is written single-quoted, so Compose takes it literally (no $ interpolation); a value holding a single quote
# or a newline is refused, naming the variable and never printing the value.
set -eu

: "${KEYCLOAK_ISSUER:?KEYCLOAK_ISSUER is not set (group CI/CD variable)}"
: "${KEYCLOAK_CLIENT:?KEYCLOAK_CLIENT is not set (group CI/CD variable)}"
: "${KEYCLOAK_SECRET:?KEYCLOAK_SECRET is not set (group CI/CD variable)}"

issuer="${KEYCLOAK_ISSUER%/}"

line() {
  case "$2" in
    *"'"* | *"
"*) echo "render-env: $1 holds a single quote or a newline; refusing to write it" >&2; exit 1 ;;
  esac
  printf "%s='%s'\n" "$1" "$2"
}

echo "# Written by deploy/render-env.sh in CI ($(date -u +%FT%TZ)); edits here are overwritten by the next deploy."
echo "# Frontend build args, plus the login's client secret (a runtime setting of the frontend container)."
line SB_FRONTEND_PORT "${STAGING_HOST_PORT:-8097}"
line VITE_SB_API_URL "/smartbuddy-api"
line VITE_KEYCLOAK_ENABLED "true"
line VITE_KEYCLOAK_OIDC_CONFIG_URL "$issuer/.well-known/openid-configuration"
line VITE_KEYCLOAK_CLIENT_ID "$KEYCLOAK_CLIENT"
line VITE_KEYCLOAK_TOKEN_PROXY "auth/token"
line KEYCLOAK_TOKEN_ENDPOINT "$issuer/protocol/openid-connect/token"
line KEYCLOAK_CLIENT_SECRET "$KEYCLOAK_SECRET"
line BACKEND_NETWORK "${SHARED_NETWORK_NAME:-solace-pubsub-geo-filtering_backend}"
