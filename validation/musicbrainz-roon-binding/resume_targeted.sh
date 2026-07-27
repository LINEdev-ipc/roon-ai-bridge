#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <run-id> <source-results.jsonl>" >&2
  exit 2
fi

cd "$(dirname "$0")"
export ROONIA_VALIDATION_TOKEN="$(
  sudo sed -n 's/^API_TOKEN=//p' /opt/roon-ai-bridge/.env | head -n1
)"
python3 run_enhanced_validation.py \
  --artifacts ./artifacts \
  --output-root ./artifacts/targeted-runs \
  --source-results "$2" \
  --resume-run "$1"
