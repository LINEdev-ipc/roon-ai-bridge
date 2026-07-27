#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
export ROONIA_VALIDATION_TOKEN="$(
  sudo sed -n 's/^API_TOKEN=//p' /opt/roon-ai-bridge/.env | head -n1
)"
python3 probe_failures.py \
  --artifacts ./artifacts \
  --max-albums 2 \
  --output ./artifacts/probes/failed-sample.json \
  --case-id MBR-000506 \
  --case-id MBR-000534 \
  --case-id MBR-000548 \
  --case-id MBR-000662 \
  --case-id MBR-001017 \
  --case-id MBR-001103 \
  --case-id MBR-001180 \
  --case-id MBR-001274 \
  --case-id MBR-001331 \
  --case-id MBR-001357 \
  --case-id MBR-001434
