# (C) Copyright 2008 STYL Solutions Pte. Ltd., All rights reserved.
# This source code and any compilation or derivative thereof is the sole property of STYL Solutions Pte. Ltd.
# and is provided pursuant to a Software License Agreement. This code is the proprietary information of
# STYL Solutions Pte. Ltd. and is confidential in nature. Its use and dissemination by any party other than
# STYL Solutions Pte. Ltd. is strictly limited by the confidential information provisions of the Agreement
# referenced above.
#
# SMART Buddy dashboard — frontend (Vite build → nginx), tree-digital-twin pattern.
# The classic windows read precomputed JSON bundled at compile time; Playback reads the
# proxied sb-api (VITE_SB_API_URL) and the chat panel talks to SAM over Solace. Keycloak
# login (VITE_KEYCLOAK_*) gates the app in live deploys. All VITE_* are baked at build time.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Build-time config — Vite bakes import.meta.env.VITE_* into the bundle. All optional for local dev:
# with none set the app runs without login, Playback uses bundled demo data, and chat shows "offline".
ARG VITE_SB_API_URL=
ARG VITE_KEYCLOAK_URL=
ARG VITE_KEYCLOAK_REALM=styl-iot
ARG VITE_KEYCLOAK_CLIENT_ID=smart-buddy
ARG VITE_SOLACE_URL=
ARG VITE_SOLACE_VPN=
ARG VITE_SOLACE_USER=
ARG VITE_SOLACE_PASSWORD=
# Demo | Live chat routing (central-specs change dashboard-demo-live-modes). Empty = the code's defaults:
# demo → STYL/iot/smartbuddy/system/shared/v1/sam/chat/{request,response,error},
# live → STYL/iot/smartbuddy-live/system/shared/v1/sam/chat/{request,response,error}, default mode demo.
ARG VITE_SB_DEFAULT_MODE=
ARG VITE_SAM_DEMO_TOPIC_REQUEST=
ARG VITE_SAM_DEMO_TOPIC_RESPONSE=
ARG VITE_SAM_DEMO_TOPIC_ERROR=
ARG VITE_SAM_LIVE_TOPIC_REQUEST=
ARG VITE_SAM_LIVE_TOPIC_RESPONSE=
ARG VITE_SAM_LIVE_TOPIC_ERROR=
ENV VITE_SB_API_URL=$VITE_SB_API_URL \
    VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID \
    VITE_SOLACE_URL=$VITE_SOLACE_URL \
    VITE_SOLACE_VPN=$VITE_SOLACE_VPN \
    VITE_SOLACE_USER=$VITE_SOLACE_USER \
    VITE_SOLACE_PASSWORD=$VITE_SOLACE_PASSWORD \
    VITE_SB_DEFAULT_MODE=$VITE_SB_DEFAULT_MODE \
    VITE_SAM_DEMO_TOPIC_REQUEST=$VITE_SAM_DEMO_TOPIC_REQUEST \
    VITE_SAM_DEMO_TOPIC_RESPONSE=$VITE_SAM_DEMO_TOPIC_RESPONSE \
    VITE_SAM_DEMO_TOPIC_ERROR=$VITE_SAM_DEMO_TOPIC_ERROR \
    VITE_SAM_LIVE_TOPIC_REQUEST=$VITE_SAM_LIVE_TOPIC_REQUEST \
    VITE_SAM_LIVE_TOPIC_RESPONSE=$VITE_SAM_LIVE_TOPIC_RESPONSE \
    VITE_SAM_LIVE_TOPIC_ERROR=$VITE_SAM_LIVE_TOPIC_ERROR
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
