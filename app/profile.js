// Split out of app.js: the account dropdown menu (open/close, outside-click
// and Escape handling), the in-place dark-mode toggle inside it, and account
// settings (name, avatar upload/remove). Depends on app/theme-language.js
// (closeLanguageMenu, closeBrowseMenu, toggleDarkMode) and
// app/backend-client.js (backendFetch, readJson), both loaded earlier.
// render is still defined later in the app.js trunk, so those calls go
// through window.SkillNestApp.render() instead of a destructure.
window.SkillNestApp = window.SkillNestApp || {};
Object.assign(window.SkillNestApp, (() => {
  const { readJson, backendFetch, closeLanguageMenu, closeBrowseMenu, toggleDarkMode } = window.SkillNestApp;

  function toggleProfileMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById("profileMenu");
    if (!menu) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    document.querySelector(".avatar-button")?.setAttribute("aria-expanded", String(willOpen));
  }

  function closeProfileMenu() {
    const menu = document.getElementById("profileMenu");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      document.querySelector(".avatar-button")?.setAttribute("aria-expanded", "false");
    }
  }

  document.addEventListener("click", (event) => {
    // Outside clicks close the menu; so do its navigation links (which fire
    // no hashchange when the target route is already active). The Appearance
    // toggle is a <button>, so it stays open for repeated flips.
    if (!event.target.closest(".profile-menu-wrap") || event.target.closest(".profile-menu a")) closeProfileMenu();
    if (!event.target.closest(".language-picker")) closeLanguageMenu();
    if (!event.target.closest(".nav-browse-dropdown") || event.target.closest(".nav-browse-menu a")) closeBrowseMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeProfileMenu();
      closeLanguageMenu();
      closeBrowseMenu();
    }
  });

  // Theme toggle inside the dropdown: flips the theme in place (same reason
  // as toggleDarkMode — no full render) and relabels itself.
  function toggleDarkModeFromMenu() {
    toggleDarkMode();
    const isDark = document.documentElement.classList.contains("dark-mode");
    const label = document.querySelector("[data-appearance-label]");
    if (label) label.textContent = `Appearance: ${isDark ? "Dark" : "Light"}`;
    const icon = document.querySelector("[data-appearance-icon]");
    if (icon) icon.textContent = isDark ? "☾" : "☀";
  }

  // ── Account settings ───────────────────────────────────────────────────────

  function storeAccountFields(account) {
    const current = readJson("skillnestAccount", {});
    localStorage.setItem("skillnestAccount", JSON.stringify({ ...current, ...account }));
  }

  // Downscale to a small square so avatars stay a few KB — kind to both the
  // users table and the localStorage copy of the account.
  function resizeImageToDataUrl(file, maxSize = 256) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85));
        };
        img.onerror = () => reject(new Error("That file couldn't be read as an image."));
        img.src = String(reader.result || "");
      };
      reader.onerror = () => reject(new Error("That file couldn't be read."));
      reader.readAsDataURL(file);
    });
  }

  async function handleAvatarFile(event) {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("Choose an image file for your profile picture.");
      return;
    }
    let avatarData;
    try {
      avatarData = await resizeImageToDataUrl(file);
    } catch (error) {
      window.alert(error.message || "That image couldn't be processed.");
      return;
    }
    const result = await backendFetch("/api/auth/profile", { method: "POST", body: { avatarData } });
    if (!result?.ok) {
      window.alert(result?.error || "The backend is unreachable, so your picture wasn't saved.");
      return;
    }
    storeAccountFields(result.account);
    localStorage.setItem("hatchSettingsNotice", "Profile picture updated.");
    window.SkillNestApp.render();
    window.setTimeout(() => {
      localStorage.removeItem("hatchSettingsNotice");
    }, 4000);
  }

  async function removeAvatar() {
    const result = await backendFetch("/api/auth/profile", { method: "POST", body: { removeAvatar: true } });
    if (!result?.ok) {
      window.alert(result?.error || "The backend is unreachable, so your picture wasn't removed.");
      return;
    }
    storeAccountFields(result.account);
    localStorage.removeItem("hatchSettingsNotice");
    window.SkillNestApp.render();
  }

  async function saveAccountSettings(event) {
    event.preventDefault();
    const name = document.getElementById("settingsName")?.value.trim() || "";
    if (!name) return;
    const result = await backendFetch("/api/auth/profile", { method: "POST", body: { name } });
    if (!result?.ok) {
      window.alert(result?.error || "The backend is unreachable, so your changes weren't saved.");
      return;
    }
    storeAccountFields(result.account);
    localStorage.setItem("hatchSettingsNotice", "Display name saved.");
    window.SkillNestApp.render();
    window.setTimeout(() => {
      localStorage.removeItem("hatchSettingsNotice");
    }, 4000);
  }

  return {
    toggleProfileMenu,
    toggleDarkModeFromMenu,
    handleAvatarFile,
    removeAvatar,
    saveAccountSettings,
  };
})());
