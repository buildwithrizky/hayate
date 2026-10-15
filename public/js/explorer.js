import { tauriInvoke } from "./api.js";
import { escapeHtml, formatFileSize } from "./state.js";
import { showExplorerContextMenu } from "./explorer-menu.js";
import { getFileIcon } from "./explorer-icons.js";
import { setupDragAndDrop, setupTreeBackgroundDrop } from "./explorer-dnd.js";
import { ExplorerNav } from "./explorer-nav.js";
import { fetchDirectoryItems, getCompactChain } from "./explorer-compact.js";
import { updateClipboardVisuals } from "./explorer-clipboard.js";
import { applyFileNesting } from "./explorer-nesting.js";
import { startInlineCreate } from "./explorer-inline.js";
import { loadGitignore, matchGitignore, isPathIgnored } from "./explorer-gitignore.js";

export { fetchDirectoryItems, loadGitignore, matchGitignore, isPathIgnored };

let explorerNavInstance = null;

export function getExplorerNav() {
  return explorerNavInstance;
}

export function buildGitStatusIndex(gitStatusData) {
  if (!gitStatusData) return null;

  const fileMap = new Map();
  const dirSetM = new Set();
  const dirSetU = new Set();
  const untrackedDirs = [];

  const addDirAncestors = (filePath, isM) => {
    let slashIdx = filePath.lastIndexOf("/");
    while (slashIdx !== -1) {
      const dir = filePath.slice(0, slashIdx);
      if (isM) dirSetM.add(dir);
      else dirSetU.add(dir);
      slashIdx = dir.lastIndexOf("/");
    }
    if (isM) dirSetM.add("");
    else dirSetU.add("");
  };

  const indexItem = (filePath, rawStatus) => {
    if (!filePath) return;
    const isM = rawStatus === "M" || rawStatus === "D";
    const status = (rawStatus === "D") ? "D" : (rawStatus === "A" ? "A" : (isM ? "M" : "U"));
    if (!fileMap.has(filePath) || status === "M" || status === "D") {
      fileMap.set(filePath, status);
    }
    addDirAncestors(filePath, isM);
  };

  if (Array.isArray(gitStatusData.untracked)) {
    for (const f of gitStatusData.untracked) {
      fileMap.set(f, "U");
      addDirAncestors(f, false);
      if (f.endsWith("/")) {
        untrackedDirs.push(f.slice(0, -1));
      } else {
        untrackedDirs.push(f);
      }
    }
  }

  if (Array.isArray(gitStatusData.staged)) {
    for (const item of gitStatusData.staged) {
      indexItem(item.file, item.status);
    }
  }

  if (Array.isArray(gitStatusData.unstaged)) {
    for (const item of gitStatusData.unstaged) {
      indexItem(item.file, item.status);
    }
  }

  return { fileMap, dirSetM, dirSetU, untrackedDirs };
}

export function getFileGitStatus(state, filePath) {
  if (!state.gitStatusData) return null;
  const ws = state.getActiveWorkspace();
  if (!ws) return null;

  let relPath = filePath;
  if (filePath.startsWith(ws.path)) {
    relPath = filePath.slice(ws.path.length).replace(/^\/+/, "");
  }

  if (state.gitStatusData._index === undefined) {
    state.gitStatusData._index = buildGitStatusIndex(state.gitStatusData);
  }
  const idx = state.gitStatusData._index;
  if (!idx) return null;

  const direct = idx.fileMap.get(relPath);
  if (direct) return direct;

  for (const u of idx.untrackedDirs) {
    if (relPath.startsWith(u + "/")) return "U";
  }

  return null;
}

export function getFolderGitStatus(state, folderPath) {
  if (!state.gitStatusData) return null;
  const ws = state.getActiveWorkspace();
  if (!ws) return null;

  let relDir = folderPath;
  if (folderPath.startsWith(ws.path)) {
    relDir = folderPath.slice(ws.path.length).replace(/^\/+/, "");
  }
  relDir = relDir.replace(/\/+$/, "");

  if (state.gitStatusData._index === undefined) {
    state.gitStatusData._index = buildGitStatusIndex(state.gitStatusData);
  }
  const idx = state.gitStatusData._index;
  if (!idx) return null;

  let hasM = idx.dirSetM.has(relDir);
  let hasU = idx.dirSetU.has(relDir);

  if (!hasU && relDir) {
    for (const u of idx.untrackedDirs) {
      if (relDir.startsWith(u + "/") || relDir === u) {
        hasU = true;
        break;
      }
    }
  }

  if (hasM) return "M";
  if (hasU) return "U";
  return null;
}

// Partial git status refresh on existing explorer DOM without destroying tree
export function refreshGitStatusBadges(state) {
  const treeEl = document.getElementById("rs-files-tree");
  if (!treeEl) return;
  const rows = treeEl.querySelectorAll(".rs-file-item");
  if (rows.length === 0) return;

  const gitClasses = ["git-M", "git-A", "git-D", "git-R", "git-C", "git-U", "git-?"];

  rows.forEach((row) => {
    const path = row.getAttribute("data-path");
    const isDir = row.getAttribute("data-isdir") === "true";
    if (!path) return;

    gitClasses.forEach((cls) => row.classList.remove(cls));

    const gitStatus = isDir ? getFolderGitStatus(state, path) : getFileGitStatus(state, path);
    if (gitStatus) {
      row.classList.add(`git-${gitStatus}`);
    }

    const badgeEl = row.querySelector(".rs-git-badge");
    const isIgnored = row.classList.contains("is-ignored");

    if (badgeEl && !isIgnored) {
      if (gitStatus) {
        badgeEl.className = `rs-git-badge ${gitStatus}`;
        badgeEl.textContent = gitStatus;
      } else {
        badgeEl.remove();
      }
    } else if (!badgeEl && gitStatus && !isIgnored) {
      const badge = document.createElement("span");
      badge.className = `rs-git-badge ${gitStatus}`;
      badge.textContent = gitStatus;
      row.appendChild(badge);
    }
  });
}

export async function loadExplorer(state, forceRefresh = false) {
  const ws = state.getActiveWorkspace();
  const treeEl = document.getElementById("rs-files-tree");
  if (!treeEl) return;

  if (!explorerNavInstance || explorerNavInstance.treeEl !== treeEl) {
    explorerNavInstance = new ExplorerNav(treeEl, state);
    setupTreeBackgroundDrop(treeEl, state);
  }

  if (!ws) {
    treeEl.innerHTML = `<div class="rs-empty">No workspace selected</div>`;
    return;
  }

  if (forceRefresh) {
    state.folderCache.clear();
    await state.fetchGitStatusData();
  } else if (!state.gitStatusData) {
    await state.fetchGitStatusData();
  }

  treeEl.innerHTML = `<div class="rs-empty">Loading files...</div>`;
  const rawRootItems = await fetchDirectoryItems(state, ws.path);

  if (!rawRootItems || rawRootItems.length === 0) {
    treeEl.innerHTML = `<div class="rs-empty">Empty workspace directory</div>`;
    return;
  }

  const rootItems = applyFileNesting(rawRootItems);
  treeEl.innerHTML = "";
  for (const item of rootItems) {
    const node = await buildTreeNode(state, item, 0);
    treeEl.appendChild(node);
  }

  // Restore selection highlight if previously active
  if (explorerNavInstance.lastFocusedPath) {
    const prev = treeEl.querySelector(`.rs-file-item[data-path="${CSS.escape(explorerNavInstance.lastFocusedPath)}"]`);
    if (prev) {
      prev.classList.add("selected", "focused");
    }
  }

  updateClipboardVisuals();
}

export async function buildTreeNode(state, item, level) {
  const wrapper = document.createElement("div");
  wrapper.className = "rs-tree-node";

  // Compact folder resolution
  const { displayParts, finalItem } = await getCompactChain(state, item);
  const displayName = displayParts.join("/");
  const effectiveItem = finalItem;

  const row = document.createElement("div");
  row.className = `rs-file-item ${effectiveItem.isDirectory ? "is-dir" : "is-file"}`;
  row.setAttribute("data-path", effectiveItem.path);
  row.setAttribute("data-isdir", effectiveItem.isDirectory ? "true" : "false");

  const hasNested = Boolean(effectiveItem.nestedChildren && effectiveItem.nestedChildren.length > 0);
  const isExpandable = effectiveItem.isDirectory || hasNested;
  const isOpen = isExpandable && state.openFolders.has(effectiveItem.path);
  if (isOpen) row.classList.add("open");

  const isIgnored = isPathIgnored(state, effectiveItem.path, effectiveItem.isDirectory);
  const gitStatus = effectiveItem.isDirectory
    ? getFolderGitStatus(state, effectiveItem.path)
    : getFileGitStatus(state, effectiveItem.path);
  if (gitStatus) {
    row.classList.add(`git-${gitStatus}`);
  }
  if (isIgnored) {
    row.classList.add("is-ignored");
  }

  const chevronHtml = isExpandable
    ? `<span class="rs-chevron"><svg class="rs-chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>`
    : `<span class="rs-chevron rs-chevron-spacer"></span>`;

  const iconHtml = getFileIcon(effectiveItem.name, effectiveItem.isDirectory, isOpen);

  let badgeHtml = "";
  if (isIgnored) {
    badgeHtml = `<span class="rs-git-badge ignored" title="Git Ignored">&#8856;</span>`;
  } else if (gitStatus) {
    badgeHtml = `<span class="rs-git-badge ${gitStatus}">${gitStatus}</span>`;
  }

  row.innerHTML = `
    ${chevronHtml}
    ${iconHtml}
    <span class="rs-file-name" title="${escapeHtml(effectiveItem.path)}">${escapeHtml(displayName)}</span>
    ${badgeHtml}
  `;

  setupDragAndDrop(row, effectiveItem, state);
  wrapper.appendChild(row);

  const childrenContainer = document.createElement("div");
  childrenContainer.className = "rs-tree-children";
  childrenContainer.style.display = isOpen ? "flex" : "none";
  wrapper.appendChild(childrenContainer);

  if (isOpen) {
    if (effectiveItem.isDirectory) {
      const rawSub = await fetchDirectoryItems(state, effectiveItem.path);
      const subItems = applyFileNesting(rawSub);
      for (const sub of subItems) {
        const subNode = await buildTreeNode(state, sub, level + 1);
        childrenContainer.appendChild(subNode);
      }
    } else if (hasNested) {
      for (const sub of effectiveItem.nestedChildren) {
        const subNode = await buildTreeNode(state, sub, level + 1);
        childrenContainer.appendChild(subNode);
      }
    }
  }

  row.addEventListener("click", async (e) => {
    explorerNavInstance?.handleRowClick(e, effectiveItem, row);

    if (e.target.closest(".rs-chevron") && hasNested && !effectiveItem.isDirectory) {
      // Toggle nested children under file
      const willOpen = !state.openFolders.has(effectiveItem.path);
      if (willOpen) {
        state.openFolders.add(effectiveItem.path);
        row.classList.add("open");
        childrenContainer.innerHTML = "";
        childrenContainer.style.display = "flex";
        for (const sub of effectiveItem.nestedChildren) {
          const subNode = await buildTreeNode(state, sub, level + 1);
          childrenContainer.appendChild(subNode);
        }
      } else {
        state.openFolders.delete(effectiveItem.path);
        row.classList.remove("open");
        childrenContainer.style.display = "none";
      }
      return;
    }

    if (effectiveItem.isDirectory) {
      const willOpen = !state.openFolders.has(effectiveItem.path);
      const iconContainer = row.querySelector(".rs-file-icon.is-folder");

      if (willOpen) {
        state.openFolders.add(effectiveItem.path);
        row.classList.add("open");
        if (iconContainer) {
          iconContainer.outerHTML = getFileIcon(effectiveItem.name, true, true);
        }
        childrenContainer.innerHTML = '<div class="rs-empty rs-tree-empty">Loading...</div>';
        childrenContainer.style.display = "flex";

        const rawSub = await fetchDirectoryItems(state, effectiveItem.path);
        const subItems = applyFileNesting(rawSub);
        childrenContainer.innerHTML = "";
        if (subItems.length === 0) {
          childrenContainer.innerHTML = '<div class="rs-empty rs-tree-empty">(empty)</div>';
        } else {
          for (const sub of subItems) {
            const subNode = await buildTreeNode(state, sub, level + 1);
            childrenContainer.appendChild(subNode);
          }
        }
      } else {
        state.openFolders.delete(effectiveItem.path);
        row.classList.remove("open");
        if (iconContainer) {
          iconContainer.outerHTML = getFileIcon(effectiveItem.name, true, false);
        }
        childrenContainer.style.display = "none";
      }
    } else {
      openFileInWorkbench(state, effectiveItem.path);
    }
  });

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (explorerNavInstance && !explorerNavInstance.selectedPaths.has(effectiveItem.path)) {
      explorerNavInstance.focusPath(effectiveItem.path);
    }
    showExplorerContextMenu(state, e, effectiveItem, false);
  });

  return wrapper;
}

export function openFileInWorkbench(state, filePath, revealLine = null) {
  if (!filePath) return;
  const isImg = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(filePath);
  const isMd = /\.md$/i.test(filePath);
  const fileName = filePath.split(/[/\\]+/).filter(Boolean).pop() || filePath;

  const existing = state.tabs.find((t) => t.filePath === filePath && t.type !== "diff");
  if (existing) {
    state.switchTab(existing.id);
    if (revealLine) {
      scrollToLine(state, existing.id, revealLine);
    }
    return;
  }

  const type = isImg ? "image" : (isMd ? "markdown" : "editor");
  state.createTab(null, type, {
    title: fileName,
    filePath
  });

  if (revealLine) {
    const newTab = state.tabs.find((t) => t.filePath === filePath && t.type !== "diff");
    if (newTab) {
      setTimeout(() => scrollToLine(state, newTab.id, revealLine), 120);
    }
  }
}

function scrollToLine(state, tabId, lineNum) {
  const container = state.viewContainers.get(tabId);
  if (!container) return;
  const textarea = container.querySelector(".wb-textarea");
  if (!textarea) return;

  const lines = textarea.value.split("\n");
  let charIdx = 0;
  for (let i = 0; i < Math.min(lineNum - 1, lines.length); i++) {
    charIdx += lines[i].length + 1;
  }
  const endIdx = charIdx + (lines[lineNum - 1] ? lines[lineNum - 1].length : 0);

  textarea.focus();
  textarea.setSelectionRange(charIdx, endIdx);

  const approxLineHeight = 19;
  const targetScroll = Math.max(0, (lineNum - 4) * approxLineHeight);
  textarea.scrollTop = targetScroll;
}

export async function previewFile(state, filePath) {
  const modal = document.getElementById("rs-preview-modal");
  const titleEl = document.getElementById("rs-preview-title");
  const sizeEl = document.getElementById("rs-preview-size");
  const codeEl = document.getElementById("rs-preview-code");
  if (!modal || !titleEl || !codeEl) return;

  const fileName = filePath.split(/[/\\]+/).filter(Boolean).pop() || filePath;
  titleEl.textContent = fileName;
  sizeEl.textContent = "...";
  codeEl.textContent = "Loading...";
  modal.style.display = "flex";

  const isImg = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(filePath);
  try {
    if (isImg) {
      const [dataUrl, data] = await Promise.all([
        tauriInvoke("get_image_preview", { path: filePath }),
        tauriInvoke("get_file_content", { path: filePath }).catch(() => null)
      ]);
      sizeEl.textContent = formatFileSize(data?.size || 0);
      codeEl.innerHTML = `<img src="${dataUrl}" alt="${escapeHtml(fileName)}" style="max-width: 100%; max-height: 400px; object-fit: contain; display: block; margin: auto;" />`;
      return;
    }
    const data = await tauriInvoke("get_file_content", { path: filePath });
    sizeEl.textContent = formatFileSize(data.size || 0);
    codeEl.textContent = data.content || "(Empty file)";
  } catch (err) {
    codeEl.textContent = "Error: " + String(err);
    sizeEl.textContent = "";
  }
}

export function triggerExplorerNew(state, isDir = false) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  const nav = getExplorerNav();
  let targetDir = ws.path;
  let targetContainer = document.getElementById("rs-files-tree");

  if (nav && nav.lastFocusedPath) {
    const selectedRow = document.querySelector(`.rs-file-item[data-path="${CSS.escape(nav.lastFocusedPath)}"]`);
    if (selectedRow) {
      const isSelectedDir = selectedRow.getAttribute("data-isdir") === "true";
      if (isSelectedDir) {
        targetDir = nav.lastFocusedPath;
        if (!state.openFolders.has(targetDir)) {
          selectedRow.click();
        }
        targetContainer = selectedRow.parentElement.querySelector(".rs-tree-children") || targetContainer;
      } else {
        const sep = nav.lastFocusedPath.includes("\\") && !nav.lastFocusedPath.includes("/") ? "\\" : "/";
        const parts = nav.lastFocusedPath.split(/[/\\]+/).filter(Boolean);
        parts.pop();
        targetDir = parts.join(sep) || ws.path;
        targetContainer = selectedRow.parentElement.parentElement || targetContainer;
      }
    }
  }

  startInlineCreate(state, targetDir, isDir, targetContainer);
}

export function collapseAllFolders(state) {
  state.openFolders.clear();
  state.loadExplorer();
}
