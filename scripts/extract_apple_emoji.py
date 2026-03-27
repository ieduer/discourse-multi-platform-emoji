#!/usr/bin/env python3
"""
extract_apple_emoji.py — Extract Apple emoji from macOS system font.

Extracts individual emoji PNGs from Apple Color Emoji.ttc on macOS.
These are copyrighted and should NOT be publicly distributed.
For private forum use only.

Usage:
    python3 extract_apple_emoji.py --output ./build/apple --size 64

Requirements:
    pip install fonttools Pillow
"""

import argparse
import struct
import sys
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
    from PIL import Image
    import io
except ImportError:
    print("ERROR: Required packages not found.", file=sys.stderr)
    print("Install with: pip install fonttools Pillow", file=sys.stderr)
    sys.exit(1)


APPLE_EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc"


def extract_sbix_emoji(font_path: str, output_dir: str, target_size: int = 64):
    """Extract emoji from Apple Color Emoji font's sbix table."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Apple Color Emoji.ttc is a TrueType Collection
    # Try each font in the collection
    font_count = 0
    try:
        # Get number of fonts in collection
        with open(font_path, "rb") as f:
            tag = f.read(4)
            if tag == b"ttcf":
                f.read(4)  # version
                font_count = struct.unpack(">I", f.read(4))[0]
            else:
                font_count = 1
    except Exception as e:
        print(f"Error reading font file: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Font collection contains {font_count} font(s)")

    total_extracted = 0

    for font_index in range(font_count):
        try:
            tt = TTFont(font_path, fontNumber=font_index)
        except Exception:
            continue

        if "sbix" not in tt:
            tt.close()
            continue

        sbix = tt["sbix"]
        cmap = tt.getBestCmap()

        if not cmap:
            tt.close()
            continue

        # Reverse cmap: glyph name -> unicode codepoint
        glyph_to_unicode = {}
        for codepoint, glyph_name in cmap.items():
            hex_cp = f"{codepoint:x}"
            glyph_to_unicode[glyph_name] = hex_cp

        # Find the best strike size (closest to target)
        strikes = sbix.strikes
        best_strike = None
        best_diff = float("inf")

        for strike in strikes.values():
            ppem = strike.ppem
            diff = abs(ppem - target_size)
            if diff < best_diff:
                best_diff = diff
                best_strike = strike

        if not best_strike:
            tt.close()
            continue

        print(f"  Using strike size: {best_strike.ppem}px (target: {target_size}px)")

        for glyph_name, glyph in best_strike.glyphs.items():
            if not glyph.graphicType or glyph.graphicType not in (b"png ", b"PNG "):
                continue
            if not glyph.imageData:
                continue

            # Determine filename from unicode codepoint
            if glyph_name in glyph_to_unicode:
                filename = glyph_to_unicode[glyph_name]
            else:
                filename = glyph_name.lower().replace("u", "").replace("_", "-")

            output_file = output_path / f"{filename}.png"

            # Resize if needed
            try:
                img = Image.open(io.BytesIO(glyph.imageData))
                if img.size[0] != target_size:
                    img = img.resize((target_size, target_size), Image.LANCZOS)
                img.save(output_file, "PNG")
                total_extracted += 1
            except Exception:
                # Some glyphs may not be valid images
                with open(output_file, "wb") as f:
                    f.write(glyph.imageData)
                total_extracted += 1

        tt.close()
        break  # Usually only need the first font with sbix

    print(f"\nExtracted {total_extracted} emoji PNGs to {output_dir}")
    return total_extracted


def main():
    parser = argparse.ArgumentParser(description="Extract Apple emoji from system font")
    parser.add_argument("--font", default=APPLE_EMOJI_FONT,
                        help=f"Path to Apple Color Emoji font (default: {APPLE_EMOJI_FONT})")
    parser.add_argument("--output", default="./build/apple",
                        help="Output directory for extracted PNGs")
    parser.add_argument("--size", type=int, default=64,
                        help="Target emoji size in pixels (default: 64)")
    args = parser.parse_args()

    if not Path(args.font).exists():
        print(f"ERROR: Font not found at {args.font}", file=sys.stderr)
        print("This script must be run on macOS.", file=sys.stderr)
        sys.exit(1)

    extract_sbix_emoji(args.font, args.output, args.size)


if __name__ == "__main__":
    main()
