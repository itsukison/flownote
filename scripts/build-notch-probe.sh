#!/usr/bin/env bash
# Builds the notch geometry probe (see agent/docs/notch-overlay-plan.md §0.5 F5).
#
# Electron cannot read notch geometry — no safeAreaInsets on Display, nothing on `screen`.
# This ~40-line Swift binary reads NSScreen.safeAreaInsets + auxiliaryTopLeft/RightArea and
# prints one JSON line. electron/services/notchGeometry.ts uses it when present and falls
# back to a heuristic when it isn't, so this build step is optional for development.
#
# To ship it, add to package.json build.mac.extraResources:
#   { "from": "custom-binaries/notchinfo", "to": "notchinfo" }
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "[build-notch-probe] macOS only — skipping."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/custom-binaries"

mkdir -p "$OUTPUT_DIR"

echo "[build-notch-probe] Building notchinfo..."
swiftc -O "$SCRIPT_DIR/notch-probe/notchinfo.swift" -o "$OUTPUT_DIR/notchinfo"
chmod +x "$OUTPUT_DIR/notchinfo"

echo "[build-notch-probe] Done: $OUTPUT_DIR/notchinfo"
"$OUTPUT_DIR/notchinfo"
