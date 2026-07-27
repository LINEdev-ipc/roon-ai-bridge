#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
export ROONIA_VALIDATION_TOKEN="$(
  sudo sed -n 's/^API_TOKEN=//p' /opt/roon-ai-bridge/.env | head -n1
)"
python3 probe_failures.py \
  --artifacts ./artifacts \
  --max-albums 3 \
  --output ./artifacts/probes/failed-brazil.json \
  --case-id MBR-001333 \
  --case-id MBR-001335 \
  --case-id MBR-001338 \
  --case-id MBR-001350 \
  --case-id MBR-001373 \
  --case-id MBR-001403
