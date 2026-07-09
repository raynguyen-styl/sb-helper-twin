# (C) Copyright 2008 STYL Solutions Pte. Ltd., All rights reserved.
# This source code and any compilation or derivative thereof is the sole property of STYL Solutions Pte. Ltd.
# and is provided pursuant to a Software License Agreement. This code is the proprietary information of
# STYL Solutions Pte. Ltd. and is confidential in nature. Its use and dissemination by any party other than
# STYL Solutions Pte. Ltd. is strictly limited by the confidential information provisions of the Agreement
# referenced above.
#
# SMART Buddy dashboard — static frontend (Vite build → nginx).
# Same two-stage pattern as the tree-digital-twin frontend, but with NO backend:
# the app reads its data from precomputed JSON that Vite bundles into the build
# at compile time (see src/main.js `import ... from './data/*.json'`), so the
# resulting dist/ is fully self-contained — no API, Ditto, InfluxDB, or Keycloak
# build args. Auth is applied at the shared nginx-proxy (Keycloak JWT), not here.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Optional build-time config — Vite bakes import.meta.env.VITE_* at build. ALL optional:
# with none set, Playback uses built-in demo data and the chat panel shows "offline"; the
# rest of the dashboard is unchanged (still reads its bundled JSON).
ARG VITE_SB_API_URL=
ARG VITE_SOLACE_URL=
ARG VITE_SOLACE_VPN=
ARG VITE_SOLACE_USER=
ARG VITE_SOLACE_PASSWORD=
ENV VITE_SB_API_URL=$VITE_SB_API_URL \
    VITE_SOLACE_URL=$VITE_SOLACE_URL \
    VITE_SOLACE_VPN=$VITE_SOLACE_VPN \
    VITE_SOLACE_USER=$VITE_SOLACE_USER \
    VITE_SOLACE_PASSWORD=$VITE_SOLACE_PASSWORD
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
