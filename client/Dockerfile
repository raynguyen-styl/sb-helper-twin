# (C) Copyright 2008 STYL Solutions Pte. Ltd., All rights reserved.
# This source code and any compilation or derivative thereof is the sole property of STYL Solutions Pte. Ltd.
# and is provided pursuant to a Software License Agreement. This code is the proprietary information of
# STYL Solutions Pte. Ltd. and is confidential in nature. Its use and dissemination by any party other than
# STYL Solutions Pte. Ltd. is strictly limited by the confidential information provisions of the Agreement
# referenced above.
#
# SMART Buddy dashboard — frontend (Vite build → nginx), tree-digital-twin pattern.
# Every window reads the proxied read API (VITE_SB_API_URL) and the chat panel talks to the agents
# over Solace. The STYL CIAM login (VITE_KEYCLOAK_*, central-specs decision 0003) gates the app in
# live deploys. All VITE_* are baked at build time; the login's client secret is NOT one of them — it
# is a runtime setting (KEYCLOAK_CLIENT_SECRET) read by docker/40-keycloak-token-proxy.sh at start.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Build-time config — Vite bakes import.meta.env.VITE_* into the bundle. All optional for local dev:
# with none set the app runs without login, Playback uses bundled demo data, and chat shows "offline".
ARG VITE_SB_API_URL=
# The login: on only when "true"; the realm's discovery URL; the client; the token proxy's path.
ARG VITE_KEYCLOAK_ENABLED=false
ARG VITE_KEYCLOAK_OIDC_CONFIG_URL=https://ciam-uat.styl.solutions/realms/demo/.well-known/openid-configuration
ARG VITE_KEYCLOAK_CLIENT_ID=demo-application
ARG VITE_KEYCLOAK_TOKEN_PROXY=auth/token
ARG VITE_SOLACE_URL=
ARG VITE_SOLACE_VPN=
ARG VITE_SOLACE_USER=
ARG VITE_SOLACE_PASSWORD=
# The chat's Solace topics — one set (central-specs capability sam-chat). Empty = the code's default:
# STYL/iot/smartbuddy-live/system/shared/v1/sam/chat/{request,response,error}.
ARG VITE_SAM_TOPIC_REQUEST=
ARG VITE_SAM_TOPIC_RESPONSE=
ARG VITE_SAM_TOPIC_ERROR=
ENV VITE_SB_API_URL=$VITE_SB_API_URL \
    VITE_KEYCLOAK_ENABLED=$VITE_KEYCLOAK_ENABLED \
    VITE_KEYCLOAK_OIDC_CONFIG_URL=$VITE_KEYCLOAK_OIDC_CONFIG_URL \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID \
    VITE_KEYCLOAK_TOKEN_PROXY=$VITE_KEYCLOAK_TOKEN_PROXY \
    VITE_SOLACE_URL=$VITE_SOLACE_URL \
    VITE_SOLACE_VPN=$VITE_SOLACE_VPN \
    VITE_SOLACE_USER=$VITE_SOLACE_USER \
    VITE_SOLACE_PASSWORD=$VITE_SOLACE_PASSWORD \
    VITE_SAM_TOPIC_REQUEST=$VITE_SAM_TOPIC_REQUEST \
    VITE_SAM_TOPIC_RESPONSE=$VITE_SAM_TOPIC_RESPONSE \
    VITE_SAM_TOPIC_ERROR=$VITE_SAM_TOPIC_ERROR
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
# Writes the /auth/token include from the RUNTIME environment at container start (the nginx image runs
# every /docker-entrypoint.d/*.sh first); the client secret is never a build arg and never in the image.
COPY docker/40-keycloak-token-proxy.sh /docker-entrypoint.d/40-keycloak-token-proxy.sh
RUN chmod +x /docker-entrypoint.d/40-keycloak-token-proxy.sh
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
