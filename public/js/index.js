import { StateManager } from "./state.js";
import { setupSidebarResizers } from "./layout.js";

// Global App Initialization
window.addEventListener("DOMContentLoaded", () => {
  const app = new StateManager();
  setupSidebarResizers(app);

  // Sidebar toggle
  document.getElementById("toggle-sidebar-btn")?.addEventListener("click", () => {
    app.toggleSidebar();
  });

  // Add Workspace button
  document.getElementById("add-ws-btn")?.addEventListener("click", () => {
    app.pickFolder();
  });

  // New Tab button (Instant 1-click create Terminal) & Dropdown Menu
  const newTabBtn = document.getElementById("new-tab-btn");
  const newTabMoreBtn = document.getElementById("new-tab-more-btn");
  const newTabMenu = document.getElementById("new-tab-menu");

  // Single click '+' -> Immediately spawn new Terminal tab
  newTabBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (newTabMenu) newTabMenu.classList.remove("open");
    app.createTab(null, "terminal");
  });

  // Click down arrow '▾' or right-click '+' -> Open dropdown menu
  newTabMoreBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    newTabMenu?.classList.toggle("open");
  });
  newTabBtn?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    newTabMenu?.classList.toggle("open");
  });

  newTabMenu?.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = item.getAttribute("data-action");
      newTabMenu?.classList.remove("open");

      if (action === "new-terminal") {
        app.createTab(null, "terminal");
      } else if (action === "new-browser") {
        app.createTab(null, "browser", { url: "http://localhost:3000" });
      } else if (action === "new-markdown") {
        app.createTab(null, "markdown", { isEditMode: true });
      } else if (action === "new-editor") {
        app.createTab(null, "editor");
      }
    });
  });

  window.addEventListener("click", (e) => {
    if (newTabMenu && newTabMenu.classList.contains("open")) {
      if (!newTabMenu.contains(e.target) && e.target !== newTabMoreBtn && e.target !== newTabBtn) {
        newTabMenu.classList.remove("open");
      }
    }
    document.querySelectorAll(".ws-dropdown-menu.open").forEach((menu) => {
      const moreBtn = menu.closest(".ws-actions")?.querySelector(".ws-more-btn");
      if (!menu.contains(e.target) && (!moreBtn || !moreBtn.contains(e.target))) {
        menu.classList.remove("open");
        menu.closest(".ws-actions")?.classList.remove("has-open-menu");
        menu.closest(".ws-item")?.classList.remove("has-open-menu");
      }
    });
  });

  // Right Sidebar Toggle (top-right header button & sidebar close button)
  document.getElementById("toggle-right-sidebar-btn")?.addEventListener("click", () => {
    app.toggleRightSidebar();
  });
  document.getElementById("rs-close-btn")?.addEventListener("click", () => {
    app.toggleRightSidebar(false);
  });

  // Switch between Explorer & Git tabs
  document.getElementById("rs-tab-explorer")?.addEventListener("click", () => {
    app.switchRightPanel("explorer");
  });
  document.getElementById("rs-tab-git")?.addEventListener("click", () => {
    app.switchRightPanel("git");
  });

  // Refresh buttons
  document.getElementById("rs-explorer-refresh")?.addEventListener("click", () => {
    app.loadExplorer(true);
  });
  document.getElementById("rs-git-refresh")?.addEventListener("click", () => {
    app.loadGitStatus();
  });

  // Git Commit actions
  document.getElementById("rs-commit-btn")?.addEventListener("click", () => {
    app.commitChanges();
  });
  document.getElementById("rs-commit-msg")?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      app.commitChanges();
    }
  });

  // File Preview Modal close
  const previewModal = document.getElementById("rs-preview-modal");
  document.getElementById("rs-preview-close")?.addEventListener("click", () => {
    if (previewModal) previewModal.style.display = "none";
  });
  previewModal?.querySelector(".rs-modal-overlay")?.addEventListener("click", () => {
    previewModal.style.display = "none";
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && previewModal && previewModal.style.display !== "none") {
      previewModal.style.display = "none";
    }
  });

  // Commits section accordion toggle
  const commitsTitle = document.getElementById("rs-commits-title");
  const commitsSection = document.getElementById("rs-git-commits-section");
  commitsTitle?.addEventListener("click", () => {
    commitsSection?.classList.toggle("collapsed");
  });

  // Global window resize
  window.addEventListener("resize", () => {
    if (app.activeTabId) {
      app.fitTerminal(app.activeTabId);
    }
  });

  // Global Context Menu handler & state hook
  window.customContextMenu = {
    target: null,
    handler: null,
    open(e, customHandler) {
      if (typeof customHandler === "function") {
        customHandler(e);
      }
    },
  };

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.customContextMenu.target = e.target;
    // ponytail: basic hook placeholder, full custom menu rendering added when UI components ready
    window.customContextMenu.open(e, window.customContextMenu.handler);
  });

  // Prevent disruptive browser default shortcuts
  const BLOCKED_MOD_KEYS = new Set(["r", "p", "s", "f", "g", "u", "o", "d", "h", "j", "t", "n", "w", "[", "]"]);

  window.addEventListener("keydown", (e) => {
    const key = e.key;
    const lowerKey = key.toLowerCase();
    const isMod = e.ctrlKey || e.metaKey;

    // F1 - F12 keys
    if (/^f([1-9]|1[0-2])$/i.test(key)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Backspace outside editable elements
    if (key === "Backspace") {
      const target = e.target;
      const isEditable = target && (
        target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.closest?.(".xterm")
      );
      if (!isEditable) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Alt + Left / Right navigation
    if (e.altKey && !isMod && (key === "ArrowLeft" || key === "ArrowRight")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (!isMod) return;

    // Sidebar shortcuts: Cmd/Ctrl + B (left), Cmd/Ctrl + L (right)
    if (!e.shiftKey && !e.altKey) {
      if (lowerKey === "b") {
        e.preventDefault();
        e.stopPropagation();
        app.toggleSidebar();
        return;
      }
      if (lowerKey === "l") {
        e.preventDefault();
        e.stopPropagation();
        app.toggleRightSidebar();
        return;
      }
    }

    // Ctrl/Cmd + Shift + I / J / C (DevTools) or Ctrl/Cmd + Shift + R (Hard reload)
    if (e.shiftKey && (lowerKey === "i" || lowerKey === "j" || lowerKey === "c" || lowerKey === "r")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Block standard browser single/combo hotkeys without breaking editing (c, v, x, a, z)
    if (!e.shiftKey && BLOCKED_MOD_KEYS.has(lowerKey)) {
      e.preventDefault();
      e.stopPropagation();

      window.dispatchEvent(new CustomEvent("app:shortcut", {
        detail: { key: lowerKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }
      }));
    }
  }, { capture: true });

  // Start PTY listener and fetch workspaces
  app.initPty();
  app.loadWorkspaces();
  app.startSystemStatusLoop();
});
