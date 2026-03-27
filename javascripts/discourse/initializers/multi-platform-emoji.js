import { apiInitializer } from "discourse/lib/api";

const R2_BASE = "https://emoji.rdfzer.com";

const PLATFORM_META = {
  apple:             { label: "Apple",         order: 0 },
  google:            { label: "Google",        order: 1 },
  google_classic:    { label: "Google (old)",  order: 2 },
  twitter:           { label: "Twitter/X",     order: 3 },
  facebook_messenger:{ label: "Facebook",      order: 4 },
  emoji_one:         { label: "EmojiOne",      order: 5 },
  win10:             { label: "Windows",       order: 6 },
};

// Matches any URL that originates from our R2 bucket, regardless of platform subfolder.
// Captures: (base, platform, filename)  e.g. ("https://emoji.rdfzer.com", "google", "grinning.png")
const R2_URL_RE = /^(https:\/\/emoji\.rdfzer\.com)\/([^/]+)\/(.+)$/;

export default apiInitializer("1.0", (api) => {
  const siteSettings = api.container.lookup("service:site-settings");

  if (!siteSettings.multi_platform_emoji_enabled) return;

  const enabledPlatforms = (siteSettings.emoji_platforms_enabled || "apple|google|twitter")
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s && PLATFORM_META[s]);

  if (enabledPlatforms.length === 0) return;

  let activePlatform = enabledPlatforms[0];
  let pickerImageObserver = null;

  // ─── URL helpers ──────────────────────────────────────────────────────────

  function toR2Url(platform, filename) {
    return `${R2_BASE}/${platform}/${filename}`;
  }

  function rewriteSrc(img) {
    const m = img.src && img.src.match(R2_URL_RE);
    if (m) {
      const newSrc = toR2Url(activePlatform, m[3]);
      if (img.src !== newSrc) img.src = newSrc;
    }
  }

  // ─── Picker DOM helpers ───────────────────────────────────────────────────

  function getAllEmojiImgs(picker) {
    return picker.querySelectorAll("img.emoji[src], img[src*='emoji.rdfzer.com']");
  }

  function rewriteAll(picker) {
    getAllEmojiImgs(picker).forEach(rewriteSrc);
  }

  function buildTabs(picker) {
    if (picker.querySelector(".platform-emoji-tabs")) return;

    const tabsEl = document.createElement("div");
    tabsEl.className = "platform-emoji-tabs";

    enabledPlatforms.forEach((platform, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "platform-tab" + (platform === activePlatform ? " active" : "");
      btn.dataset.platform = platform;
      btn.textContent = (PLATFORM_META[platform] || {}).label || platform;

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activePlatform = platform;
        tabsEl.querySelectorAll(".platform-tab").forEach((t) => t.classList.remove("active"));
        btn.classList.add("active");
        rewriteAll(picker);
      });

      tabsEl.appendChild(btn);
    });

    // Insert before the first category section or at the top
    const target =
      picker.querySelector(".emoji-picker-category-buttons") ||
      picker.querySelector(".emoji-categories") ||
      picker.firstElementChild;

    if (target) {
      picker.insertBefore(tabsEl, target);
    } else {
      picker.appendChild(tabsEl);
    }

    // Rewrite images already present when tabs are built
    rewriteAll(picker);
  }

  function attachImageObserver(picker) {
    if (pickerImageObserver) pickerImageObserver.disconnect();

    pickerImageObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "IMG") {
            rewriteSrc(node);
          } else {
            node.querySelectorAll &&
              node.querySelectorAll("img.emoji[src], img[src*='emoji.rdfzer.com']")
                  .forEach(rewriteSrc);
          }
        }
        // Also handle src attribute changes (lazy loading)
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "src" &&
          mutation.target.tagName === "IMG"
        ) {
          rewriteSrc(mutation.target);
        }
      }
    });

    pickerImageObserver.observe(picker, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }

  function initPicker(picker) {
    // Delay slightly to let Discourse render its own emoji first
    setTimeout(() => {
      buildTabs(picker);
      attachImageObserver(picker);
    }, 80);
  }

  // ─── Watch for picker appearing in DOM ───────────────────────────────────

  const bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;

        const picker =
          node.matches(".emoji-picker, .emoji-picker-modal")
            ? node
            : node.querySelector(".emoji-picker, .emoji-picker-modal");

        if (picker) {
          initPicker(picker);
          return;
        }
      }
    }
  });

  bodyObserver.observe(document.body, { childList: true, subtree: true });
});
