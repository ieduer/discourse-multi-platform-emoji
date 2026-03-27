#!/usr/bin/env bash
# upload_to_r2.sh — Upload emoji directory tree to Cloudflare R2
#
# Usage:
#   ./upload_to_r2.sh ./r2_tree discourse-emoji-assets [--dry-run]
#
# Requires: wrangler (npm install -g wrangler) with R2 access configured
# Or: aws cli configured for R2 S3-compatible endpoint
#
# The directory structure under r2_tree/ maps directly to R2 object keys:
#   r2_tree/twemoji/grinning.png → discourse-emoji-assets/twemoji/grinning.png

set -euo pipefail

SOURCE_DIR="${1:?Usage: $0 <source_dir> <bucket_name> [--dry-run]}"
BUCKET="${2:?Usage: $0 <source_dir> <bucket_name> [--dry-run]}"
DRY_RUN="${3:-}"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "ERROR: Source directory not found: $SOURCE_DIR"
  exit 1
fi

# Detect upload method
if command -v wrangler &>/dev/null; then
  UPLOAD_METHOD="wrangler"
elif command -v aws &>/dev/null; then
  UPLOAD_METHOD="aws"
else
  echo "ERROR: Neither wrangler nor aws CLI found"
  exit 1
fi

echo "Upload method: $UPLOAD_METHOD"
echo "Source: $SOURCE_DIR"
echo "Bucket: $BUCKET"
echo ""

# Count total files
TOTAL=$(find "$SOURCE_DIR" -type f -name "*.png" -o -name "*.svg" | wc -l | tr -d ' ')
echo "Total files to upload: $TOTAL"
echo ""

upload_wrangler() {
  local file="$1"
  local key="$2"

  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  [DRY RUN] $key"
    return
  fi

  wrangler r2 object put "${BUCKET}/${key}" --file="$file" --content-type="image/png" 2>/dev/null
}

upload_aws() {
  local file="$1"
  local key="$2"

  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  [DRY RUN] $key"
    return
  fi

  # R2 S3-compatible endpoint — adjust account ID
  aws s3 cp "$file" "s3://${BUCKET}/${key}" \
    --endpoint-url "https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com" \
    --content-type "image/png" \
    --quiet
}

uploaded=0
failed=0

for set_dir in "$SOURCE_DIR"/*/; do
  set_name=$(basename "$set_dir")
  count=$(find "$set_dir" -maxdepth 1 -type f | wc -l | tr -d ' ')
  echo "=== $set_name ($count files) ==="

  for file in "$set_dir"*.png "$set_dir"*.svg; do
    [ -f "$file" ] || continue

    filename=$(basename "$file")
    key="${set_name}/${filename}"

    if [ "$UPLOAD_METHOD" = "wrangler" ]; then
      if upload_wrangler "$file" "$key"; then
        uploaded=$((uploaded + 1))
      else
        failed=$((failed + 1))
        echo "  ✗ $key"
      fi
    else
      if upload_aws "$file" "$key"; then
        uploaded=$((uploaded + 1))
      else
        failed=$((failed + 1))
        echo "  ✗ $key"
      fi
    fi

    # Progress every 500 files
    if [ $((uploaded % 500)) -eq 0 ] && [ $uploaded -gt 0 ]; then
      echo "  ... $uploaded/$TOTAL uploaded"
    fi
  done
done

echo ""
echo "=== Upload Summary ==="
echo "  Uploaded: $uploaded"
echo "  Failed:   $failed"
echo "  Total:    $TOTAL"

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo ""
  echo "(This was a dry run. Remove --dry-run to actually upload.)"
fi
