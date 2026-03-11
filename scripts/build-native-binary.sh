#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/custom-binaries"
WORK_DIR="$(mktemp -d)"

echo "[build-native-binary] Building custom audiotee binary with embedded Info.plist..."
echo "[build-native-binary] Work dir: $WORK_DIR"

mkdir -p "$OUTPUT_DIR"

# Clone audiotee source
cd "$WORK_DIR"
git clone --depth 1 https://github.com/nicktrienensfuzz/audiotee.git audiotee-src
cd audiotee-src

# Inject NSAudioCaptureUsageDescription via Info.plist
cat > Sources/audiotee/Info.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSAudioCaptureUsageDescription</key>
  <string>Flownote needs access to system audio to detect interview questions in real time.</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>Flownote needs microphone access for real-time audio processing.</string>
  <key>NSScreenCaptureDescription</key>
  <string>Flownote needs Screen &amp; System Audio Recording permission to capture system audio.</string>
</dict>
</plist>
PLIST

# Build universal binary
echo "[build-native-binary] Building arm64..."
swift build -c release --arch arm64 \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist \
  -Xlinker Sources/audiotee/Info.plist

echo "[build-native-binary] Building x86_64..."
swift build -c release --arch x86_64 \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist \
  -Xlinker Sources/audiotee/Info.plist

echo "[build-native-binary] Creating universal binary with lipo..."
lipo -create \
  ".build/arm64-apple-macosx/release/audiotee" \
  ".build/x86_64-apple-macosx/release/audiotee" \
  -output "$OUTPUT_DIR/audiotee"

chmod +x "$OUTPUT_DIR/audiotee"

echo "[build-native-binary] Verifying binary..."
lipo -info "$OUTPUT_DIR/audiotee"
file "$OUTPUT_DIR/audiotee"

echo "[build-native-binary] Cleaning up work dir..."
rm -rf "$WORK_DIR"

echo "[build-native-binary] Done. Binary at: $OUTPUT_DIR/audiotee"
