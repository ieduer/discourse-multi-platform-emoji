#!/usr/bin/env python3
"""
build_r2_emoji_tree.py — Build the complete emoji directory tree for R2 upload.

Downloads emoji from upstream sources, maps unicode codepoints to Discourse
shortnames using db.json, and organizes into Discourse-compatible directory
structure ready for R2 upload.

R2 structure:
    {bucket}/twemoji/{discourse_name}.png
    {bucket}/noto/{discourse_name}.png
    {bucket}/openmoji/{discourse_name}.png
    {bucket}/fluentui/{discourse_name}.png
    {bucket}/apple/{discourse_name}.png        (extracted from macOS font)
    {bucket}/google/{discourse_name}.png       (alias for noto)
    {bucket}/google_classic/{discourse_name}.png
    {bucket}/twitter/{discourse_name}.png      (alias for twemoji)

Usage:
    python3 build_r2_emoji_tree.py --output ./r2_tree --platforms twemoji,noto,openmoji,fluentui
    python3 build_r2_emoji_tree.py --output ./r2_tree --platforms apple --apple-font /System/Library/Fonts/Apple\ Color\ Emoji.ttc

Then upload:
    wrangler r2 object put discourse-emoji-assets/ --pipe < /dev/null  # or use upload_to_r2.sh
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import argparse
from pathlib import Path
from urllib.request import urlretrieve


# --- Configuration ---

DISCOURSE_DB_URL = "https://raw.githubusercontent.com/discourse/discourse/main/lib/emoji/db.json"

TWEMOJI_VERSION = "14.0.2"
TWEMOJI_CDN = f"https://cdn.jsdelivr.net/gh/twitter/twemoji@v{TWEMOJI_VERSION}/assets/72x72"

OPENMOJI_VERSION = "15.1"
OPENMOJI_RELEASE = f"https://github.com/hfg-gmuend/openmoji/releases/download/{OPENMOJI_VERSION}/openmoji-72x72-color.zip"

# Discourse set name → upstream source type
PLATFORM_CONFIG = {
    "twemoji": {"source": "twemoji_cdn", "ext": "png"},
    "noto": {"source": "noto_repo", "ext": "png"},
    "openmoji": {"source": "openmoji_release", "ext": "png"},
    "fluentui": {"source": "fluent_repo", "ext": "png"},
    "apple": {"source": "apple_font", "ext": "png"},
    # Aliases — copy from parent after building
    "twitter": {"alias": "twemoji"},
    "google": {"alias": "noto"},
    "google_classic": {"alias": "noto"},
}


def download_discourse_db(output_dir: Path) -> dict:
    """Download and parse Discourse emoji db.json."""
    db_path = output_dir / "db.json"
    if not db_path.exists():
        print("Downloading Discourse emoji db.json...")
        urlretrieve(DISCOURSE_DB_URL, db_path)

    with open(db_path) as f:
        raw = json.load(f)

    # db.json structure: array of groups, each containing emoji entries
    # Or it might be a flat dict. Handle both.
    mapping = {}  # discourse_name -> codepoint_hex

    if isinstance(raw, list):
        for group in raw:
            if isinstance(group, dict):
                for emoji_name, emoji_data in group.items():
                    if isinstance(emoji_data, dict) and "code" in emoji_data:
                        mapping[emoji_name] = emoji_data["code"]
                    elif isinstance(emoji_data, str):
                        mapping[emoji_name] = emoji_data
    elif isinstance(raw, dict):
        # Could be grouped by category or flat
        for key, value in raw.items():
            if isinstance(value, dict) and "code" in value:
                mapping[key] = value["code"]
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        name = item.get("name") or item.get("id", "")
                        code = item.get("code") or item.get("unicode", "")
                        if name and code:
                            mapping[name] = code
            elif isinstance(value, str):
                mapping[key] = value

    print(f"  Loaded {len(mapping)} emoji name→codepoint mappings")
    return mapping


def codepoint_variants(code: str) -> list[str]:
    """Generate filename variants for a codepoint."""
    code = code.lower().strip()
    # Remove variation selector fe0f
    no_vs = re.sub(r'-?fe0f', '', code).strip('-')

    variants = []
    for c in [code, no_vs]:
        if c and c not in variants:
            variants.append(c)
    return variants


def build_twemoji(mapping: dict, output_dir: Path, tmp_dir: Path):
    """Build twemoji set by downloading from CDN."""
    set_dir = output_dir / "twemoji"
    set_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== Building twemoji ({len(mapping)} emoji) ===")
    found = 0
    missing = []

    for name, code in mapping.items():
        target = set_dir / f"{name}.png"
        if target.exists():
            found += 1
            continue

        downloaded = False
        for variant in codepoint_variants(code):
            url = f"{TWEMOJI_CDN}/{variant}.png"
            try:
                urlretrieve(url, target)
                found += 1
                downloaded = True
                break
            except Exception:
                continue

        if not downloaded:
            missing.append(f"{name} ({code})")

    print(f"  ✓ {found} downloaded, {len(missing)} missing")
    if missing and len(missing) <= 20:
        for m in missing[:10]:
            print(f"    ✗ {m}")


def build_noto(mapping: dict, output_dir: Path, tmp_dir: Path):
    """Build noto set from Google's Noto Emoji repo."""
    set_dir = output_dir / "noto"
    set_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== Building noto ===")

    # Clone Noto emoji repo (shallow, just png directory)
    noto_dir = tmp_dir / "noto-emoji"
    if not noto_dir.exists():
        print("  Cloning noto-emoji repo (shallow)...")
        subprocess.run([
            "git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
            "https://github.com/googlefonts/noto-emoji.git", str(noto_dir)
        ], capture_output=True)
        subprocess.run(
            ["git", "sparse-checkout", "set", "png/72"],
            cwd=noto_dir, capture_output=True
        )

    # Noto filenames: emoji_u{codepoint}.png with underscores between parts
    png_dir = noto_dir / "png" / "72"
    if not png_dir.exists():
        # Try alternative structure
        png_dir = noto_dir / "png"

    # Build index of available noto files
    noto_files = {}
    if png_dir.exists():
        for f in png_dir.glob("*.png"):
            # emoji_u1f600.png → 1f600
            stem = f.stem.lower().replace("emoji_u", "").replace("_", "-")
            noto_files[stem] = f
            # Also index without fe0f
            no_vs = re.sub(r'-?fe0f', '', stem).strip('-')
            if no_vs not in noto_files:
                noto_files[no_vs] = f

    print(f"  Found {len(noto_files)} Noto source files")

    found = 0
    for name, code in mapping.items():
        target = set_dir / f"{name}.png"
        if target.exists():
            found += 1
            continue

        for variant in codepoint_variants(code):
            # Noto uses underscore not hyphen
            noto_variant = variant.replace("-", "_")
            src = noto_files.get(variant) or noto_files.get(noto_variant)
            if src:
                shutil.copy2(src, target)
                found += 1
                break

    print(f"  ✓ {found}/{len(mapping)} matched")


def build_openmoji(mapping: dict, output_dir: Path, tmp_dir: Path):
    """Build openmoji set from release ZIP."""
    set_dir = output_dir / "openmoji"
    set_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== Building openmoji ===")

    # Download release ZIP
    zip_path = tmp_dir / "openmoji-72x72-color.zip"
    extract_dir = tmp_dir / "openmoji-extract"

    if not extract_dir.exists():
        if not zip_path.exists():
            print(f"  Downloading OpenMoji {OPENMOJI_VERSION}...")
            urlretrieve(OPENMOJI_RELEASE, zip_path)

        print("  Extracting...")
        extract_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(["unzip", "-q", str(zip_path), "-d", str(extract_dir)], capture_output=True)

    # Build index: OpenMoji uses UPPERCASE codepoints
    om_files = {}
    for f in extract_dir.glob("*.png"):
        stem = f.stem.lower()
        om_files[stem] = f
        no_vs = re.sub(r'-?fe0f', '', stem).strip('-')
        if no_vs not in om_files:
            om_files[no_vs] = f

    print(f"  Found {len(om_files)} OpenMoji source files")

    found = 0
    for name, code in mapping.items():
        target = set_dir / f"{name}.png"
        if target.exists():
            found += 1
            continue

        for variant in codepoint_variants(code):
            src = om_files.get(variant)
            if src:
                shutil.copy2(src, target)
                found += 1
                break

    print(f"  ✓ {found}/{len(mapping)} matched")


def build_fluentui(mapping: dict, output_dir: Path, tmp_dir: Path):
    """Build fluentui set from Microsoft's repo."""
    set_dir = output_dir / "fluentui"
    set_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== Building fluentui ===")

    fluent_dir = tmp_dir / "fluentui-emoji"
    if not fluent_dir.exists():
        print("  Cloning fluentui-emoji repo (shallow)...")
        subprocess.run([
            "git", "clone", "--depth", "1",
            "https://github.com/microsoft/fluentui-emoji.git", str(fluent_dir)
        ], capture_output=True)

    # Build index from metadata.json files
    fluent_files = {}
    assets_dir = fluent_dir / "assets"
    if assets_dir.exists():
        for metadata_path in assets_dir.rglob("metadata.json"):
            try:
                with open(metadata_path) as f:
                    meta = json.load(f)
                unicode_val = meta.get("unicode", "")
                if not unicode_val:
                    continue

                # Normalize unicode to lowercase hex with hyphens
                parts = unicode_val.strip().split()
                code = "-".join(p.lstrip("uU+0") or "0" for p in parts).lower()

                # Find the Color/Flat PNG
                emoji_dir = metadata_path.parent
                # Try: Default/Flat/color.png or similar
                for png_candidate in [
                    emoji_dir / "Default" / "3D" / f"{meta.get('cldr', '')}.png",
                    emoji_dir / "3D" / f"{meta.get('cldr', '')}.png",
                ]:
                    pass  # Fluent uses SVG primarily

                # Find any PNG in Flat or Color subdirectory
                for subdir_name in ["Flat", "Color", "Default", "3D"]:
                    subdir = emoji_dir / subdir_name
                    if subdir.exists():
                        pngs = list(subdir.glob("*.png"))
                        svgs = list(subdir.glob("*.svg"))
                        if pngs:
                            fluent_files[code] = pngs[0]
                            no_vs = re.sub(r'-?fe0f', '', code).strip('-')
                            if no_vs not in fluent_files:
                                fluent_files[no_vs] = pngs[0]
                            break
                        elif svgs:
                            fluent_files[code] = svgs[0]
                            no_vs = re.sub(r'-?fe0f', '', code).strip('-')
                            if no_vs not in fluent_files:
                                fluent_files[no_vs] = svgs[0]
                            break
            except (json.JSONDecodeError, KeyError):
                continue

    print(f"  Found {len(fluent_files)} Fluent source files")

    found = 0
    for name, code in mapping.items():
        target = set_dir / f"{name}.png"
        if target.exists():
            found += 1
            continue

        for variant in codepoint_variants(code):
            src = fluent_files.get(variant)
            if src:
                if src.suffix == ".svg":
                    # Need to convert SVG to PNG — skip if no converter
                    # User can install cairosvg or rsvg-convert
                    try:
                        subprocess.run(
                            ["rsvg-convert", "-w", "72", "-h", "72", str(src), "-o", str(target)],
                            capture_output=True, check=True
                        )
                        found += 1
                    except (subprocess.CalledProcessError, FileNotFoundError):
                        # Try cairosvg
                        try:
                            import cairosvg
                            cairosvg.svg2png(url=str(src), write_to=str(target),
                                             output_width=72, output_height=72)
                            found += 1
                        except ImportError:
                            pass
                else:
                    shutil.copy2(src, target)
                    found += 1
                break

    print(f"  ✓ {found}/{len(mapping)} matched")


def build_apple(mapping: dict, output_dir: Path, tmp_dir: Path, font_path: str):
    """Build apple set by extracting from macOS system font."""
    set_dir = output_dir / "apple"
    set_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== Building apple (from {font_path}) ===")

    if not Path(font_path).exists():
        print(f"  ✗ Font not found: {font_path}")
        print("  Skipping Apple emoji (macOS only)")
        return

    try:
        from fontTools.ttLib import TTFont
        from PIL import Image
        import io
    except ImportError:
        print("  ✗ fonttools and Pillow required: pip install fonttools Pillow")
        return

    # Extract all emoji from font, keyed by codepoint
    import struct
    extracted = {}

    with open(font_path, "rb") as f:
        tag = f.read(4)
        f.seek(0)

    font_count = 1
    if tag == b"ttcf":
        with open(font_path, "rb") as f:
            f.read(4)  # tag
            f.read(4)  # version
            font_count = struct.unpack(">I", f.read(4))[0]

    for idx in range(font_count):
        try:
            tt = TTFont(font_path, fontNumber=idx)
        except Exception:
            continue

        if "sbix" not in tt:
            tt.close()
            continue

        cmap = tt.getBestCmap() or {}
        glyph_to_cp = {}
        for cp, glyph in cmap.items():
            glyph_to_cp[glyph] = f"{cp:x}"

        sbix = tt["sbix"]
        # Find best strike (closest to 72px)
        best_strike = None
        best_diff = float("inf")
        for strike in sbix.strikes.values():
            diff = abs(strike.ppem - 72)
            if diff < best_diff:
                best_diff = diff
                best_strike = strike

        if not best_strike:
            tt.close()
            continue

        print(f"  Using strike size: {best_strike.ppem}px")

        for glyph_name, glyph in best_strike.glyphs.items():
            if not glyph.graphicType or not glyph.imageData:
                continue
            # graphicType may be str or bytes depending on fonttools version
            gt = glyph.graphicType if isinstance(glyph.graphicType, str) else glyph.graphicType.decode()
            if gt.strip().lower() != "png":
                continue

            if glyph_name in glyph_to_cp:
                extracted[glyph_to_cp[glyph_name]] = glyph.imageData

        tt.close()
        break

    print(f"  Extracted {len(extracted)} glyphs from font")

    found = 0
    for name, code in mapping.items():
        target = set_dir / f"{name}.png"
        if target.exists():
            found += 1
            continue

        for variant in codepoint_variants(code):
            # Apple font cmap is single codepoint; compound emoji may not match directly
            data = extracted.get(variant)
            if data:
                try:
                    img = Image.open(io.BytesIO(data))
                    if img.size[0] != 72:
                        img = img.resize((72, 72), Image.LANCZOS)
                    img.save(target, "PNG")
                    found += 1
                except Exception:
                    with open(target, "wb") as f:
                        f.write(data)
                    found += 1
                break

    print(f"  ✓ {found}/{len(mapping)} matched")


def build_aliases(output_dir: Path):
    """Create alias directories (copy or symlink)."""
    aliases = {
        "twitter": "twemoji",
        "google": "noto",
        "google_classic": "noto",
    }

    print(f"\n=== Building aliases ===")
    for alias_name, source_name in aliases.items():
        src = output_dir / source_name
        dst = output_dir / alias_name
        if not src.exists():
            print(f"  ✗ {alias_name} → {source_name} (source not found)")
            continue
        if dst.exists():
            print(f"  ⚠ {alias_name} already exists, skipping")
            continue

        # Copy directory (R2 doesn't support symlinks)
        shutil.copytree(src, dst)
        count = len(list(dst.glob("*.png")))
        print(f"  ✓ {alias_name} → {source_name} ({count} files)")


def main():
    parser = argparse.ArgumentParser(description="Build R2 emoji directory tree for Discourse")
    parser.add_argument("--output", default="./r2_tree", help="Output directory")
    parser.add_argument("--platforms", default="twemoji,noto,openmoji,fluentui",
                        help="Comma-separated platforms to build")
    parser.add_argument("--apple-font",
                        default="/System/Library/Fonts/Apple Color Emoji.ttc",
                        help="Path to Apple Color Emoji font (macOS)")
    parser.add_argument("--tmp-dir", default=None, help="Temp directory for downloads")
    parser.add_argument("--with-aliases", action="store_true", default=True,
                        help="Create alias directories (twitter→twemoji, google→noto)")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    tmp_dir = Path(args.tmp_dir) if args.tmp_dir else Path(tempfile.mkdtemp(prefix="emoji_build_"))
    print(f"Output: {output_dir}")
    print(f"Temp:   {tmp_dir}")

    # Step 1: Get Discourse name→codepoint mapping
    mapping = download_discourse_db(tmp_dir)

    if not mapping:
        print("ERROR: Failed to load emoji mapping", file=sys.stderr)
        sys.exit(1)

    # Step 2: Build each platform
    platforms = [p.strip() for p in args.platforms.split(",")]

    builders = {
        "twemoji": lambda: build_twemoji(mapping, output_dir, tmp_dir),
        "noto": lambda: build_noto(mapping, output_dir, tmp_dir),
        "openmoji": lambda: build_openmoji(mapping, output_dir, tmp_dir),
        "fluentui": lambda: build_fluentui(mapping, output_dir, tmp_dir),
        "apple": lambda: build_apple(mapping, output_dir, tmp_dir, args.apple_font),
    }

    for platform in platforms:
        builder = builders.get(platform)
        if builder:
            builder()
        else:
            print(f"\n⚠ Unknown platform: {platform}")

    # Step 3: Build aliases
    if args.with_aliases:
        build_aliases(output_dir)

    # Summary
    print(f"\n{'=' * 50}")
    print("Build Summary")
    print(f"{'=' * 50}")
    total = 0
    for d in sorted(output_dir.iterdir()):
        if d.is_dir() and d.name != "__pycache__":
            count = len(list(d.glob("*.png")))
            print(f"  {d.name}: {count} emoji")
            total += count
    print(f"  TOTAL: {total} files")
    print(f"\nReady for R2 upload: {output_dir}")


if __name__ == "__main__":
    main()
