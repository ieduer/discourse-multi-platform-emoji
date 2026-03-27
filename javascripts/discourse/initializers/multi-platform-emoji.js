import { apiInitializer } from "discourse/lib/api";

const PLATFORM_PREFIXES = ["apple", "twemoji", "noto", "fluent", "openmoji"];

const PLATFORM_ICONS = {
  all: "globe",
  apple: "apple",
  twemoji: "twitter",
  noto: "google",
  fluent: "microsoft",
  openmoji: "paint-brush",
  custom: "star",
};

function getPlatformFromEmojiName(name) {
  for (const prefix of PLATFORM_PREFIXES) {
    if (name.startsWith(prefix + "_")) {
      return prefix;
    }
  }
  return "custom";
}

function getEnabledPlatforms(settings) {
  const raw = settings.emoji_platforms_enabled || "twemoji|noto|fluent|openmoji";
  return raw.split("|").map((s) => s.trim()).filter(Boolean);
}

export default apiInitializer("1.0", (api) => {
  const settings = api.container.lookup("service:site-settings");

  // Skip if disabled via component settings
  if (!settings.multi_platform_emoji_enabled) {
    return;
  }

  const enabledPlatforms = getEnabledPlatforms(settings);

  // Extend the emoji picker to add platform filter tabs for custom emoji
  api.modifyClass("component:emoji-picker", {
    pluginId: "multi-platform-emoji",

    didInsertElement() {
      this._super(...arguments);
      this._injectPlatformTabs();
    },

    _injectPlatformTabs() {
      // Wait for the custom emoji section to render
      const observer = new MutationObserver(() => {
        const customSection = this.element?.querySelector(
          ".emoji-picker-category-custom, .section[data-section='custom']"
        );
        if (customSection && !this.element.querySelector(".platform-emoji-tabs")) {
          this._buildPlatformTabsUI(customSection);
          observer.disconnect();
        }
      });

      if (this.element) {
        observer.observe(this.element, { childList: true, subtree: true });

        // Also try immediately in case DOM is already ready
        const customSection = this.element.querySelector(
          ".emoji-picker-category-custom, .section[data-section='custom']"
        );
        if (customSection && !this.element.querySelector(".platform-emoji-tabs")) {
          this._buildPlatformTabsUI(customSection);
          observer.disconnect();
        }
      }
    },

    _buildPlatformTabsUI(customSection) {
      const tabsContainer = document.createElement("div");
      tabsContainer.className = "platform-emoji-tabs";

      // "All" tab
      const allTab = this._createTab("all", true);
      tabsContainer.appendChild(allTab);

      // Platform tabs
      enabledPlatforms.forEach((platform) => {
        const tab = this._createTab(platform, false);
        tabsContainer.appendChild(tab);
      });

      // "Other custom" tab
      const customTab = this._createTab("custom", false);
      tabsContainer.appendChild(customTab);

      customSection.parentNode.insertBefore(tabsContainer, customSection);
    },

    _createTab(platform, isActive) {
      const tab = document.createElement("button");
      tab.className = `platform-tab ${isActive ? "active" : ""}`;
      tab.dataset.platform = platform;
      tab.type = "button";

      const style = settings.platform_tab_style || "icons";
      const icon = PLATFORM_ICONS[platform] || "circle";
      const label = platform.charAt(0).toUpperCase() + platform.slice(1);

      if (style === "icons" || style === "both") {
        const iconEl = document.createElement("span");
        iconEl.className = `platform-icon platform-icon-${platform}`;
        iconEl.setAttribute("aria-hidden", "true");
        tab.appendChild(iconEl);
      }

      if (style === "text" || style === "both") {
        const textEl = document.createElement("span");
        textEl.className = "platform-label";
        textEl.textContent = label;
        tab.appendChild(textEl);
      }

      tab.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._filterByPlatform(platform);

        // Update active state
        const parent = tab.closest(".platform-emoji-tabs");
        if (parent) {
          parent.querySelectorAll(".platform-tab").forEach((t) => t.classList.remove("active"));
          tab.classList.add("active");
        }
      });

      return tab;
    },

    _filterByPlatform(platform) {
      if (!this.element) return;

      const customEmojis = this.element.querySelectorAll(
        ".emoji-picker-category-custom img.emoji, " +
        ".section[data-section='custom'] img.emoji, " +
        ".custom-emoji-container img.emoji"
      );

      customEmojis.forEach((img) => {
        const emojiName = img.title || img.alt || img.dataset.emoji || "";
        const cleanName = emojiName.replace(/^:/, "").replace(/:$/, "");
        const emojiPlatform = getPlatformFromEmojiName(cleanName);

        const listItem = img.closest("button, .emoji-picker-emoji, [data-emoji]") || img;

        if (platform === "all") {
          listItem.style.display = "";
        } else {
          listItem.style.display = emojiPlatform === platform ? "" : "none";
        }
      });
    },
  });

  // Add platform prefix to emoji tooltip if setting enabled
  if (settings.show_platform_prefix) {
    api.decorateCooked(
      ($elem) => {
        $elem.querySelectorAll("img.emoji[title]").forEach((img) => {
          const name = img.title.replace(/^:/, "").replace(/:$/, "");
          const platform = getPlatformFromEmojiName(name);
          if (platform !== "custom") {
            const displayName = name.replace(`${platform}_`, "");
            img.title = `:${name}: (${platform})`;
            img.alt = displayName;
          }
        });
      },
      { id: "multi-platform-emoji-tooltip" }
    );
  }
});
