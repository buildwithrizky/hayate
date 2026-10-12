import { createFile, createDir, renamePath } from "./api.js";

let activeInlineInput = null;

export function isInlineEditing() {
  return activeInlineInput !== null;
}

export function startInlineRename(state, targetPath, rowEl) {
  if (activeInlineInput) return;
  const nameEl = rowEl.querySelector(".rs-file-name");
  if (!nameEl) return;

  const oldName = nameEl.textContent.trim();
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rs-inline-input";
  input.value = oldName;

  nameEl.style.display = "none";
  nameEl.parentNode.insertBefore(input, nameEl.nextSibling);
  activeInlineInput = input;

  // Select filename excluding extension
  input.focus();
  const dotIndex = oldName.lastIndexOf(".");
  if (dotIndex > 0) {
    input.setSelectionRange(0, dotIndex);
  } else {
    input.select();
  }

  let committed = false;

  const commit = async () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    cleanup();

    if (!newName || newName === oldName) return;

    const sep = targetPath.includes("\\") && !targetPath.includes("/") ? "\\" : "/";
    const parts = targetPath.split(/[/\\]+/).filter(Boolean);
    parts.pop();
    const parent = parts.join(sep);
    const newPath = `${parent}${sep}${newName}`;

    try {
      await renamePath(targetPath, newPath);
      state.tabs.forEach((tab) => {
        if (tab.filePath === targetPath) {
          tab.filePath = newPath;
          tab.title = newName;
        } else if (tab.filePath && (tab.filePath.startsWith(targetPath + "/") || tab.filePath.startsWith(targetPath + "\\"))) {
          tab.filePath = newPath + tab.filePath.slice(targetPath.length);
        }
      });
      state.renderTabs();
      await state.loadExplorer(true);
    } catch (err) {
      console.error("Failed to rename:", err);
    }
  };

  const cancel = () => {
    if (committed) return;
    committed = true;
    cleanup();
  };

  const cleanup = () => {
    input.removeEventListener("keydown", onKeyDown);
    input.removeEventListener("blur", onBlur);
    input.remove();
    nameEl.style.display = "";
    activeInlineInput = null;
  };

  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const onBlur = () => {
    commit();
  };

  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", onBlur);
}

export function startInlineCreate(state, parentDir, isDir = false, targetContainer = null) {
  if (activeInlineInput) return;

  const container = targetContainer || document.getElementById("rs-files-tree");
  if (!container) return;

  const dummyRow = document.createElement("div");
  dummyRow.className = `rs-file-item is-creating ${isDir ? "is-dir" : "is-file"}`;

  const iconSvg = isDir
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

  dummyRow.innerHTML = `
    <span class="rs-chevron rs-chevron-spacer"></span>
    <span class="rs-file-icon" style="color:var(--accent-blue);">${iconSvg}</span>
  `;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "rs-inline-input";
  input.placeholder = isDir ? "Folder name" : "File name";
  dummyRow.appendChild(input);

  // Prepend to container so new item sits at top
  if (container.firstChild) {
    container.insertBefore(dummyRow, container.firstChild);
  } else {
    container.appendChild(dummyRow);
  }

  activeInlineInput = input;
  input.focus();

  let committed = false;

  const commit = async () => {
    if (committed) return;
    committed = true;
    const name = input.value.trim();
    cleanup();

    if (!name) return;

    const sep = parentDir.includes("\\") && !parentDir.includes("/") ? "\\" : "/";
    const cleanName = name.replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
    const targetPath = `${parentDir.replace(/[/\\]+$/, "")}${sep}${cleanName}`;

    // Expand parent directory and any intermediate subdirectories
    state.openFolders.add(parentDir);
    const subSegments = cleanName.split(/[/\\]+/);
    if (subSegments.length > 1) {
      let currentAcc = parentDir.replace(/[/\\]+$/, "");
      for (let i = 0; i < subSegments.length - (isDir ? 0 : 1); i++) {
        currentAcc = `${currentAcc}${sep}${subSegments[i]}`;
        state.openFolders.add(currentAcc);
      }
    }

    try {
      if (isDir) {
        await createDir(targetPath);
      } else {
        await createFile(targetPath);
      }
      await state.loadExplorer(true);
      if (!isDir) {
        state.openFileInWorkbench(targetPath);
      }
    } catch (err) {
      console.error(`Failed to create ${isDir ? "folder" : "file"}:`, err);
    }
  };

  const cancel = () => {
    if (committed) return;
    committed = true;
    cleanup();
  };

  const cleanup = () => {
    input.removeEventListener("keydown", onKeyDown);
    input.removeEventListener("blur", onBlur);
    dummyRow.remove();
    activeInlineInput = null;
  };

  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const onBlur = () => {
    commit();
  };

  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", onBlur);
}
