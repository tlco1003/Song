#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
kotlinc "$ROOT/app/src/main/java/ai/moment/pleos/BridgeContract.kt" \
  "$SCRIPT_DIR/BridgeContractTest.kt" -include-runtime -d "$OUT/test.jar"
java -jar "$OUT/test.jar"