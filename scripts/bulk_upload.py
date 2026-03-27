#!/usr/bin/env python3
"""
bulk_upload.py — Bulk upload custom emoji to Discourse via Admin API.

Reads the emoji manifest produced by build_emoji_index.py and uploads each
emoji as a custom emoji with platform prefix and group.

Usage:
    python3 bulk_upload.py \
        --manifest ./build/emoji_manifest.json \
        --build-dir ./build \
        --discourse-url https://forum.rdfzer.com \
        --api-key <API_KEY> \
        --platforms twemoji,noto \
        --dry-run

Environment variables (alternative to flags):
    DISCOURSE_URL    — Forum base URL
    DISCOURSE_API_KEY — Admin API key
"""

import json
import os
import sys
import time
import argparse
import mimetypes
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: requests library required. Install with: pip install requests", file=sys.stderr)
    sys.exit(1)


class DiscourseEmojiUploader:
    def __init__(self, base_url: str, api_key: str, api_username: str = "system"):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.api_username = api_username
        self.session = requests.Session()
        self.session.headers.update({
            "Api-Key": self.api_key,
            "Api-Username": self.api_username,
        })

    def list_custom_emojis(self) -> set[str]:
        """Get set of existing custom emoji names."""
        resp = self.session.get(f"{self.base_url}/admin/customize/emojis.json")
        resp.raise_for_status()
        data = resp.json()

        names = set()
        if isinstance(data, list):
            for emoji in data:
                names.add(emoji.get("name", ""))
        elif isinstance(data, dict):
            for emoji in data.get("emojis", data.get("custom_emojis", [])):
                names.add(emoji.get("name", ""))

        return names

    def upload_emoji(self, name: str, image_path: str, group: str = None) -> dict:
        """Upload a single custom emoji."""
        mime_type = mimetypes.guess_type(image_path)[0] or "image/png"

        with open(image_path, "rb") as f:
            files = {
                "file": (f"{name}{Path(image_path).suffix}", f, mime_type),
            }
            data = {"name": name}
            if group:
                data["group"] = group

            resp = self.session.post(
                f"{self.base_url}/admin/customize/emojis.json",
                files=files,
                data=data,
            )

        if resp.status_code == 422:
            error = resp.json().get("errors", [resp.text])
            return {"error": error, "name": name, "status": "skipped"}
        elif resp.status_code == 429:
            # Rate limited — wait and retry
            retry_after = int(resp.headers.get("Retry-After", 10))
            print(f"  Rate limited, waiting {retry_after}s...")
            time.sleep(retry_after)
            return self.upload_emoji(name, image_path, group)

        resp.raise_for_status()
        return {"name": name, "status": "uploaded", "data": resp.json()}

    def delete_emoji(self, name: str) -> bool:
        """Delete a custom emoji by name."""
        resp = self.session.delete(f"{self.base_url}/admin/customize/emojis/{name}.json")
        return resp.status_code == 200


def main():
    parser = argparse.ArgumentParser(description="Bulk upload emoji to Discourse")
    parser.add_argument("--manifest", required=True, help="Path to emoji_manifest.json")
    parser.add_argument("--build-dir", default="./build", help="Build directory with emoji files")
    parser.add_argument("--discourse-url", default=os.environ.get("DISCOURSE_URL", ""),
                        help="Discourse base URL")
    parser.add_argument("--api-key", default=os.environ.get("DISCOURSE_API_KEY", ""),
                        help="Discourse Admin API key")
    parser.add_argument("--api-username", default="system", help="API username")
    parser.add_argument("--platforms", default="twemoji,noto,fluent,openmoji",
                        help="Comma-separated platforms to upload")
    parser.add_argument("--batch-size", type=int, default=20,
                        help="Emojis per batch before pausing")
    parser.add_argument("--batch-delay", type=float, default=2.0,
                        help="Seconds to wait between batches")
    parser.add_argument("--skip-existing", action="store_true", default=True,
                        help="Skip emoji that already exist (default: true)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be uploaded without actually uploading")
    parser.add_argument("--limit", type=int, default=0,
                        help="Limit total uploads (0 = unlimited)")
    args = parser.parse_args()

    if not args.discourse_url:
        print("ERROR: --discourse-url or DISCOURSE_URL env required", file=sys.stderr)
        sys.exit(1)
    if not args.api_key and not args.dry_run:
        print("ERROR: --api-key or DISCOURSE_API_KEY env required", file=sys.stderr)
        sys.exit(1)

    # Load manifest
    with open(args.manifest) as f:
        manifest = json.load(f)

    platforms = [p.strip() for p in args.platforms.split(",")]
    build_path = Path(args.build_dir)

    # Initialize uploader
    uploader = None
    existing_emojis = set()
    if not args.dry_run:
        uploader = DiscourseEmojiUploader(args.discourse_url, args.api_key, args.api_username)
        print("Fetching existing custom emojis...")
        existing_emojis = uploader.list_custom_emojis()
        print(f"  Found {len(existing_emojis)} existing custom emojis")

    # Process uploads
    total_uploaded = 0
    total_skipped = 0
    total_errors = 0
    batch_count = 0

    for platform in platforms:
        if platform not in manifest:
            print(f"\nSkipping {platform}: not in manifest")
            continue

        emojis = manifest[platform]
        print(f"\n{'=' * 50}")
        print(f"Platform: {platform} ({len(emojis)} emoji)")
        print(f"{'=' * 50}")

        for name, meta in emojis.items():
            discourse_name = meta["discourse_name"]
            file_path = build_path.parent / meta["file"] if not Path(meta["file"]).is_absolute() else Path(meta["file"])

            # Resolve relative to build dir
            if not file_path.exists():
                file_path = build_path / meta["file"]
            if not file_path.exists():
                file_path = build_path.parent / meta["file"]

            if not file_path.exists():
                print(f"  ✗ {discourse_name}: file not found ({meta['file']})")
                total_errors += 1
                continue

            if args.skip_existing and discourse_name in existing_emojis:
                total_skipped += 1
                continue

            if args.dry_run:
                print(f"  [DRY RUN] Would upload: {discourse_name} ← {file_path}")
                total_uploaded += 1
            else:
                try:
                    result = uploader.upload_emoji(discourse_name, str(file_path), group=platform)
                    if result.get("status") == "uploaded":
                        print(f"  ✓ {discourse_name}")
                        total_uploaded += 1
                    else:
                        print(f"  ⚠ {discourse_name}: {result.get('error', 'unknown')}")
                        total_skipped += 1
                except Exception as e:
                    print(f"  ✗ {discourse_name}: {e}")
                    total_errors += 1

            # Rate limiting
            batch_count += 1
            if batch_count >= args.batch_size:
                batch_count = 0
                if not args.dry_run:
                    print(f"  ... pausing {args.batch_delay}s (rate limit protection)")
                    time.sleep(args.batch_delay)

            # Check limit
            if args.limit > 0 and total_uploaded >= args.limit:
                print(f"\nReached upload limit ({args.limit})")
                break

        if args.limit > 0 and total_uploaded >= args.limit:
            break

    # Summary
    print(f"\n{'=' * 50}")
    print(f"Upload Summary")
    print(f"{'=' * 50}")
    print(f"  Uploaded: {total_uploaded}")
    print(f"  Skipped:  {total_skipped}")
    print(f"  Errors:   {total_errors}")
    print(f"  Total:    {total_uploaded + total_skipped + total_errors}")


if __name__ == "__main__":
    main()
