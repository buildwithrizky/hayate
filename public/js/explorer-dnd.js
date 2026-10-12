import { movePath, copyPath, saveFileContent } from "./api.js";
import { getExplorerNav } from "./explorer.js";

let draggedPaths = [];
let hoverExpandTimer = null;
let hoverExpandPath = null;

function clearHoverExpandTimer() {
  if (hoverExpandTimer) {
    clearTimeout(hoverExpandTimer);
    hoverExpandTimer = null;
  }
  hoverExpandPath = null;
}

export function setupDragAndDrop(row, item, state) {
  row.setAttribute("draggable", "true");

  row.addEventListener("dragstart", (e) => {
    const nav = getExplorerNav();
    if (nav && nav.selectedPaths.has(item.path)) {
      draggedPaths = Array.from(nav.selectedPaths);
    } else {
      draggedPaths = [item.path];
    }
    e.dataTransfer.setData("text/plain", item.path);
    e.dataTransfer.effectAllowed = "move";
    row.classList.add("is-dragging");
  });

  row.addEventListener("dragend", () => {
    row.classList.remove("is-dragging");
    clearDropIndicators();
    clearHoverExpandTimer();
    draggedPaths = [];
  });

  if (item.isDirectory) {
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hasFiles = e.dataTransfer.types.includes("Files");
      if (!hasFiles && (!draggedPaths.length || draggedPaths.includes(item.path))) return;
      if (!hasFiles && draggedPaths.some((p) => item.path.startsWith(p + "/") || item.path.startsWith(p + "\\"))) return;

      const isCopy = e.altKey;
      e.dataTransfer.dropEffect = (hasFiles || isCopy) ? "copy" : "move";
      row.classList.add("drop-target");

      // Auto-expand folder on hover after 500ms
      if (!state.openFolders.has(item.path)) {
        if (hoverExpandPath !== item.path) {
          clearHoverExpandTimer();
          hoverExpandPath = item.path;
          hoverExpandTimer = setTimeout(() => {
            state.openFolders.add(item.path);
            state.loadExplorer();
            clearHoverExpandTimer();
          }, 500);
        }
      } else {
        clearHoverExpandTimer();
      }
    });

    row.addEventListener("dragleave", (e) => {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove("drop-target");
        clearHoverExpandTimer();
      }
    });

    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearHoverExpandTimer();
      row.classList.remove("drop-target");

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await handleExternalFilesDrop(e.dataTransfer.files, item.path, state);
        return;
      }

      if (!draggedPaths.length) return;
      const isCopy = e.altKey;
      if (isCopy) {
        await copyItemsToDir(draggedPaths, item.path, state);
      } else {
        await moveItemsToDir(draggedPaths, item.path, state);
      }
    });
  }
}

export function setupTreeBackgroundDrop(treeEl, state) {
  treeEl.addEventListener("dragover", (e) => {
    if (e.target.closest(".rs-file-item.is-dir")) return;
    const hasFiles = e.dataTransfer.types.includes("Files");
    if (!hasFiles && !draggedPaths.length) return;
    e.preventDefault();
    const isCopy = e.altKey;
    e.dataTransfer.dropEffect = (hasFiles || isCopy) ? "copy" : "move";
    treeEl.classList.add("drop-target-root");
  });

  treeEl.addEventListener("dragleave", (e) => {
    if (!treeEl.contains(e.relatedTarget)) {
      treeEl.classList.remove("drop-target-root");
    }
  });

  treeEl.addEventListener("drop", async (e) => {
    treeEl.classList.remove("drop-target-root");
    clearHoverExpandTimer();
    if (e.target.closest(".rs-file-item.is-dir")) return;
    e.preventDefault();
    e.stopPropagation();

    const ws = state.getActiveWorkspace();
    if (!ws) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleExternalFilesDrop(e.dataTransfer.files, ws.path, state);
      return;
    }

    if (!draggedPaths.length) return;
    const isCopy = e.altKey;
    if (isCopy) {
      await copyItemsToDir(draggedPaths, ws.path, state);
    } else {
      await moveItemsToDir(draggedPaths, ws.path, state);
    }
  });
}

async function copyItemsToDir(sources, targetDir, state) {
  const sep = targetDir.includes("\\") && !targetDir.includes("/") ? "\\" : "/";
  for (const src of sources) {
    if (targetDir.startsWith(src + "/") || targetDir.startsWith(src + "\\") || targetDir === src) continue;
    const parts = src.split(/[/\\]+/).filter(Boolean);
    const name = parts[parts.length - 1];
    const dst = `${targetDir.replace(/[/\\]+$/, "")}${sep}${name}`;
    if (dst === src) continue;

    try {
      await copyPath(src, dst);
    } catch (err) {
      console.error("Failed to copy item:", src, "->", dst, err);
    }
  }
  state.openFolders.add(targetDir);
  await state.loadExplorer(true);
}

async function moveItemsToDir(sources, targetDir, state) {
  const sep = targetDir.includes("\\") && !targetDir.includes("/") ? "\\" : "/";
  for (const src of sources) {
    if (targetDir.startsWith(src + "/") || targetDir.startsWith(src + "\\") || targetDir === src) continue;
    const parts = src.split(/[/\\]+/).filter(Boolean);
    const name = parts[parts.length - 1];
    const dst = `${targetDir.replace(/[/\\]+$/, "")}${sep}${name}`;
    if (dst === src) continue;

    try {
      await movePath(src, dst);
      updateOpenTabsOnMove(state, src, dst);
    } catch (err) {
      console.error("Failed to move item:", src, "->", dst, err);
    }
  }
  state.openFolders.add(targetDir);
  await state.loadExplorer(true);
}

async function handleExternalFilesDrop(fileList, targetDir, state) {
  const sep = targetDir.includes("\\") && !targetDir.includes("/") ? "\\" : "/";
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const dst = `${targetDir.replace(/[/\\]+$/, "")}${sep}${file.name}`;
    if (file.path) {
      // OS file with native path available in Desktop webview
      try {
        await copyPath(file.path, dst);
        continue;
      } catch (err) {
        console.warn("Native copy failed, falling back to read text/content:", err);
      }
    }
    try {
      const text = await file.text();
      await saveFileContent(dst, text);
    } catch (err) {
      console.error("Failed to write dropped file:", file.name, err);
    }
  }
  state.openFolders.add(targetDir);
  await state.loadExplorer(true);
}

function clearDropIndicators() {
  document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  document.querySelectorAll(".drop-target-root").forEach((el) => el.classList.remove("drop-target-root"));
}

function updateOpenTabsOnMove(state, oldPath, newPath) {
  const parts = newPath.split(/[/\\]+/).filter(Boolean);
  const newName = parts[parts.length - 1];
  let changed = false;
  state.tabs.forEach((tab) => {
    if (tab.filePath === oldPath) {
      tab.filePath = newPath;
      tab.title = newName;
      changed = true;
    } else if (tab.filePath && (tab.filePath.startsWith(oldPath + "/") || tab.filePath.startsWith(oldPath + "\\"))) {
      tab.filePath = newPath + tab.filePath.slice(oldPath.length);
      changed = true;
    }
  });
  if (changed) state.renderTabs();
}
