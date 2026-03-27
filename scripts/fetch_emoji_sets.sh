#!/usr/bin/env bash
# fetch_emoji_sets.sh — Download open-source emoji sets and Discourse emoji mapping
#
# Usage: ./fetch_emoji_sets.sh [--platforms twemoji,noto,fluent,openmoji] [--size 72] [--output ./build]
#
# Requires: curl, unzip, tar, jq

set -euo pipefail

PLATFORMS="${1:-twemoji,noto,fluent,openmoji}"
SIZE="${2:-72}"
OUTPUT_DIR="${3:-./build}"

TWEMOJI_VERSION="v14.0.2"
OPENMOJI_VERSION="16.0.0"

mkdir -p "$OUTPUT_DIR"/{twemoji,noto,fluent,openmoji,mapping}

echo "=== Fetching Discourse emoji name mapping ==="
curl -sSL "https://raw.githubusercontent.com/discourse/discourse/main/lib/emoji/db.json" \
  -o "$OUTPUT_DIR/mapping/discourse_emoji_db.json"
echo "  → Saved discourse_emoji_db.json"

# Also fetch the simpler extractor format if available
curl -sSL "https://raw.githubusercontent.com/nicolo-ribaudo/tc39-emoji-db/main/emoji-data.json" \
  -o "$OUTPUT_DIR/mapping/unicode_emoji_data.json" 2>/dev/null || true

fetch_twemoji() {
  echo ""
  echo "=== Fetching Twemoji ${TWEMOJI_VERSION} ==="
  local tmp_dir
  tmp_dir=$(mktemp -d)

  curl -sSL "https://github.com/twitter/twemoji/archive/refs/tags/${TWEMOJI_VERSION}.tar.gz" \
    -o "$tmp_dir/twemoji.tar.gz"
  tar xzf "$tmp_dir/twemoji.tar.gz" -C "$tmp_dir"

  # Copy PNG assets at requested size
  local src_dir="$tmp_dir/twemoji-$(echo $TWEMOJI_VERSION | tr -d 'v')/assets/${SIZE}x${SIZE}"
  if [ -d "$src_dir" ]; then
    cp "$src_dir"/*.png "$OUTPUT_DIR/twemoji/" 2>/dev/null || true
    echo "  → Copied $(ls "$OUTPUT_DIR/twemoji/" | wc -l) PNG files (${SIZE}x${SIZE})"
  else
    echo "  ! Size ${SIZE}x${SIZE} not found, trying 72x72"
    src_dir="$tmp_dir/twemoji-$(echo $TWEMOJI_VERSION | tr -d 'v')/assets/72x72"
    cp "$src_dir"/*.png "$OUTPUT_DIR/twemoji/" 2>/dev/null || true
    echo "  → Copied $(ls "$OUTPUT_DIR/twemoji/" | wc -l) PNG files (72x72)"
  fi

  # Also copy SVGs
  mkdir -p "$OUTPUT_DIR/twemoji/svg"
  cp "$tmp_dir/twemoji-$(echo $TWEMOJI_VERSION | tr -d 'v')/assets/svg/"*.svg "$OUTPUT_DIR/twemoji/svg/" 2>/dev/null || true

  rm -rf "$tmp_dir"
  echo "  ✓ Twemoji done"
}

fetch_noto() {
  echo ""
  echo "=== Fetching Noto Emoji ==="
  local tmp_dir
  tmp_dir=$(mktemp -d)

  # Noto distributes as individual PNGs in the repo
  # Use the 72x72 PNGs from the latest release
  local latest_tag
  latest_tag=$(curl -sSL "https://api.github.com/repos/googlefonts/noto-emoji/releases/latest" | jq -r '.tag_name')
  echo "  Latest release: ${latest_tag}"

  curl -sSL "https://github.com/googlefonts/noto-emoji/archive/refs/tags/${latest_tag}.tar.gz" \
    -o "$tmp_dir/noto.tar.gz"
  tar xzf "$tmp_dir/noto.tar.gz" -C "$tmp_dir"

  local noto_dir="$tmp_dir/noto-emoji-$(echo $latest_tag | tr -d 'v')"

  # Noto has PNGs under png/ with emoji_u prefix
  if [ -d "$noto_dir/png/72" ]; then
    cp "$noto_dir/png/72/"*.png "$OUTPUT_DIR/noto/" 2>/dev/null || true
  elif [ -d "$noto_dir/png" ]; then
    find "$noto_dir/png" -name "*.png" -exec cp {} "$OUTPUT_DIR/noto/" \; 2>/dev/null || true
  fi

  # Copy SVGs
  mkdir -p "$OUTPUT_DIR/noto/svg"
  if [ -d "$noto_dir/svg" ]; then
    find "$noto_dir/svg" -name "*.svg" -exec cp {} "$OUTPUT_DIR/noto/svg/" \; 2>/dev/null || true
  fi

  echo "  → Copied $(ls "$OUTPUT_DIR/noto/"*.png 2>/dev/null | wc -l) PNG files"
  rm -rf "$tmp_dir"
  echo "  ✓ Noto done"
}

fetch_fluent() {
  echo ""
  echo "=== Fetching Fluent Emoji (Microsoft) ==="
  local tmp_dir
  tmp_dir=$(mktemp -d)

  # Fluent Emoji is large; clone shallow with only flat assets
  git clone --depth 1 --filter=blob:none --sparse \
    "https://github.com/microsoft/fluentui-emoji.git" "$tmp_dir/fluent" 2>/dev/null || {
    echo "  ! git sparse-checkout failed, trying full download..."
    curl -sSL "https://github.com/microsoft/fluentui-emoji/archive/refs/heads/main.tar.gz" \
      -o "$tmp_dir/fluent.tar.gz"
    tar xzf "$tmp_dir/fluent.tar.gz" -C "$tmp_dir"
    mv "$tmp_dir/fluentui-emoji-main" "$tmp_dir/fluent"
  }

  # Extract flat SVGs and convert metadata
  find "$tmp_dir/fluent/assets" -name "Flat" -type d | while read -r flat_dir; do
    # Get the parent folder name which contains the unicode codepoint info
    local emoji_dir
    emoji_dir=$(dirname "$flat_dir")
    local metadata="$emoji_dir/metadata.json"

    if [ -f "$metadata" ]; then
      local unicode
      unicode=$(jq -r '.unicode // empty' "$metadata" 2>/dev/null)
      if [ -n "$unicode" ]; then
        # Normalize: remove U+, lowercase, join with -
        local normalized
        normalized=$(echo "$unicode" | tr ' ' '\n' | sed 's/^[Uu]+//' | tr '[:upper:]' '[:lower:]' | paste -sd '-')
        # Copy flat SVG
        local flat_svg
        flat_svg=$(find "$flat_dir" -name "*.svg" | head -1)
        if [ -n "$flat_svg" ]; then
          cp "$flat_svg" "$OUTPUT_DIR/fluent/${normalized}.svg"
        fi
      fi
    fi
  done

  echo "  → Copied $(ls "$OUTPUT_DIR/fluent/"*.svg 2>/dev/null | wc -l) flat SVG files"
  rm -rf "$tmp_dir"
  echo "  ✓ Fluent done"
}

fetch_openmoji() {
  echo ""
  echo "=== Fetching OpenMoji ${OPENMOJI_VERSION} ==="
  local tmp_dir
  tmp_dir=$(mktemp -d)

  # OpenMoji provides pre-built packages in releases
  curl -sSL "https://github.com/hfg-gmuend/openmoji/releases/download/${OPENMOJI_VERSION}/openmoji-72x72-color.zip" \
    -o "$tmp_dir/openmoji.zip"
  unzip -q "$tmp_dir/openmoji.zip" -d "$tmp_dir/openmoji-png" 2>/dev/null || true

  # Copy PNGs (OpenMoji uses UPPERCASE codepoints, we normalize to lowercase)
  for f in "$tmp_dir/openmoji-png/"*.png; do
    [ -f "$f" ] || continue
    local base
    base=$(basename "$f")
    local lower
    lower=$(echo "$base" | tr '[:upper:]' '[:lower:]')
    cp "$f" "$OUTPUT_DIR/openmoji/$lower"
  done

  echo "  → Copied $(ls "$OUTPUT_DIR/openmoji/"*.png 2>/dev/null | wc -l) PNG files"
  rm -rf "$tmp_dir"
  echo "  ✓ OpenMoji done"
}

# Execute selected platforms
IFS=',' read -ra PLAT_ARRAY <<< "$PLATFORMS"
for plat in "${PLAT_ARRAY[@]}"; do
  case "$plat" in
    twemoji) fetch_twemoji ;;
    noto)    fetch_noto ;;
    fluent)  fetch_fluent ;;
    openmoji) fetch_openmoji ;;
    *) echo "Unknown platform: $plat" ;;
  esac
done

echo ""
echo "=== Summary ==="
for plat in "${PLAT_ARRAY[@]}"; do
  count=$(find "$OUTPUT_DIR/$plat" -maxdepth 1 -type f 2>/dev/null | wc -l)
  echo "  $plat: $count files"
done
echo ""
echo "Output directory: $OUTPUT_DIR"
echo "Done."
