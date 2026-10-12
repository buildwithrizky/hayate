import { listWorkspaceFiles } from "./api.js";
import { openFileInWorkbench } from "./explorer.js";

const MAX_RENDER_ITEMS = 50;

export class QuickOpenController {
  constructor(state) {
    this.state = state;
    this.modalEl = null;
    this.inputEl = null;
    this.listEl = null;
    this.isOpen = false;
    this.workspaceFiles = [];
    this.cachedWorkspacePath = null;
    this.filteredItems = [];
    this.selectedIndex = 0;
  }

  init() {
    this.createDom();
    this.bindEvents();
  }

  createDom() {
    if (document.getElementById("quick-open-modal")) {
      this.modalEl = document.getElementById("quick-open-modal");
      this.inputEl = this.modalEl.querySelector(".quick-open-input");
      this.listEl = this.modalEl.querySelector(".quick-open-list");
      return;
    }

    const modal = document.createElement("div");
    modal.id = "quick-open-modal";
    modal.className = "quick-open-modal";
    modal.style.display = "var(--display-none)";

    modal.innerHTML = `
      <div class="quick-open-overlay"></div>
      <div class="quick-open-window" role="dialog" aria-modal="true">
        <div class="quick-open-header">
          <input type="text" class="quick-open-input" placeholder="Search files by name (append :line to go to line)" autocomplete="off" spellcheck="false" />
        </div>
        <div class="quick-open-list" role="listbox"></div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalEl = modal;
    this.inputEl = modal.querySelector(".quick-open-input");
    this.listEl = modal.querySelector(".quick-open-list");
  }

  bindEvents() {
    this.modalEl.querySelector(".quick-open-overlay")?.addEventListener("click", () => {
      this.close();
    });

    this.inputEl?.addEventListener("input", () => {
      this.handleQueryChange();
    });

    this.inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveSelection(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveSelection(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.confirmSelection();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }

  async open() {
    const ws = this.state.getActiveWorkspace?.() || this.state.workspaces.find(w => w.id === this.state.activeWorkspaceId);
    if (!ws || !ws.path) return;

    this.isOpen = true;
    this.modalEl.style.display = "var(--display-flex)";
    this.inputEl.value = "";
    this.selectedIndex = 0;
    this.inputEl.focus();

    // Refresh file list if workspace changed or empty
    if (this.cachedWorkspacePath !== ws.path || this.workspaceFiles.length === 0) {
      this.cachedWorkspacePath = ws.path;
      try {
        const files = await listWorkspaceFiles(ws.path, 15000);
        this.workspaceFiles = Array.isArray(files) ? files : [];
      } catch (err) {
        console.error("Failed to list workspace files for quick open:", err);
        this.workspaceFiles = [];
      }
    }

    this.handleQueryChange();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.modalEl) {
      this.modalEl.style.display = "var(--display-none)";
    }
  }

  parseQuery(rawQuery) {
    const trimmed = rawQuery.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx >= 0) {
      const filePart = trimmed.slice(0, colonIdx).trim();
      const lineStr = trimmed.slice(colonIdx + 1).trim();
      const lineNum = parseInt(lineStr, 10);
      return {
        fileQuery: filePart,
        lineNumber: Number.isInteger(lineNum) && lineNum > 0 ? lineNum : null,
      };
    }
    return { fileQuery: trimmed, lineNumber: null };
  }

  scoreMatch(queryLower, relativePath) {
    if (!queryLower) return 0;
    const parts = relativePath.split("/");
    const basename = parts[parts.length - 1].toLowerCase();
    const pathLower = relativePath.toLowerCase();

    // Exact filename match
    if (basename === queryLower) return 1000;
    // Prefix filename match
    if (basename.startsWith(queryLower)) return 800;
    // Filename substring match
    if (basename.includes(queryLower)) return 500;
    // Path substring match
    if (pathLower.includes(queryLower)) return 200;

    // Fuzzy matching over path
    let score = 0;
    let queryIdx = 0;
    let matchedInBasename = false;
    const baseStartIdx = pathLower.length - basename.length;

    for (let i = 0; i < pathLower.length && queryIdx < queryLower.length; i++) {
      if (pathLower[i] === queryLower[queryIdx]) {
        if (i >= baseStartIdx) {
          score += 15;
          matchedInBasename = true;
        } else {
          score += 5;
        }
        queryIdx++;
      }
    }

    if (queryIdx === queryLower.length) {
      return matchedInBasename ? score + 100 : score;
    }

    return -1;
  }

  getRecentFiles(wsPath) {
    if (!this.state.tabs) return [];
    const recent = [];
    const seen = new Set();

    // Current active tabs first
    for (const tab of this.state.tabs) {
      if (tab.filePath && tab.filePath.startsWith(wsPath) && !seen.has(tab.filePath)) {
        seen.add(tab.filePath);
        let rel = tab.filePath.slice(wsPath.length);
        if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.slice(1);
        rel = rel.replace(/\\/g, "/");
        recent.push(rel);
      }
    }
    return recent;
  }

  handleQueryChange() {
    const rawVal = this.inputEl.value;
    const { fileQuery } = this.parseQuery(rawVal);
    const ws = this.state.getActiveWorkspace?.() || this.state.workspaces.find(w => w.id === this.state.activeWorkspaceId);
    const wsPath = ws?.path || "";

    if (!fileQuery) {
      // Show open tabs / recent files first, then top workspace files
      const recent = this.getRecentFiles(wsPath);
      const recentSet = new Set(recent);
      const combined = [...recent];
      for (const f of this.workspaceFiles) {
        if (!recentSet.has(f)) {
          combined.push(f);
          if (combined.length >= MAX_RENDER_ITEMS) break;
        }
      }
      this.filteredItems = combined.slice(0, MAX_RENDER_ITEMS).map((rel) => ({
        relPath: rel,
        score: 0,
      }));
    } else {
      const qLower = fileQuery.toLowerCase();
      const scored = [];

      for (const rel of this.workspaceFiles) {
        const score = this.scoreMatch(qLower, rel);
        if (score >= 0) {
          scored.push({ relPath: rel, score });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      this.filteredItems = scored.slice(0, MAX_RENDER_ITEMS);
    }

    this.selectedIndex = 0;
    this.renderList();
  }

  renderList() {
    if (!this.listEl) return;
    this.listEl.innerHTML = "";

    if (this.filteredItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "quick-open-empty";
      empty.textContent = "No matching files found";
      this.listEl.appendChild(empty);
      return;
    }

    this.filteredItems.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = `quick-open-item ${index === this.selectedIndex ? "selected" : ""}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", index === this.selectedIndex ? "true" : "false");

      const parts = item.relPath.split("/");
      const fileName = parts.pop() || item.relPath;
      const dirPath = parts.join("/");

      row.innerHTML = `
        <div class="quick-open-item-main">
          <span class="quick-open-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </span>
          <span class="quick-open-filename">${this.state.escapeHtml(fileName)}</span>
        </div>
        ${dirPath ? `<span class="quick-open-path">${this.state.escapeHtml(dirPath)}</span>` : ""}
      `;

      row.addEventListener("click", () => {
        this.selectedIndex = index;
        this.confirmSelection();
      });

      this.listEl.appendChild(row);
    });

    this.scrollSelectedIntoView();
  }

  moveSelection(delta) {
    if (this.filteredItems.length === 0) return;
    const len = this.filteredItems.length;
    this.selectedIndex = (this.selectedIndex + delta + len) % len;

    const items = this.listEl.querySelectorAll(".quick-open-item");
    items.forEach((el, idx) => {
      const isSelected = idx === this.selectedIndex;
      el.classList.toggle("selected", isSelected);
      el.setAttribute("aria-selected", isSelected ? "true" : "false");
    });

    this.scrollSelectedIntoView();
  }

  scrollSelectedIntoView() {
    const selected = this.listEl.querySelector(".quick-open-item.selected");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  confirmSelection() {
    if (this.filteredItems.length === 0) return;
    const selected = this.filteredItems[this.selectedIndex];
    if (!selected) return;

    const ws = this.state.getActiveWorkspace?.() || this.state.workspaces.find(w => w.id === this.state.activeWorkspaceId);
    if (!ws || !ws.path) return;

    const rawVal = this.inputEl.value;
    const { lineNumber } = this.parseQuery(rawVal);
    const fullPath = `${ws.path.replace(/[/\\]+$/, "")}/${selected.relPath}`;

    this.close();
    openFileInWorkbench(this.state, fullPath, lineNumber);
  }
}

// Singleton helper
let quickOpenInstance = null;
export function initQuickOpen(state) {
  if (!quickOpenInstance) {
    quickOpenInstance = new QuickOpenController(state);
    quickOpenInstance.init();
  }
  return quickOpenInstance;
}

export function openQuickOpen(state) {
  const instance = initQuickOpen(state);
  instance.open();
  return instance;
}
