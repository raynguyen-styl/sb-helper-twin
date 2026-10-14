#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────────
# SMART Buddy twin — assemble this repository's .env (compose build args for smartbuddy-frontend) and
# client/.env (what `npm run dev` reads). Both are gitignored. It generates NO secrets and carries no
# backend credential: ClickHouse, the MCP key and the salt live in backend/.env (backend/bootstrap-env.sh).
#
# The four Solace values (the SAM chat transport; they ship in the browser bundle, so low-privilege
# demo credentials only) are resolved in this order:
#   1. VITE_SOLACE_* already exported in the environment;
#   2. an existing twin/.env (so a re-run is stable);
#   3. the pre-split monorepo's .env (SB_LEGACY_ENV, default $DATA_DIR/smart-buddy-data/.env) — the
#      values UAT uses today;
#   4. the shared local broker that atlantic-platform/common runs on every box: ws://localhost:8008,
#      message VPN + client-username `default` (see common/README.md — not secrets). The same values
#      hold wherever the common stack runs beside this repository, locally or in production.
# The Demo | Live chat routing keys (VITE_SB_DEFAULT_MODE and each mode's SAM request / response /
# error topics; not secrets) are resolved from the environment, then an existing twin/.env, then the
# shared-topic defaults (see DEPLOY.md "Demo and Live").
# No value is printed — only a checklist naming where each came from.
#
#   cd /data/sb-helper/twin && ./bootstrap-env.sh
#   # then review .env and build: docker compose up -d --build   (see DEPLOY.md)
# ─────────────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$REPO_DIR/.env"
LEGACY_ENV="${SB_LEGACY_ENV:-$DATA_DIR/smart-buddy-data/.env}"
LOCAL_BROKER_URL="ws://localhost:8008"   # atlantic-platform/common: Solace Web Messaging, on loopback
LOCAL_BROKER_IDENTITY="default"          # its message VPN, client-username and that user's credential
DEMO_TOPIC_BASE="STYL/iot/smartbuddy/system/shared/v1/sam/chat"        # the demo (ClickHouse) agent
LIVE_TOPIC_BASE="STYL/iot/smartbuddy-live/system/shared/v1/sam/chat"   # the live agent

# grab KEY FILE  → the value of KEY=… (last assignment wins; strips surrounding quotes + CR)
grab() {
  local key="$1" file="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" "$file" | tail -n1 \
    | sed -e 's/\r$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
# solace KEY DEFAULT  → "<source><TAB><value>" following the order in the header
solace() {
  local key="$1" default="$2" v
  v="${!key:-}";                     [ -n "$v" ] && { printf 'from environment\t%s' "$v"; return 0; }
  v="$(grab "$key" "$OUT")";        [ -n "$v" ] && { printf 'preserved (twin .env)\t%s' "$v"; return 0; }
  v="$(grab "$key" "$LEGACY_ENV")"; [ -n "$v" ] && { printf 'preserved (legacy monorepo .env)\t%s' "$v"; return 0; }
  printf 'default (shared local broker, atlantic-platform/common)\t%s' "$default"
}
# cfg KEY DEFAULT  → "<source><TAB><value>": the environment, then an existing twin/.env, then the default
cfg() {
  local key="$1" default="$2" v
  v="${!key:-}";              [ -n "$v" ] && { printf 'from environment\t%s' "$v"; return 0; }
  v="$(grab "$key" "$OUT")"; [ -n "$v" ] && { printf 'preserved (twin .env)\t%s' "$v"; return 0; }
  printf 'default\t%s' "$default"
}

r="$(solace VITE_SOLACE_URL "$LOCAL_BROKER_URL")";           URL_SRC="${r%%$'\t'*}";  SOL_URL="${r#*$'\t'}"
r="$(solace VITE_SOLACE_VPN "$LOCAL_BROKER_IDENTITY")";      VPN_SRC="${r%%$'\t'*}";  SOL_VPN="${r#*$'\t'}"
r="$(solace VITE_SOLACE_USER "$LOCAL_BROKER_IDENTITY")";     USER_SRC="${r%%$'\t'*}"; SOL_USER="${r#*$'\t'}"
r="$(solace VITE_SOLACE_PASSWORD "$LOCAL_BROKER_IDENTITY")"; PW_SRC="${r%%$'\t'*}";   SOL_PW="${r#*$'\t'}"

# ── Demo | Live chat routing (central-specs change dashboard-demo-live-modes) ────────────────────
r="$(cfg VITE_SB_DEFAULT_MODE demo)";                                MODE_SRC="${r%%$'\t'*}"; DEF_MODE="${r#*$'\t'}"
r="$(cfg VITE_SAM_DEMO_TOPIC_REQUEST  "$DEMO_TOPIC_BASE/request")";  DREQ_SRC="${r%%$'\t'*}"; DREQ="${r#*$'\t'}"
r="$(cfg VITE_SAM_DEMO_TOPIC_RESPONSE "$DEMO_TOPIC_BASE/response")"; DRES_SRC="${r%%$'\t'*}"; DRES="${r#*$'\t'}"
r="$(cfg VITE_SAM_DEMO_TOPIC_ERROR    "$DEMO_TOPIC_BASE/error")";    DERR_SRC="${r%%$'\t'*}"; DERR="${r#*$'\t'}"
r="$(cfg VITE_SAM_LIVE_TOPIC_REQUEST  "$LIVE_TOPIC_BASE/request")";  LREQ_SRC="${r%%$'\t'*}"; LREQ="${r#*$'\t'}"
r="$(cfg VITE_SAM_LIVE_TOPIC_RESPONSE "$LIVE_TOPIC_BASE/response")"; LRES_SRC="${r%%$'\t'*}"; LRES="${r#*$'\t'}"
r="$(cfg VITE_SAM_LIVE_TOPIC_ERROR    "$LIVE_TOPIC_BASE/error")";    LERR_SRC="${r%%$'\t'*}"; LERR="${r#*$'\t'}"
r="$(cfg VITE_SB_LIVE_URL /smartbuddy-live)";                         LURL_SRC="${r%%$'\t'*}"; LIVE_URL="${r#*$'\t'}"
unset r

if [ -f "$OUT" ]; then
  cp "$OUT" "$OUT.bak.$(date +%s)"
  echo "note: existing .env backed up; its Solace and mode values are preserved (see checklist)."
fi

umask 177   # .env → 600
cat > "$OUT" <<EOF
# SMART Buddy twin .env — generated by bootstrap-env.sh. DO NOT COMMIT. Re-run bootstrap-env.sh to refresh.
# Frontend build args only — no backend credential lives here (those are in backend/.env).

SB_FRONTEND_PORT=8097
VITE_SB_API_URL=/smartbuddy-api
VITE_KEYCLOAK_URL=https://iot-uat.styl.solutions/auth
VITE_KEYCLOAK_REALM=styl-iot
VITE_KEYCLOAK_CLIENT_ID=smart-buddy
# SAM chat transport (low-privilege demo creds; they ship in the browser bundle)
VITE_SOLACE_URL=$SOL_URL
VITE_SOLACE_VPN=$SOL_VPN
VITE_SOLACE_USER=$SOL_USER
VITE_SOLACE_PASSWORD=$SOL_PW
# Demo | Live chat routing (see DEPLOY.md "Demo and Live"): the mode a fresh browser opens in, and each
# mode's SAM request / response / error topics (the gateway rule on the mesh must match)
VITE_SB_DEFAULT_MODE=$DEF_MODE
VITE_SAM_DEMO_TOPIC_REQUEST=$DREQ
VITE_SAM_DEMO_TOPIC_RESPONSE=$DRES
VITE_SAM_DEMO_TOPIC_ERROR=$DERR
VITE_SAM_LIVE_TOPIC_REQUEST=$LREQ
VITE_SAM_LIVE_TOPIC_RESPONSE=$LRES
VITE_SAM_LIVE_TOPIC_ERROR=$LERR
# Live dashboard: the Sync API path (this nginx proxies it to the backend's smartbuddy-live-sync)
VITE_SB_LIVE_URL=$LIVE_URL

# shared docker network (override only if the platform compose project name differs)
BACKEND_NETWORK=solace-pubsub-geo-filtering_backend
EOF

# ── client/.env for local `npm run dev` (Vite reads it); the docker build uses the root .env ─────
cat > "$REPO_DIR/client/.env" <<EOF
# SMART Buddy frontend — local dev (Vite reads this). Generated by bootstrap-env.sh. DO NOT COMMIT.
VITE_SB_API_URL=/smartbuddy-api
VITE_KEYCLOAK_URL=https://iot-uat.styl.solutions/auth
VITE_KEYCLOAK_REALM=styl-iot
VITE_KEYCLOAK_CLIENT_ID=smart-buddy
VITE_SOLACE_URL=$SOL_URL
VITE_SOLACE_VPN=$SOL_VPN
VITE_SOLACE_USER=$SOL_USER
VITE_SOLACE_PASSWORD=$SOL_PW
VITE_SB_DEFAULT_MODE=$DEF_MODE
VITE_SAM_DEMO_TOPIC_REQUEST=$DREQ
VITE_SAM_DEMO_TOPIC_RESPONSE=$DRES
VITE_SAM_DEMO_TOPIC_ERROR=$DERR
VITE_SAM_LIVE_TOPIC_REQUEST=$LREQ
VITE_SAM_LIVE_TOPIC_RESPONSE=$LRES
VITE_SAM_LIVE_TOPIC_ERROR=$LERR
VITE_SB_LIVE_URL=$LIVE_URL
EOF

echo "wrote $OUT + client/.env (chmod 600). Values (none shown):"
echo "  ✓ VITE_SOLACE_URL       — $URL_SRC"
echo "  ✓ VITE_SOLACE_VPN       — $VPN_SRC"
echo "  ✓ VITE_SOLACE_USER      — $USER_SRC"
echo "  ✓ VITE_SOLACE_PASSWORD  — $PW_SRC"
echo "  ✓ VITE_SB_DEFAULT_MODE  — $MODE_SRC"
echo "  ✓ VITE_SAM_DEMO_TOPIC_REQUEST / _RESPONSE / _ERROR  — $DREQ_SRC / $DRES_SRC / $DERR_SRC"
echo "  ✓ VITE_SAM_LIVE_TOPIC_REQUEST / _RESPONSE / _ERROR  — $LREQ_SRC / $LRES_SRC / $LERR_SRC"
echo "  ✓ VITE_SB_LIVE_URL      — $LURL_SRC"
echo
echo "Next: docker compose up -d --build (see DEPLOY.md). Backend env: backend/bootstrap-env.sh."
