#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
export ROONIA_VALIDATION_TOKEN="$(
  sudo sed -n 's/^API_TOKEN=//p' /opt/roon-ai-bridge/.env | head -n1
)"
python3 run_enhanced_validation.py \
  --artifacts ./artifacts \
  --output-root ./artifacts/enhanced-runs
