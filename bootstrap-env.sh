#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────────
# SMART Buddy twin — assemble this repository's .env (compose build args for smartbuddy-frontend) and
# client/.env (what `npm run dev` reads). Both are gitignored. It generates NO secrets and carries no
# backend credential: the Postgres password lives in backend/.env (backend/bootstrap-env.sh).
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
# The chat's topic set (VITE_SAM_TOPIC_REQUEST / _RESPONSE / _ERROR; central-specs capability sam-chat,
# not secrets) is resolved from the environment, then an existing twin/.env's same key, then that file's
# pre-October VITE_SAM_LIVE_TOPIC_* key (so a box keeps the topics it used in Live mode), then the
# default: the topics the Redshift agent's gateway rule answers on.
# The login (STYL CIAM realm `demo`, client `demo-application`; central-specs decision 0003) is switched
# on for the docker build and off for `npm run dev` (the dev server has no token proxy). Its client
# secret, KEYCLOAK_CLIENT_SECRET, is a RUNTIME setting of the frontend container — never a build arg,
# never in client/.env — resolved from the environment, then an existing twin/.env; with neither it
# is left empty and marked MISSING (fill it in by hand; the login then fails until it is set).
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
TOPIC_BASE="STYL/iot/smartbuddy-live/system/shared/v1/sam/chat"   # the Redshift agent's gateway rule

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
# topic KEY OLDKEY DEFAULT  → "<source><TAB><value>": environment → existing twin/.env's KEY → its OLDKEY → default
topic() {
  local key="$1" old="$2" default="$3" v
  v="${!key:-}";               [ -n "$v" ] && { printf 'from environment\t%s' "$v"; return 0; }
  v="$(grab "$key" "$OUT")";  [ -n "$v" ] && { printf 'preserved (twin .env)\t%s' "$v"; return 0; }
  v="$(grab "$old" "$OUT")";  [ -n "$v" ] && { printf "carried over (twin .env $old)\t%s" "$v"; return 0; }
  printf 'default\t%s' "$default"
}

r="$(solace VITE_SOLACE_URL "$LOCAL_BROKER_URL")";           URL_SRC="${r%%$'\t'*}";  SOL_URL="${r#*$'\t'}"
r="$(solace VITE_SOLACE_VPN "$LOCAL_BROKER_IDENTITY")";      VPN_SRC="${r%%$'\t'*}";  SOL_VPN="${r#*$'\t'}"
r="$(solace VITE_SOLACE_USER "$LOCAL_BROKER_IDENTITY")";     USER_SRC="${r%%$'\t'*}"; SOL_USER="${r#*$'\t'}"
r="$(solace VITE_SOLACE_PASSWORD "$LOCAL_BROKER_IDENTITY")"; PW_SRC="${r%%$'\t'*}";   SOL_PW="${r#*$'\t'}"

# ── the chat's topic set (central-specs capability sam-chat) ────────────────────────────────────
r="$(topic VITE_SAM_TOPIC_REQUEST  VITE_SAM_LIVE_TOPIC_REQUEST  "$TOPIC_BASE/request")";  REQ_SRC="${r%%$'\t'*}"; REQ="${r#*$'\t'}"
r="$(topic VITE_SAM_TOPIC_RESPONSE VITE_SAM_LIVE_TOPIC_RESPONSE "$TOPIC_BASE/response")"; RES_SRC="${r%%$'\t'*}"; RES="${r#*$'\t'}"
r="$(topic VITE_SAM_TOPIC_ERROR    VITE_SAM_LIVE_TOPIC_ERROR    "$TOPIC_BASE/error")";    ERR_SRC="${r%%$'\t'*}"; ERR="${r#*$'\t'}"
unset r

# ── the login's client secret (runtime only): environment → existing twin/.env → MISSING ──────────
KC_SECRET="${KEYCLOAK_CLIENT_SECRET:-}"
if [ -n "$KC_SECRET" ]; then KC_SRC="SET (from environment)"
else
  KC_SECRET="$(grab KEYCLOAK_CLIENT_SECRET "$OUT")"
  if [ -n "$KC_SECRET" ]; then KC_SRC="SET (preserved, twin .env)"
  else KC_SRC="MISSING — fill in by hand (the demo-application client's secret; see DEPLOY.md §4)"; fi
fi

if [ -f "$OUT" ]; then
  cp "$OUT" "$OUT.bak.$(date +%s)"
  echo "note: existing .env backed up; its Solace, topic and client-secret values are preserved (see checklist)."
fi

umask 177   # .env → 600
cat > "$OUT" <<EOF
# SMART Buddy twin .env — generated by bootstrap-env.sh. DO NOT COMMIT. Re-run bootstrap-env.sh to refresh.
# Frontend build args, plus the login's client secret (a runtime setting of the frontend container).
# No backend credential lives here (those are in backend/.env).

SB_FRONTEND_PORT=8097
VITE_SB_API_URL=/smartbuddy-api
# Login: STYL CIAM realm "demo", confidential client "demo-application" (central-specs decision 0003)
VITE_KEYCLOAK_ENABLED=true
VITE_KEYCLOAK_OIDC_CONFIG_URL=https://ciam-uat.styl.solutions/realms/demo/.well-known/openid-configuration
VITE_KEYCLOAK_CLIENT_ID=demo-application
VITE_KEYCLOAK_TOKEN_PROXY=auth/token
# Runtime only (the container's /auth/token proxy adds it; never a build arg, never in the bundle)
KEYCLOAK_TOKEN_ENDPOINT=https://ciam-uat.styl.solutions/realms/demo/protocol/openid-connect/token
KEYCLOAK_CLIENT_SECRET=$KC_SECRET
# SAM chat transport (low-privilege demo creds; they ship in the browser bundle)
VITE_SOLACE_URL=$SOL_URL
VITE_SOLACE_VPN=$SOL_VPN
VITE_SOLACE_USER=$SOL_USER
VITE_SOLACE_PASSWORD=$SOL_PW
# The chat's Solace topics — one set (see DEPLOY.md "The chat"): the request topic the agent's gateway
# rule subscribes to, and the response / error topics it answers on
VITE_SAM_TOPIC_REQUEST=$REQ
VITE_SAM_TOPIC_RESPONSE=$RES
VITE_SAM_TOPIC_ERROR=$ERR

# shared docker network (override only if the platform compose project name differs)
BACKEND_NETWORK=solace-pubsub-geo-filtering_backend
EOF

# ── client/.env for local `npm run dev` (Vite reads it); the docker build uses the root .env ─────
cat > "$REPO_DIR/client/.env" <<EOF
# SMART Buddy frontend — local dev (Vite reads this). Generated by bootstrap-env.sh. DO NOT COMMIT.
VITE_SB_API_URL=/smartbuddy-api
# No login under the dev server: it has no /auth/token proxy for the confidential client
VITE_KEYCLOAK_ENABLED=false
VITE_SOLACE_URL=$SOL_URL
VITE_SOLACE_VPN=$SOL_VPN
VITE_SOLACE_USER=$SOL_USER
VITE_SOLACE_PASSWORD=$SOL_PW
VITE_SAM_TOPIC_REQUEST=$REQ
VITE_SAM_TOPIC_RESPONSE=$RES
VITE_SAM_TOPIC_ERROR=$ERR
EOF

echo "wrote $OUT + client/.env (chmod 600). Values (none shown):"
echo "  ✓ VITE_SOLACE_URL       — $URL_SRC"
echo "  ✓ VITE_SOLACE_VPN       — $VPN_SRC"
echo "  ✓ VITE_SOLACE_USER      — $USER_SRC"
echo "  ✓ VITE_SOLACE_PASSWORD  — $PW_SRC"
echo "  ✓ VITE_SAM_TOPIC_REQUEST / _RESPONSE / _ERROR  — $REQ_SRC / $RES_SRC / $ERR_SRC"
echo "  ✓ VITE_KEYCLOAK_*       — CIAM realm demo, client demo-application (login on; off in client/.env)"
[ "${KC_SRC%% *}" = MISSING ] && mark="✗" || mark="✓"
echo "  $mark KEYCLOAK_CLIENT_SECRET — $KC_SRC"
echo
echo "Next: docker compose up -d --build (see DEPLOY.md). Backend env: backend/bootstrap-env.sh."
