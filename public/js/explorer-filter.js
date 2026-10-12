export class ExplorerTreeFilter {
  constructor(treeEl, state) {
    this.treeEl = treeEl;
    this.state = state;
    this.filterBar = document.getElementById("rs-tree-filter-bar");
    this.input = document.getElementById("rs-tree-filter-input");
    this.closeBtn = document.getElementById("rs-tree-filter-close");
    this.badge = document.getElementById("rs-tree-filter-badge");
    this.isOpen = false;
    this.savedOpenFolders = null;

    this.bindEvents();
  }

  bindEvents() {
    this.input?.addEventListener("input", () => this.applyFilter());
    this.input?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    this.closeBtn?.addEventListener("click", () => this.close());
  }

  open() {
    if (!this.filterBar || !this.input) return;
    this.isOpen = true;
    this.savedOpenFolders = new Set(this.state.openFolders);
    this.filterBar.classList.remove("is-hidden");
    this.input.focus();
    this.input.select();
    this.applyFilter();
  }

  close() {
    if (!this.filterBar || !this.input) return;
    this.isOpen = false;
    this.filterBar.classList.add("is-hidden");
    this.input.value = "";
    if (this.badge) this.badge.textContent = "";

    // Restore tree visibility
    this.treeEl.querySelectorAll(".rs-tree-node").forEach((node) => {
      node.style.display = "";
    });

    // Restore original open/collapsed state if available
    if (this.savedOpenFolders) {
      this.state.openFolders = new Set(this.savedOpenFolders);
      this.savedOpenFolders = null;
      this.state.loadExplorer(false);
    }

    this.treeEl.focus();
  }

  applyFilter() {
    const query = this.input ? this.input.value.trim().toLowerCase() : "";
    const allNodes = Array.from(this.treeEl.querySelectorAll(".rs-tree-node"));

    if (!query) {
      allNodes.forEach((n) => (n.style.display = ""));
      if (this.badge) this.badge.textContent = "";
      return;
    }

    let matchCount = 0;
    const matchingPaths = new Set();
    const parentPathsToExpand = new Set();

    // First pass: identify matched rows
    const allRows = Array.from(this.treeEl.querySelectorAll(".rs-file-item"));
    allRows.forEach((row) => {
      const nameEl = row.querySelector(".rs-file-name");
      const name = (nameEl ? nameEl.textContent : "").toLowerCase();
      const path = row.getAttribute("data-path") || "";
      if (name.includes(query)) {
        matchingPaths.add(path);
        matchCount++;

        // Add parent paths to expand
        const ws = this.state.getActiveWorkspace();
        if (ws && path.startsWith(ws.path)) {
          let curr = path;
          while (curr.length > ws.path.length) {
            const lastSep = Math.max(curr.lastIndexOf("/"), curr.lastIndexOf("\\"));
            if (lastSep <= ws.path.length) break;
            curr = curr.substring(0, lastSep);
            parentPathsToExpand.add(curr);
          }
        }
      }
    });

    // Auto expand parent folders in state
    parentPathsToExpand.forEach((p) => {
      this.state.openFolders.add(p);
      const parentRow = this.treeEl.querySelector(`.rs-file-item[data-path="${CSS.escape(p)}"]`);
      const chevron = parentRow?.querySelector(".rs-chevron");
      chevron?.classList.remove("collapsed");
      const parentNode = parentRow?.closest(".rs-tree-node");
      const childrenBox = parentNode?.querySelector(".rs-tree-children");
      if (childrenBox) {
        childrenBox.style.display = "var(--display-flex)";
      }
    });

    // Second pass: hide nodes that don't match or don't contain matches
    allNodes.forEach((node) => {
      const row = node.querySelector(":scope > .rs-file-item");
      const path = row?.getAttribute("data-path") || "";
      const isDir = row?.getAttribute("data-isdir") === "true";

      const selfMatches = matchingPaths.has(path);
      const hasMatchingChild = isDir && Array.from(matchingPaths).some((mp) => mp.startsWith(path + "/") || mp.startsWith(path + "\\"));

      if (selfMatches || hasMatchingChild) {
        node.style.display = "";
      } else {
        node.style.display = "var(--display-none)";
      }
    });

    if (this.badge) {
      this.badge.textContent = `${matchCount} match${matchCount === 1 ? "" : "es"}`;
    }
  }
}
