#!/usr/bin/env bash
# Regenerates the PNG app icons from build/icon.svg. Needs rsvg-convert (librsvg).
# The PNGs are committed, so CI and packaging don't need this tool.
set -euo pipefail
cd "$(dirname "$0")/.."
for s in 16 24 32 48 64 128 256 512 1024; do
  rsvg-convert -w "$s" -h "$s" build/icon.svg -o "build/icons/${s}x${s}.png"
done
