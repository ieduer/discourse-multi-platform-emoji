# discourse-multi-platform-emoji

Multi-platform emoji for Discourse Reactions. Upload emoji from Twemoji, Noto, Fluent, OpenMoji (and optionally Apple) as custom emoji, then use this theme component to organize them by platform in the emoji picker.

## Architecture

This project has two parts:

1. **Scripts** — Fetch emoji images from upstream sources, build a unified index, and bulk-upload to Discourse as custom emoji via the Admin API.
2. **Theme Component** — Adds platform filter tabs to the Discourse emoji picker so users can browse custom emoji by platform (Twemoji, Noto, Fluent, OpenMoji, etc.).

Custom emoji are uploaded with platform prefixes (e.g., `twemoji_grinning`, `noto_heart`) and grouped by platform. The theme component reads these prefixes to create filterable tabs.

## Quick Start

### Step 1: Fetch emoji images

```bash
cd scripts
pip install -r requirements.txt

# Fetch open-source emoji sets
bash fetch_emoji_sets.sh twemoji,noto,fluent,openmoji 72 ./build

# Build the unified index mapping Discourse names → platform files
python3 build_emoji_index.py --build-dir ./build --output ./build/emoji_manifest.json
```

### Step 2: Upload to Discourse

```bash
# Dry run first
python3 bulk_upload.py \
  --manifest ./build/emoji_manifest.json \
  --build-dir ./build \
  --discourse-url https://forum.example.com \
  --api-key YOUR_API_KEY \
  --platforms twemoji,noto \
  --dry-run

# Real upload (start with one platform)
python3 bulk_upload.py \
  --manifest ./build/emoji_manifest.json \
  --build-dir ./build \
  --discourse-url https://forum.example.com \
  --api-key YOUR_API_KEY \
  --platforms twemoji \
  --batch-size 20 \
  --batch-delay 2
```

### Step 3: Install Theme Component

In Discourse Admin:

1. Go to **Admin → Customize → Themes → Components**
2. Click **Install** → **From a git repository**
3. Enter: `https://github.com/suen-org/discourse-multi-platform-emoji`
4. Add the component to your active theme

## Optional: Apple Emoji (macOS only, private use)

```bash
# Must run on macOS — extracts from system font
python3 extract_apple_emoji.py --output ./build/apple --size 64

# Re-build index to include Apple
python3 build_emoji_index.py --build-dir ./build --output ./build/emoji_manifest.json

# Upload Apple emoji
python3 bulk_upload.py \
  --manifest ./build/emoji_manifest.json \
  --discourse-url https://forum.example.com \
  --api-key YOUR_API_KEY \
  --platforms apple
```

> **Warning:** Apple emoji are copyrighted. Do not publicly distribute. Private forum use only.

## Available Platforms

| Platform | License | Source |
|----------|---------|--------|
| Twemoji | CC-BY 4.0 | [twitter/twemoji](https://github.com/twitter/twemoji) |
| Noto Emoji | OFL-1.1 | [googlefonts/noto-emoji](https://github.com/googlefonts/noto-emoji) |
| Fluent Emoji | MIT | [microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji) |
| OpenMoji | CC BY-SA 4.0 | [hfg-gmuend/openmoji](https://github.com/hfg-gmuend/openmoji) |
| Apple | Proprietary | macOS system font (private use only) |

## Theme Component Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `multi_platform_emoji_enabled` | true | Enable platform filter tabs |
| `emoji_platforms_enabled` | twemoji\|noto\|fluent\|openmoji | Pipe-separated list of enabled platforms |
| `show_platform_prefix` | false | Show platform name in emoji tooltip |
| `platform_tab_style` | icons | Tab style: icons, text, or both |

## R2 / CDN (Optional)

If you prefer hosting emoji on Cloudflare R2 instead of Discourse uploads:

1. Upload emoji images to R2 bucket `discourse-emoji-assets`
2. Set up a custom domain (e.g., `emoji-cdn.rdfzer.com`)
3. Configure CORS to allow only your forum domain
4. Use `External emoji URL` in Discourse settings to point to the R2 bucket

This is an alternative approach for the default emoji set rendering; the custom emoji upload approach doesn't require this.

## License

MIT — see [LICENSE](LICENSE)

Emoji assets retain their original licenses (see table above).
