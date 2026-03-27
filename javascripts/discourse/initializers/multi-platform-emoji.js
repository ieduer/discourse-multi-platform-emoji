import { apiInitializer } from "discourse/lib/api";

const R2_BASE = "https://emoji.rdfzer.com";

const PLATFORM_META = {
  apple:             { label: "Apple" },
  google:            { label: "Google" },
  twitter:           { label: "Twitter/X" },
  win10:             { label: "Windows" },
  facebook_messenger:{ label: "Facebook" },
  emoji_one:         { label: "EmojiOne" },
  google_classic:    { label: "Google (old)" },
};

// Extract just the emoji filename (e.g. "grinning.png") from any URL format:
//   https://emoji.rdfzer.com/apple/grinning.png
//   https://forum.example.com/images/emoji/apple/grinning.png?v=15
//   /images/emoji/google/heart.png?v=12
const EMOJI_FILENAME_RE = /\/([^/?#]+\.(?:png|gif|svg))(?:[?#].*)?$/i;

export default apiInitializer("1.0", (api) => {
  const siteSettings = api.container.lookup("service:site-settings");

  if (!siteSettings.multi_platform_emoji_enabled) return;

  const enabledPlatforms = (siteSettings.emoji_platforms_enabled || "apple|google|twitter")
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s && PLATFORM_META[s]);

  if (enabledPlatforms.length === 0) return;

  let activePlatform = enabledPlatforms[0];
  let imageObserver = null;

  // ── URL helpers ──────────────────────────────────────────────────────────

  function emojiFilename(src) {
    if (!src) return null;
    const m = src.match(EMOJI_FILENAME_RE);
    return m ? m[1] : null;
  }

  function r2Url(platform, filename) {
    return `${R2_BASE}/${platform}/${filename}`;
  }

  function rewriteImg(img) {
    const fn = emojiFilename(img.src);
    if (!fn) return;
    const target = r2Url(activePlatform, fn);
    if (img.src !== target) img.src = target;
  }

  // ── Picker helpers ───────────────────────────────────────────────────────

  const PICKER_SELECTORS = [
    ".emoji-picker",
    ".emoji-picker-modal",
    "[class*='emoji-picker']",
    ".d-emoji-picker",
  ].join(", ");

  function findPicker(root) {
    return root.matches?.(PICKER_SELECTORS)
      ? root
      : root.querySelector?.(PICKER_SELECTORS);
  }

  function emojiImgsIn(picker) {
    // Include both standard emoji imgs and any img whose src suggests an emoji
    return Array.from(
      picker.querySelectorAll("img.emoji, img[src*='/emoji/'], img[src*='emoji.rdfzer.com']")
    );
  }

  function rewriteAll(picker) {
    emojiImgsIn(picker).forEach(rewriteImg);
  }

  function buildTabs(picker) {
    if (picker.querySelector(".platform-emoji-tabs")) return; // already injected

    const tabsEl = document.createElement("div");
    tabsEl.className = "platform-emoji-tabs";

    enabledPlatforms.forEach((platform) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "platform-tab" + (platform === activePlatform ? " active" : "");
      btn.dataset.platform = platform;
      btn.textContent = PLATFORM_META[platform].label;

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activePlatform = platform;
        tabsEl.querySelectorAll(".platform-tab")
              .forEach((t) => t.classList.remove("active"));
        btn.classList.add("active");
        rewriteAll(picker);
      });

      tabsEl.appendChild(btn);
    });

    const anchor =
      picker.querySelector(
        ".emoji-picker-category-buttons, .emoji-categories, " +
        ".picker-emoji-list, .emoji-picker__body, .emoji-picker-content"
      ) || picker.firstElementChild;

    anchor ? picker.insertBefore(tabsEl, anchor) : picker.appendChild(tabsEl);

    rewriteAll(picker);
  }

  function attachImageObserver(picker) {
    if (imageObserver) imageObserver.disconnect();

    imageObserver = new MutationObserver((mutations) => {
      for (const { type, addedNodes, target, attributeName } of mutations) {
        if (type === "childList") {
          for (const node of addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === "IMG") {
              rewriteImg(node);
            } else {
              node.querySelectorAll?.(
                "img.emoji, img[src*='/emoji/'], img[src*='emoji.rdfzer.com']"
              ).forEach(rewriteImg);
            }
          }
        }
        if (type === "attributes" && attributeName === "src" && target.tagName === "IMG") {
          rewriteImg(target);
        }
      }
    });

    imageObserver.observe(picker, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }

  function initPicker(picker) {
    setTimeout(() => {
      buildTabs(picker);
      attachImageObserver(picker);
    }, 100);
  }

  // ── Watch for picker mount ───────────────────────────────────────────────

  new MutationObserver((mutations) => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.nodeType !== 1) continue;
        const picker = findPicker(node);
        if (picker) {
          initPicker(picker);
          return;
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
});
