import { deletePath } from "./api.js";
import { showConfirmDialog } from "./dialog.js";
import { startInlineRename } from "./explorer-inline.js";
import { setExplorerClipboard, executePaste } from "./explorer-clipboard.js";
import { ExplorerTypeahead } from "./explorer-typeahead.js";

export class ExplorerNav {
  constructor(treeEl, state) {
    this.treeEl = treeEl;
    this.state = state;
    this.selectedPaths = new Set();
    this.lastFocusedPath = null;
    this.typeahead = new ExplorerTypeahead(treeEl, this);
    this.initEvents();
  }

  initEvents() {
    this.treeEl.setAttribute("tabindex", "0");
    this.treeEl.addEventListener("keydown", (e) => this.handleKeyDown(e));
  }

  getVisibleRows() {
    return Array.from(this.treeEl.querySelectorAll(".rs-file-item")).filter((row) => {
      return row.offsetParent !== null;
    });
  }

  getSelectedRows() {
    return Array.from(this.treeEl.querySelectorAll(".rs-file-item.selected"));
  }

  handleRowClick(e, item, row) {
    const isCmd = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;
    const allRows = this.getVisibleRows();

    if (isShift && this.lastFocusedPath) {
      // Range select
      const lastIdx = allRows.findIndex((r) => r.getAttribute("data-path") === this.lastFocusedPath);
      const currIdx = allRows.findIndex((r) => r === row);
      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        this.clearSelection();
        for (let i = start; i <= end; i++) {
          const r = allRows[i];
          const p = r.getAttribute("data-path");
          this.selectedPaths.add(p);
          r.classList.add("selected");
        }
      }
    } else if (isCmd) {
      // Toggle select
      if (this.selectedPaths.has(item.path)) {
        this.selectedPaths.delete(item.path);
        row.classList.remove("selected");
      } else {
        this.selectedPaths.add(item.path);
        row.classList.add("selected");
      }
      this.lastFocusedPath = item.path;
    } else {
      // Single select
      this.clearSelection();
      this.selectedPaths.add(item.path);
      row.classList.add("selected");
      this.lastFocusedPath = item.path;
    }

    allRows.forEach((r) => r.classList.remove("focused"));
    row.classList.add("focused");
  }

  clearSelection() {
    this.selectedPaths.clear();
    this.treeEl.querySelectorAll(".rs-file-item.selected").forEach((r) => r.classList.remove("selected"));
  }

  focusPath(targetPath) {
    const row = this.treeEl.querySelector(`.rs-file-item[data-path="${CSS.escape(targetPath)}"]`);
    if (!row) return;
    this.clearSelection();
    this.selectedPaths.add(targetPath);
    this.lastFocusedPath = targetPath;
    row.classList.add("selected", "focused");
    row.scrollIntoView({ block: "nearest" });
  }

  async handleKeyDown(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    // Clipboard shortcuts: Cmd+C, Cmd+X, Cmd+V
    const isCmd = e.metaKey || e.ctrlKey;
    if (isCmd && !e.shiftKey && !e.altKey) {
      const lower = e.key.toLowerCase();
      if (lower === "c") {
        e.preventDefault();
        const targets = this.selectedPaths.size > 0
          ? Array.from(this.selectedPaths)
          : (this.lastFocusedPath ? [this.lastFocusedPath] : []);
        setExplorerClipboard("copy", targets);
        return;
      }
      if (lower === "x") {
        e.preventDefault();
        const targets = this.selectedPaths.size > 0
          ? Array.from(this.selectedPaths)
          : (this.lastFocusedPath ? [this.lastFocusedPath] : []);
        setExplorerClipboard("cut", targets);
        return;
      }
      if (lower === "v") {
        e.preventDefault();
        let targetDir = this.state.getActiveWorkspace()?.path;
        if (this.lastFocusedPath) {
          const row = this.treeEl.querySelector(`.rs-file-item[data-path="${CSS.escape(this.lastFocusedPath)}"]`);
          const isDir = row?.getAttribute("data-isdir") === "true";
          if (isDir) {
            targetDir = this.lastFocusedPath;
          } else {
            const sep = this.lastFocusedPath.includes("\\") && !this.lastFocusedPath.includes("/") ? "\\" : "/";
            const parts = this.lastFocusedPath.split(/[/\\]+/).filter(Boolean);
            parts.pop();
            targetDir = parts.join(sep) || sep;
          }
        }
        if (targetDir) {
          await executePaste(this.state, targetDir);
        }
        return;
      }
    }

    // Typeahead navigation check
    if (this.typeahead.handleKeyDown(e)) {
      e.preventDefault();
      return;
    }

    const rows = this.getVisibleRows();
    if (!rows.length) return;

    let focusedRow = this.treeEl.querySelector(".rs-file-item.focused");
    if (!focusedRow && this.lastFocusedPath) {
      focusedRow = this.treeEl.querySelector(`.rs-file-item[data-path="${CSS.escape(this.lastFocusedPath)}"]`);
    }
    if (!focusedRow && rows.length > 0) {
      focusedRow = rows[0];
    }
    if (!focusedRow) return;

    const currIdx = rows.indexOf(focusedRow);
    const isDir = focusedRow.getAttribute("data-isdir") === "true";
    const path = focusedRow.getAttribute("data-path");

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const nextIdx = Math.min(currIdx + 1, rows.length - 1);
        this.moveFocus(rows, nextIdx, e.shiftKey);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prevIdx = Math.max(currIdx - 1, 0);
        this.moveFocus(rows, prevIdx, e.shiftKey);
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        if (isDir) {
          if (!this.state.openFolders.has(path)) {
            focusedRow.click();
          } else {
            // Focus first child
            if (currIdx + 1 < rows.length) {
              this.moveFocus(rows, currIdx + 1, false);
            }
          }
        }
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        if (isDir && this.state.openFolders.has(path)) {
          focusedRow.click();
        } else {
          // Focus parent directory
          const parentRow = this.findParentRow(focusedRow);
          if (parentRow) {
            const idx = rows.indexOf(parentRow);
            if (idx !== -1) this.moveFocus(rows, idx, false);
          }
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        if (isDir) {
          focusedRow.click();
        } else {
          this.state.openFileInWorkbench(path);
        }
        break;
      }
      case "F2": {
        e.preventDefault();
        startInlineRename(this.state, path, focusedRow);
        break;
      }
      case "Delete":
      case "Backspace": {
        if (!e.metaKey && !e.ctrlKey && e.key === "Backspace") return;
        e.preventDefault();
        await this.deleteSelectedItems();
        break;
      }
    }
  }

  moveFocus(rows, targetIdx, isShift) {
    const targetRow = rows[targetIdx];
    if (!targetRow) return;
    const path = targetRow.getAttribute("data-path");

    if (!isShift) {
      this.clearSelection();
    }
    this.selectedPaths.add(path);
    this.lastFocusedPath = path;

    rows.forEach((r) => r.classList.remove("focused"));
    targetRow.classList.add("selected", "focused");
    targetRow.scrollIntoView({ block: "nearest" });
  }

  findParentRow(row) {
    const parentContainer = row.closest(".rs-tree-children");
    if (!parentContainer) return null;
    const parentNode = parentContainer.closest(".rs-tree-node");
    return parentNode ? parentNode.querySelector(":scope > .rs-file-item") : null;
  }

  async deleteSelectedItems() {
    const items = Array.from(this.selectedPaths);
    if (!items.length) return;

    const count = items.length;
    const message = count === 1
      ? `Are you sure you want to delete "${items[0].split(/[/\\]+/).pop()}"?`
      : `Are you sure you want to delete ${count} items?`;

    const ok = await showConfirmDialog({
      title: "Delete",
      message,
      confirmLabel: "Delete",
      isDanger: true,
    });
    if (!ok) return;

    for (const itemPath of items) {
      try {
        await deletePath(itemPath);
        const toClose = this.state.tabs
          .filter((t) => t.filePath === itemPath || (t.filePath && (t.filePath.startsWith(itemPath + "/") || t.filePath.startsWith(itemPath + "\\"))))
          .map((t) => t.id);
        toClose.forEach((id) => this.state.closeTab(id));
      } catch (err) {
        console.error("Failed to delete item:", itemPath, err);
      }
    }
    this.clearSelection();
    await this.state.loadExplorer(true);
  }
}
