# discourse-multi-platform-emoji

Serve all emoji platforms via Cloudflare R2 + Discourse External emoji URL. Includes a theme component for platform filter tabs in the emoji picker.

## Architecture

Two approaches (can be combined):

### Approach A: External emoji URL + R2 (recommended)

Upload all emoji sets (Twemoji, Noto, OpenMoji, Fluent, Apple) to an R2 bucket in Discourse's expected directory structure. Set `External emoji URL` in Discourse admin to point to R2. Users switch emoji sets via the admin "Emoji set" dropdown — all sets load from R2.

### Approach B: Custom Emoji Upload via API

Bulk-upload emoji as Discourse custom emoji with platform prefixes. Use the theme component to add platform filter tabs. Both approaches can coexist.

## Quick Start (Approach A — R2)

### Step 1: Build the emoji directory tree

```bash
cd scripts
pip install -r requirements.txt

# Build all open-source sets (downloads from upstream, maps to Discourse names)
python3 build_r2_emoji_tree.py \
  --output ./r2_tree \
  --platforms twemoji,noto,openmoji,fluentui

# Optional: include Apple emoji (macOS only, private use)
python3 build_r2_emoji_tree.py \
  --output ./r2_tree \
  --platforms apple \
  --apple-font "/System/Library/Fonts/Apple Color Emoji.ttc"
```

This creates:
```
r2_tree/
├── twemoji/grinning.png, heart.png, ...
├── noto/grinning.png, heart.png, ...
├── openmoji/grinning.png, heart.png, ...
├── fluentui/grinning.png, heart.png, ...
├── apple/grinning.png, ...           (if built)
├── twitter/  → copy of twemoji/      (alias)
├── google/   → copy of noto/         (alias)
└── google_classic/ → copy of noto/   (alias)
```

### Step 2: Upload to R2

```bash
# Dry run
bash upload_to_r2.sh ./r2_tree discourse-emoji-assets --dry-run

# Real upload
bash upload_to_r2.sh ./r2_tree discourse-emoji-assets
```

### Step 3: Configure Discourse

1. Set up R2 bucket public access (custom domain or R2.dev)
2. In Discourse Admin → Settings → Emoji:
   - Set **External emoji URL** to your R2 public URL (e.g., `https://emoji.rdfzer.com`)
   - Select any **Emoji set** from the dropdown — all sets now load from R2

### Step 4: Install Theme Component (optional)

For platform filter tabs in the emoji picker:

1. Go to **Admin → Customize → Themes → Components**
2. Click **Install** → **From a git repository**
3. Enter: `https://github.com/ieduer/discourse-multi-platform-emoji`
4. Add the component to your active theme

## Quick Start (Approach B — Custom Emoji API)

```bash
cd scripts

# Fetch emoji
bash fetch_emoji_sets.sh twemoji,noto 72 ./build

# Build manifest
python3 build_emoji_index.py --build-dir ./build

# Dry run
python3 bulk_upload.py \
  --manifest ./build/emoji_manifest.json \
  --build-dir ./build \
  --discourse-url https://forum.example.com \
  --api-key YOUR_API_KEY \
  --platforms twemoji \
  --dry-run

# Upload
python3 bulk_upload.py \
  --manifest ./build/emoji_manifest.json \
  --build-dir ./build \
  --discourse-url https://forum.example.com \
  --api-key YOUR_API_KEY \
  --platforms twemoji
```

## Available Platforms

| Platform | Discourse set name | License | Source |
|----------|-------------------|---------|--------|
| Twemoji | `twemoji` | CC-BY 4.0 | [twitter/twemoji](https://github.com/twitter/twemoji) |
| Noto Emoji | `noto` | OFL-1.1 | [googlefonts/noto-emoji](https://github.com/googlefonts/noto-emoji) |
| Fluent Emoji | `fluentui` | MIT | [microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji) |
| OpenMoji | `openmoji` | CC BY-SA 4.0 | [hfg-gmuend/openmoji](https://github.com/hfg-gmuend/openmoji) |
| Apple | `apple` | Proprietary | macOS system font (private use only) |

Aliases: `twitter` → `twemoji`, `google` → `noto`, `google_classic` → `noto`

> **Warning:** Apple emoji are copyrighted. Do not publicly distribute. Use only on private forums with R2 CORS restricted to your domain.

## Theme Component Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `multi_platform_emoji_enabled` | true | Enable platform filter tabs |
| `emoji_platforms_enabled` | twemoji\|noto\|fluent\|openmoji | Pipe-separated enabled platforms |
| `show_platform_prefix` | false | Show platform name in tooltip |
| `platform_tab_style` | icons | Tab style: icons, text, or both |

## License

MIT — see [LICENSE](LICENSE)

Emoji assets retain their original licenses (see table above).
