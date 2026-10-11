import { createFile, createDir, renamePath, deletePath, revealInFinder } from "./api.js";
import { showPromptDialog, showConfirmDialog } from "./dialog.js";

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
  if (isBackground) {
    actions.push(
      { label: "New File", action: () => promptNewItem(state, ws.path, false) },
      { label: "New Folder", action: () => promptNewItem(state, ws.path, true) },
      { type: "separator" },
      { label: "Reveal in Finder", action: () => revealInFinder(ws.path).catch(console.error) }
    );
  } else {
    actions.push(
      { label: "New File", action: () => promptNewItem(state, targetDir, false) },
      { label: "New Folder", action: () => promptNewItem(state, targetDir, true) },
      { label: "Reveal in Finder", action: () => revealInFinder(targetPath).catch(console.error) },
      { type: "separator" },
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
      { label: "Rename", action: () => promptRename(state, targetPath, item ? item.name : getBasename(targetPath)) },
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
    itemEl.className = `rs-context-menu-item ${act.isDanger ? "is-danger" : ""}`;
    itemEl.innerHTML = `<span>${act.label}</span>`;
    itemEl.onclick = async (e) => {
      e.stopPropagation();
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

async function promptNewItem(state, parentDir, isDir) {
  const kind = isDir ? "Folder" : "File";
  const name = await showPromptDialog({
    title: `New ${kind}`,
    message: `Enter name for new ${kind.toLowerCase()}:`,
    defaultValue: "",
    confirmLabel: "Create",
  });
  if (!name || !name.trim()) return;

  const targetPath = joinPath(parentDir, name.trim());
  try {
    if (isDir) {
      await createDir(targetPath);
      state.openFolders.add(parentDir);
    } else {
      await createFile(targetPath);
      state.openFolders.add(parentDir);
    }
    await state.loadExplorer(true);
    if (!isDir) {
      state.openFileInWorkbench(targetPath);
    }
  } catch (err) {
    console.error(`Failed to create ${kind.toLowerCase()}:`, err);
  }
}

async function promptRename(state, oldPath, currentName) {
  const name = currentName || getBasename(oldPath);
  const newName = await showPromptDialog({
    title: "Rename",
    message: `Enter new name for "${name}":`,
    defaultValue: name,
    confirmLabel: "Rename",
  });
  if (!newName || !newName.trim() || newName.trim() === name) return;

  const sep = getSeparator(oldPath);
  const parts = oldPath.split(/[/\\]+/);
  parts.pop();
  const parent = parts.join(sep);
  const newPath = joinPath(parent, newName.trim());

  try {
    await renamePath(oldPath, newPath);
    state.tabs.forEach((tab) => {
      if (tab.filePath === oldPath) {
        tab.filePath = newPath;
        tab.title = newName.trim();
      } else if (tab.filePath && (tab.filePath.startsWith(oldPath + "/") || tab.filePath.startsWith(oldPath + "\\"))) {
        tab.filePath = newPath + tab.filePath.slice(oldPath.length);
      }
    });
    state.renderTabs();
    await state.loadExplorer(true);
  } catch (err) {
    console.error("Failed to rename:", err);
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
