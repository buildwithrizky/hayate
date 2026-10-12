import { deletePath, revealInFinder, copyPath } from "./api.js";
import { showConfirmDialog } from "./dialog.js";
import { startInlineRename, startInlineCreate } from "./explorer-inline.js";
import { getExplorerClipboard, setExplorerClipboard, executePaste } from "./explorer-clipboard.js";
import { getExplorerNav } from "./explorer.js";

let activeContextMenuEl = null;

export function closeExplorerContextMenu() {
  if (activeContextMenuEl) {
    activeContextMenuEl.remove();
    activeContextMenuEl = null;
  }
}

export function initContextMenuEvents() {
  window.addEventListener("click", (e) => {
    if (activeContextMenuEl && !activeContextMenuEl.contains(e.target)) {
      closeExplorerContextMenu();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeContextMenuEl) {
      closeExplorerContextMenu();
    }
  });
}

function splitPath(fullPath) {
  return fullPath.split(/[/\\]+/);
}

function getSeparator(fullPath) {
  return fullPath.includes("\\") && !fullPath.includes("/") ? "\\" : "/";
}

function getBasename(fullPath) {
  const parts = splitPath(fullPath).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function getParentDir(fullPath, isDir) {
  if (isDir) return fullPath;
  const sep = getSeparator(fullPath);
  const parts = fullPath.split(/[/\\]+/);
  parts.pop();
  return parts.join(sep) || sep;
}

function getRelativePath(fullPath, wsPath) {
  if (fullPath.startsWith(wsPath)) {
    return fullPath.slice(wsPath.length).replace(/^[/\\]+/, "");
  }
  return fullPath;
}

function joinPath(dir, name) {
  const sep = getSeparator(dir);
  return `${dir.replace(/[/\\]+$/, "")}${sep}${name}`;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
  } catch (err) {
    console.error("Clipboard copy failed:", err);
  }
}

export function showExplorerContextMenu(state, event, item, isBackground = false) {
  closeExplorerContextMenu();

  const ws = state.getActiveWorkspace();
  if (!ws) return;

  const targetPath = item ? item.path : ws.path;
  const isDir = item ? item.isDirectory : true;
  const targetDir = getParentDir(targetPath, isDir);

  const menu = document.createElement("div");
  menu.className = "rs-context-menu";

  const actions = [];
  const clipboard = getExplorerClipboard();
  const nav = getExplorerNav();
  const selectedPaths = nav && nav.selectedPaths.size > 0 && item && nav.selectedPaths.has(item.path)
    ? Array.from(nav.selectedPaths)
    : (item ? [item.path] : []);

  if (isBackground) {
    actions.push(
      {
        label: "New File",
        action: () => {
          const treeEl = document.getElementById("rs-files-tree");
          startInlineCreate(state, ws.path, false, treeEl);
        },
      },
      {
        label: "New Folder",
        action: () => {
          const treeEl = document.getElementById("rs-files-tree");
          startInlineCreate(state, ws.path, true, treeEl);
        },
      },
      { type: "separator" },
      {
        label: "Paste",
        disabled: !clipboard || !clipboard.paths.length,
        action: () => executePaste(state, ws.path),
      },
      { type: "separator" },
      {
        label: "Open in Integrated Terminal",
        action: () => {
          state.createTab(ws, "terminal", { cwd: ws.path });
        },
      },
      { label: "Reveal in Finder", action: () => revealInFinder(ws.path).catch(console.error) }
    );
  } else {
    const rowEl = event.target.closest(".rs-file-item");
    const container = isDir && rowEl ? rowEl.parentElement.querySelector(".rs-tree-children") : rowEl?.parentElement?.parentElement;

    actions.push(
      {
        label: "Cut",
        shortcut: "Cmd+X",
        action: () => setExplorerClipboard("cut", selectedPaths),
      },
      {
        label: "Copy",
        shortcut: "Cmd+C",
        action: () => setExplorerClipboard("copy", selectedPaths),
      },
      {
        label: "Paste",
        shortcut: "Cmd+V",
        disabled: !clipboard || !clipboard.paths.length || !isDir,
        action: () => executePaste(state, targetDir),
      },
      { type: "separator" },
      {
        label: "New File",
        action: () => {
          if (isDir && rowEl && !state.openFolders.has(targetPath)) {
            rowEl.click();
          }
          startInlineCreate(state, targetDir, false, container);
        },
      },
      {
        label: "New Folder",
        action: () => {
          if (isDir && rowEl && !state.openFolders.has(targetPath)) {
            rowEl.click();
          }
          startInlineCreate(state, targetDir, true, container);
        },
      },
      ...(isDir
        ? [
            {
              label: "Find in Folder...",
              action: () => {
                const rel = getRelativePath(targetPath, ws.path);
                const scope = rel ? `${rel}/*` : "";
                state.openSearchWithScope?.(scope);
              },
            },
            {
              label: "Open in Integrated Terminal",
              action: () => {
                state.createTab(ws, "terminal", { cwd: targetPath });
              },
            },
          ]
        : []),
      { label: "Reveal in Finder", action: () => revealInFinder(targetPath).catch(console.error) },
      { type: "separator" },
      {
        label: "Duplicate",
        action: () => duplicateItem(state, targetPath, item ? item.name : getBasename(targetPath)),
      },
      {
        label: "Copy Path",
        action: async () => {
          await copyToClipboard(targetPath);
        },
      },
      {
        label: "Copy Relative Path",
        action: async () => {
          await copyToClipboard(getRelativePath(targetPath, ws.path));
        },
      },
      { type: "separator" },
      {
        label: "Rename",
        action: () => {
          if (rowEl) {
            startInlineRename(state, targetPath, rowEl);
          }
        },
      },
      { label: "Delete", isDanger: true, action: () => promptDelete(state, targetPath, isDir) }
    );
  }

  for (const act of actions) {
    if (act.type === "separator") {
      const sep = document.createElement("div");
      sep.className = "rs-context-menu-separator";
      menu.appendChild(sep);
      continue;
    }
    const itemEl = document.createElement("button");
    itemEl.type = "button";
    itemEl.className = `rs-context-menu-item ${act.isDanger ? "is-danger" : ""} ${act.disabled ? "is-disabled" : ""}`;
    if (act.disabled) {
      itemEl.disabled = true;
    }
    const shortcutHtml = act.shortcut ? `<span class="rs-menu-shortcut">${act.shortcut}</span>` : "";
    itemEl.innerHTML = `<span>${act.label}</span>${shortcutHtml}`;
    itemEl.onclick = async (e) => {
      e.stopPropagation();
      if (act.disabled) return;
      const actionFn = act.action;
      closeExplorerContextMenu();
      await actionFn();
    };
    menu.appendChild(itemEl);
  }

  document.body.appendChild(menu);
  activeContextMenuEl = menu;

  const { clientX: x, clientY: y } = event;
  const menuRect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - menuRect.width - 6;
  const maxY = window.innerHeight - menuRect.height - 6;

  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top = `${Math.min(y, maxY)}px`;
}

async function duplicateItem(state, srcPath, currentName) {
  const sep = getSeparator(srcPath);
  const parts = srcPath.split(/[/\\]+/).filter(Boolean);
  parts.pop();
  const parent = parts.join(sep) || sep;

  const dotIdx = currentName.lastIndexOf(".");
  let base = currentName;
  let ext = "";
  if (dotIdx > 0) {
    base = currentName.slice(0, dotIdx);
    ext = currentName.slice(dotIdx);
  }

  let copyName = `${base} copy${ext}`;
  let dstPath = joinPath(parent, copyName);

  try {
    await copyPath(srcPath, dstPath);
    await state.loadExplorer(true);
  } catch (err) {
    console.error("Failed to duplicate item:", err);
  }
}

async function promptDelete(state, targetPath, isDir) {
  const name = getBasename(targetPath);
  const kind = isDir ? "folder" : "file";
  const ok = await showConfirmDialog({
    title: `Delete ${kind}`,
    message: `Are you sure you want to delete "${name}"?`,
    confirmLabel: "Delete",
    isDanger: true,
  });
  if (!ok) return;

  try {
    await deletePath(targetPath);
    const toClose = state.tabs
      .filter((t) => t.filePath === targetPath || (isDir && t.filePath && (t.filePath.startsWith(targetPath + "/") || t.filePath.startsWith(targetPath + "\\"))))
      .map((t) => t.id);

    toClose.forEach((tabId) => state.closeTab(tabId));
    await state.loadExplorer(true);
  } catch (err) {
    console.error("Failed to delete:", err);
  }
}
