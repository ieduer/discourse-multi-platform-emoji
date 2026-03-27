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

// Extracts bare filename ("grinning.png") from any emoji URL.
const EMOJI_FILENAME_RE = /\/([^/?#]+\.(?:png|gif|svg))(?:[?#].*)?$/i;

// Matches emoji images from Discourse or R2.
const EMOJI_IMG_SEL = "img.emoji, img[src*='/emoji/'], img[src*='emoji.rdfzer.com']";

// Known picker selectors across Discourse versions.
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
  let injectedPickers = new WeakSet();

  // ── URL helpers ────────────────────────────────────────────────────────

  function isEmojiImg(img) {
    return img.src && (
      img.classList.contains("emoji") ||
      img.src.includes("/emoji/") ||
      img.src.includes("emoji.rdfzer.com")
    );
  }

  function rewriteImg(img) {
    if (!isEmojiImg(img)) return;
    const m = img.src.match(EMOJI_FILENAME_RE);
    if (!m) return;
    const target = `${R2_BASE}/${activePlatform}/${m[1]}`;
    if (img.src !== target) img.src = target;
  }

  function rewriteAll(root) {
    (root || document.body).querySelectorAll(EMOJI_IMG_SEL).forEach(rewriteImg);
  }

  // ── Global image observer (works regardless of picker detection) ────────
  // Rewrites every emoji image the moment it appears or its src is changed.

  new MutationObserver((mutations) => {
    for (const { type, addedNodes, target, attributeName } of mutations) {
      if (type === "childList") {
        for (const node of addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "IMG") {
            rewriteImg(node);
          } else {
            node.querySelectorAll?.("img").forEach(rewriteImg);
          }
          // Also attempt picker tab injection on newly added nodes.
          tryInitPicker(node);
        }
      }
      if (type === "attributes" && attributeName === "src" && target.tagName === "IMG") {
        rewriteImg(target);
      }
    }
  }).observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ["src"],
  });

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

    // Insert before first recognizable sub-element, or prepend.
    const anchor = picker.querySelector(
      ".emoji-picker-category-buttons, .emoji-categories, " +
      ".emoji-picker-search, .d-emoji-picker__search, " +
      ".emoji-picker__search, [class*='category-buttons'], " +
      "[class*='emoji-search'], [class*='search'], " +
      ".emoji-picker-header, .emoji-picker__header, " +
      ".emoji-picker-body, .emoji-picker__body"
    );
    if (anchor) {
      anchor.parentNode.insertBefore(tabsEl, anchor);
    } else if (picker.firstElementChild) {
      picker.insertBefore(tabsEl, picker.firstElementChild);
    } else {
      picker.appendChild(tabsEl);
    }

    rewriteAll(picker);
  }

  // ── Picker detection ────────────────────────────────────────────────────

  // Finds a picker by scanning floating panels that contain emoji images.
  // This works even when class names are unknown.
  function findPickerByContent() {
    const candidates = document.querySelectorAll(
      [PICKER_SELECTORS,
       "[class*='menu-panel']", "[class*='d-menu']", "[class*='popup']",
       "[class*='modal']", "[class*='float']", "[class*='popover']",
       "[class*='panel']", "[class*='tooltip-content']",
      ].join(", ")
    );
    for (const el of candidates) {
      const imgs = el.querySelectorAll(EMOJI_IMG_SEL);
      if (imgs.length >= 3) return el;
    }
    return null;
  }

  function tryInitPicker(el) {
    if (!el || el.nodeType !== 1) return false;
    // Direct class match
    try {
      if (el.matches(PICKER_SELECTORS)) {
        later(() => buildTabs(el), 150);
        return true;
      }
      const child = el.querySelector(PICKER_SELECTORS);
      if (child) {
        later(() => buildTabs(child), 150);
        return true;
      }
    } catch (_) {}
    // Content heuristic: 3+ emoji images → treat as picker
    const imgs = el.querySelectorAll?.(EMOJI_IMG_SEL) || [];
    if (imgs.length >= 3) {
      later(() => buildTabs(el), 150);
      return true;
    }
    return false;
  }

  // Strategy: poll after any emoji button click (covers Glimmer pickers).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(
      ".emoji-picker-anchor, .emoji-picker-button, " +
      "[data-id='emoji'], button.emoji, .insert-emoji, " +
      ".btn-emoji, [title*='moji'], [aria-label*='moji'], " +
      "[title*='Emoji'], [aria-label*='Emoji']"
    );
    if (!btn) return;
    let attempts = 0;
    const poll = setInterval(() => {
      // First try known selectors, then content-based search.
      let picker = document.querySelector(PICKER_SELECTORS);
      if (!picker) picker = findPickerByContent();
      if (picker && !injectedPickers.has(picker)) {
        buildTabs(picker);
        clearInterval(poll);
      }
      if (++attempts > 30) clearInterval(poll);
    }, 80);
  }, true);

  // Classic Ember component hook (no-op on Glimmer-only forks).
  try {
    api.modifyClass("component:emoji-picker", {
      pluginId: "multi-platform-emoji",
      didInsertElement() {
        this._super?.(...arguments);
        if (this.element) later(() => buildTabs(this.element), 150);
      },
    });
  } catch (_) {}

});
