#!/usr/bin/env python3
"""
build_emoji_index.py — Build a unified emoji index mapping Discourse names to platform files.

Reads Discourse's emoji db.json and maps each emoji to available platform image files.
Outputs a JSON manifest used by the bulk upload script.

Usage:
    python3 build_emoji_index.py --build-dir ./build --output ./build/emoji_manifest.json
"""

import json
import os
import re
import sys
import argparse
from pathlib import Path


def load_discourse_db(build_dir: str) -> dict:
    """Load Discourse emoji database."""
    db_path = Path(build_dir) / "mapping" / "discourse_emoji_db.json"
    if not db_path.exists():
        print(f"ERROR: {db_path} not found. Run fetch_emoji_sets.sh first.", file=sys.stderr)
        sys.exit(1)

    with open(db_path) as f:
        return json.load(f)


def normalize_codepoint(cp: str) -> str:
    """Normalize a unicode codepoint string to lowercase hex without 0x prefix."""
    return cp.lower().replace("0x", "").replace("u+", "").strip()


def codepoint_to_filename_variants(codepoint: str) -> list[str]:
    """
    Generate possible filename variants for a unicode codepoint.
    Different emoji sets use different conventions:
    - Twemoji: 1f600.png (lowercase, no padding)
    - Noto: emoji_u1f600.png (with prefix)
    - OpenMoji: 1f600.png (lowercase, was uppercase)
    - Fluent: 1f600.svg (from metadata)
    """
    cp = normalize_codepoint(codepoint)
    # Remove variation selectors for filename matching
    cp_no_vs = re.sub(r'-?fe0f', '', cp).strip('-')

    variants = [cp, cp_no_vs]

    # Also try with emoji_u prefix (Noto style)
    variants.append(f"emoji_u{cp.replace('-', '_')}")
    variants.append(f"emoji_u{cp_no_vs.replace('-', '_')}")

    return list(dict.fromkeys(variants))  # dedupe preserving order


def find_platform_file(platform_dir: Path, codepoint: str, extensions: list[str]) -> str | None:
    """Find the emoji image file for a given codepoint in a platform directory."""
    variants = codepoint_to_filename_variants(codepoint)

    for variant in variants:
        for ext in extensions:
            candidate = platform_dir / f"{variant}.{ext}"
            if candidate.exists():
                return str(candidate.relative_to(platform_dir.parent.parent))

    return None


def build_manifest(build_dir: str) -> dict:
    """Build the complete emoji manifest."""
    build_path = Path(build_dir)
    db = load_discourse_db(build_dir)

    platforms = {
        "twemoji": {"dir": build_path / "twemoji", "extensions": ["png", "svg"]},
        "noto": {"dir": build_path / "noto", "extensions": ["png", "svg"]},
        "fluent": {"dir": build_path / "fluent", "extensions": ["svg", "png"]},
        "openmoji": {"dir": build_path / "openmoji", "extensions": ["png", "svg"]},
    }

    manifest = {p: {} for p in platforms}
    stats = {p: {"found": 0, "missing": 0} for p in platforms}

    # Discourse db.json structure varies by version; handle both formats
    emoji_entries = []

    if isinstance(db, list):
        # Array format: [{"code": "1f600", "name": "grinning", ...}, ...]
        emoji_entries = db
    elif isinstance(db, dict):
        # Object format with categories or flat: {"grinning": {"code": "1f600"}, ...}
        # Or grouped: {"people": [{"code": "1f600", "name": "grinning"}], ...}
        for key, value in db.items():
            if isinstance(value, list):
                emoji_entries.extend(value)
            elif isinstance(value, dict):
                entry = value.copy()
                if "name" not in entry:
                    entry["name"] = key
                emoji_entries.append(entry)

    print(f"Loaded {len(emoji_entries)} emoji entries from Discourse db")

    for entry in emoji_entries:
        # Extract name and codepoint
        name = entry.get("name") or entry.get("id", "")
        code = entry.get("code") or entry.get("unicode") or entry.get("codepoint", "")

        if not name or not code:
            continue

        # Clean name for Discourse custom emoji naming
        clean_name = re.sub(r'[^a-z0-9_]', '_', name.lower()).strip('_')
        if not clean_name:
            continue

        for platform, config in platforms.items():
            if not config["dir"].exists():
                stats[platform]["missing"] += 1
                continue

            file_path = find_platform_file(config["dir"], code, config["extensions"])

            if file_path:
                manifest[platform][clean_name] = {
                    "discourse_name": f"{platform}_{clean_name}",
                    "original_name": name,
                    "unicode": code,
                    "file": file_path,
                    "group": platform,
                }
                stats[platform]["found"] += 1
            else:
                stats[platform]["missing"] += 1

    # Print stats
    print("\n=== Build Summary ===")
    for platform, s in stats.items():
        total = s["found"] + s["missing"]
        pct = (s["found"] / total * 100) if total > 0 else 0
        print(f"  {platform}: {s['found']}/{total} matched ({pct:.1f}%)")

    return manifest


def main():
    parser = argparse.ArgumentParser(description="Build emoji manifest for Discourse upload")
    parser.add_argument("--build-dir", default="./build", help="Directory with fetched emoji sets")
    parser.add_argument("--output", default="./build/emoji_manifest.json", help="Output manifest path")
    args = parser.parse_args()

    manifest = build_manifest(args.build_dir)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    total = sum(len(emojis) for emojis in manifest.values())
    print(f"\nManifest written to {output_path} ({total} total emoji entries)")


if __name__ == "__main__":
    main()
