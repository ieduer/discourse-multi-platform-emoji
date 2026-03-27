import { apiInitializer } from "discourse/lib/api";
import { later } from "@ember/runloop";

const R2_BASE = "https://emoji.rdfzer.com";

const PLATFORM_META = {
  apple:             { label: "Apple" },
  google:            { label: "Google" },
  noto:              { label: "Noto" },
  twitter:           { label: "Twitter/X" },
  twemoji:           { label: "Twemoji" },
  win10:             { label: "Windows" },
  facebook_messenger:{ label: "Facebook" },
  emoji_one:         { label: "EmojiOne" },
  google_classic:    { label: "Google (old)" },
  fluentui:          { label: "Fluent UI" },
  openmoji:          { label: "OpenMoji" },
  unicode:           { label: "Unicode" },
};

// Extracts the bare filename (e.g. "grinning.png") from any emoji URL.
const EMOJI_FILENAME_RE = /\/([^/?#]+\.(?:png|gif|svg))(?:[?#].*)?$/i;

// All selectors we've ever seen for Discourse's emoji picker across versions.
const PICKER_SELECTORS = [
  ".emoji-picker",
  ".emoji-picker-modal",
  ".d-emoji-picker",
  "[data-emoji-picker]",
  "[class*='emoji-picker']",
  ".emoji-picker-content",
  ".emoji-picker__body",
].join(", ");

export default apiInitializer("1.0", (api) => {
  const siteSettings = api.container.lookup("service:site-settings");
  if (!siteSettings.multi_platform_emoji_enabled) return;

  const enabledPlatforms = (siteSettings.emoji_platforms_enabled || "apple|google|twitter")
    .split("|").map((s) => s.trim()).filter((s) => s && PLATFORM_META[s]);

  if (enabledPlatforms.length === 0) return;

  let activePlatform = enabledPlatforms[0];
  let imageObserver = null;
  let injectedPickers = new WeakSet();

  // ── URL helpers ────────────────────────────────────────────────────────

  function rewriteImg(img) {
    const m = img.src && img.src.match(EMOJI_FILENAME_RE);
    if (!m) return;
    const target = `${R2_BASE}/${activePlatform}/${m[1]}`;
    if (img.src !== target) img.src = target;
  }

  function rewriteAll(root) {
    root.querySelectorAll("img.emoji, img[src*='/emoji/'], img[src*='emoji.rdfzer.com']")
        .forEach(rewriteImg);
  }

  // ── Tab UI ─────────────────────────────────────────────────────────────

  function buildTabs(picker) {
    if (injectedPickers.has(picker)) return;
    injectedPickers.add(picker);

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
        tabsEl.querySelectorAll(".platform-tab").forEach((t) => t.classList.remove("active"));
        btn.classList.add("active");
        rewriteAll(picker);
      });

      tabsEl.appendChild(btn);
    });

    // Try known anchor points, fall back to prepend
    const anchor = picker.querySelector(
      ".emoji-picker-category-buttons, .emoji-categories, " +
      ".emoji-picker-search, .d-emoji-picker__search, " +
      ".emoji-picker__search, [class*='category-buttons'], " +
      "[class*='emoji-search'], .emoji-picker-header, " +
      ".emoji-picker-body"
    );
    if (anchor) {
      anchor.parentNode.insertBefore(tabsEl, anchor);
    } else {
      picker.prepend(tabsEl);
    }

    rewriteAll(picker);
    watchImages(picker);
  }

  function watchImages(picker) {
    if (imageObserver) imageObserver.disconnect();
    imageObserver = new MutationObserver((mutations) => {
      for (const { type, addedNodes, target, attributeName } of mutations) {
        if (type === "childList") {
          for (const node of addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === "IMG") {
              rewriteImg(node);
            } else {
              node.querySelectorAll?.("img").forEach(rewriteImg);
            }
          }
        }
        if (type === "attributes" && attributeName === "src" && target.tagName === "IMG") {
          rewriteImg(target);
        }
      }
    });
    imageObserver.observe(picker, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  }

  // ── Picker detection: multiple strategies ──────────────────────────────

  function tryInitPicker(el) {
    // Direct match
    if (el.matches?.(PICKER_SELECTORS)) {
      later(() => buildTabs(el), 120);
      return true;
    }
    // Child match
    const picker = el.querySelector?.(PICKER_SELECTORS);
    if (picker) {
      later(() => buildTabs(picker), 120);
      return true;
    }
    // Heuristic: new element contains emoji images → treat nearest scrollable as picker
    const imgs = el.querySelectorAll?.("img.emoji, img[src*='/emoji/']") || [];
    if (imgs.length >= 3) {
      later(() => buildTabs(el), 120);
      return true;
    }
    return false;
  }

  // Strategy 1: MutationObserver on document.body
  new MutationObserver((mutations) => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.nodeType !== 1) continue;
        if (tryInitPicker(node)) break;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // Strategy 2: Hook into emoji button clicks
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(
      ".emoji-picker-anchor, .emoji-picker-button, " +
      "[data-id='emoji'], button.emoji, .insert-emoji, " +
      ".btn-emoji, [title*='moji'], [aria-label*='moji']"
    );
    if (!btn) return;
    // Picker opens asynchronously — poll briefly
    let attempts = 0;
    const poll = setInterval(() => {
      const picker = document.querySelector(PICKER_SELECTORS);
      if (picker && !injectedPickers.has(picker)) {
        buildTabs(picker);
        clearInterval(poll);
      }
      if (++attempts > 20) clearInterval(poll);
    }, 80);
  }, true);

  // Strategy 3: Discourse plugin API - modifyClass (classic component support)
  try {
    api.modifyClass("component:emoji-picker", {
      pluginId: "multi-platform-emoji",
      didInsertElement() {
        this._super?.(...arguments);
        if (this.element) later(() => buildTabs(this.element), 120);
      },
    });
  } catch (_) {
    // Glimmer-only versions don't have this classic component — ignore
  }

});
