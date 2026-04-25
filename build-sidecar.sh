#!/bin/bash
# Build the Swift sidecar and copy to src-tauri/binaries/ with Tauri naming convention
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SIDECAR_DIR="$SCRIPT_DIR/src-tauri/sidecar"
BINARIES_DIR="$SCRIPT_DIR/src-tauri/binaries"

# Detect target triple
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    TARGET_TRIPLE="aarch64-apple-darwin"
elif [ "$ARCH" = "x86_64" ]; then
    TARGET_TRIPLE="x86_64-apple-darwin"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

echo "Building vision-sidecar for $TARGET_TRIPLE..."

# Build Swift package in release mode
cd "$SIDECAR_DIR"
swift build -c release 2>&1

# Create binaries directory
mkdir -p "$BINARIES_DIR"

# Copy with Tauri naming convention: name-<target_triple>
BUILT_BINARY="$SIDECAR_DIR/.build/release/vision-sidecar"
DEST_BINARY="$BINARIES_DIR/vision-sidecar-${TARGET_TRIPLE}"

if [ ! -f "$BUILT_BINARY" ]; then
    echo "Error: Built binary not found at $BUILT_BINARY"
    echo "Contents of .build/release/:"
    ls -la "$SIDECAR_DIR/.build/release/" 2>/dev/null || echo "(directory not found)"
    exit 1
fi

cp "$BUILT_BINARY" "$DEST_BINARY"
echo "Copied sidecar to $DEST_BINARY"
echo "Build complete!"
