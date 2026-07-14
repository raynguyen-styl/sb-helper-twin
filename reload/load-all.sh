#!/usr/bin/env bash
# load-all.sh — full ordered reload of the smartbuddy datasets from an unzipped bundle.
# Prereq: DB wiped + re-inited (RELOAD_RUNBOOK.md §2), images rebuilt (§1), smartbuddy-ingest running.
# Usage:  bash reload/load-all.sh /path/to/unzipped/bundle
# ORDER MATTERS: schools before transactions (pb_schools rebuild joins txn↔schools).
set -euo pipefail
B="${1:?usage: load-all.sh <bundle-dir>}"
VL="scripts/vm-load.sh"

run() { echo ">>> $*"; bash "$VL" "$@"; }

run "$B/schools.csv"                                 schools          2026-02 replace 1
run "$B/feb/feb_transactions.csv"                    transactions     2026-02 replace 1
run "$B/feb/feb_health_data.csv"                     health           2026-02 replace 1
run "$B/feb/feb_heart_rate.csv"                      heart_rate       2026-02 replace 1
run "$B/march/march2026_transactions.csv"            transactions     2026-03 replace 1
run "$B/march/march2026_student_items.csv"           items            2026-03 replace 1
run "$B/march/march2026_student_saving_spending.csv" saving_spending  2026-03 replace 1

echo "All 7 datasets loaded. Now build insights (RELOAD_RUNBOOK.md §4)."
