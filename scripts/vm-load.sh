#!/usr/bin/env bash
# vm-load.sh — fast VM-side ingest: scp -C a file to the VM (compressed on the wire), docker cp it into
# the smartbuddy-ingest container, load it straight into ClickHouse via ingest_core, then clean up.
# Avoids the chunked-HTTP-over-ssh-tunnel path (that tunnel serialises all streams through one TCP).
#   usage: vm-load.sh <local-file> <dataset> <month> [replace|append] [rebuild 0/1]
set -uo pipefail
KEY="${SB_KEY:-/c/Users/STYLSG/Desktop/iot-uat-20260427.pem}"
VM="${SB_VM:-ec2-user@13.212.144.30}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=no)
local="$1"; dataset="$2"; month="$3"; mode="${4:-replace}"; rebuild="${5:-1}"
base=$(basename "$local")
size=$(stat -c%s "$local" 2>/dev/null || stat -f%z "$local")
echo ">> $dataset $month ($mode, rebuild=$rebuild) <- $base ($((size/1000000)) MB)"
t0=$(date +%s)
scp -C -i "$KEY" -o StrictHostKeyChecking=no "$local" "$VM:/tmp/sb_stage" 2>/dev/null || { echo "  scp FAILED"; exit 1; }
t1=$(date +%s); echo "  transferred in $((t1-t0))s"
"${SSH[@]}" "$VM" "docker cp /tmp/sb_stage smartbuddy-ingest:/work/stage.csv && rm -f /tmp/sb_stage \
  && docker exec smartbuddy-ingest python ingest_core.py $dataset $month /work/stage.csv $mode $rebuild 2>&1 | tail -2 \
  && docker exec smartbuddy-ingest rm -f /work/stage.csv" 2>/dev/null
echo "  done in $(( $(date +%s)-t0 ))s"
