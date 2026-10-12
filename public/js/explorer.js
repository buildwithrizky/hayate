import { tauriInvoke } from "./api.js";
import { escapeHtml, formatFileSize } from "./state.js";
import { showExplorerContextMenu } from "./explorer-menu.js";

export async function loadGitignore(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) {
    state.gitignoreRules = [];
    return;
  }
  try {
    const data = await tauriInvoke("get_file_content", { path: ws.path + "/.gitignore" });
    if (data && data.content) {
      state.gitignoreRules = data.content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      return;
    }
  } catch {}
  state.gitignoreRules = [];
}

export function matchGitignore(state, relPath, isDir = false) {
  if (!state.gitignoreRules || !state.gitignoreRules.length) return false;
  const cleanRel = relPath.replace(/^\/+/, "");
  const parts = cleanRel.split("/");
  const basename = parts[parts.length - 1];

  for (const rule of state.gitignoreRules) {
    let r = rule.trim();
    if (!r) continue;
    const isDirOnly = r.endsWith("/");
    if (isDirOnly) {
      r = r.slice(0, -1);
      // ponytail: directory-only check; upgrade to full gitignore pathspec when nested gitignore needed
      if (!isDir) {
        const insideDir = r.startsWith("/")
          ? cleanRel.startsWith(r.slice(1) + "/")
          : cleanRel.startsWith(r + "/") || parts.slice(0, -1).includes(r);
        if (insideDir) return true;
        continue;
      }
    }

    // Exact match on relative path or basename
    if (r === cleanRel || r === basename) return true;

    // Leading slash match against root
    if (r.startsWith("/")) {
      const rootPattern = r.slice(1);
      if (cleanRel === rootPattern || cleanRel.startsWith(rootPattern + "/")) return true;
      continue;
    }

    // Subdirectory match (e.g. node_modules anywhere in path)
    if (cleanRel === r || cleanRel.startsWith(r + "/") || parts.includes(r)) return true;

    // Wildcard match (e.g. *.log, temp-*)
    if (r.includes("*")) {
      const rx = new RegExp("^" + r.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*") + "$");
      if (rx.test(basename) || rx.test(cleanRel)) return true;
    }
  }
  return false;
}

export function isPathIgnored(state, targetPath, isDir = false) {
  const ws = state.getActiveWorkspace();
  if (!ws) return false;

  let relPath = targetPath;
  if (targetPath.startsWith(ws.path)) {
    relPath = targetPath.slice(ws.path.length).replace(/^\/+/, "");
  }
  const norm = relPath.replace(/\/+$/, "");
  if (!norm) return false;

  // Check .gitignore rules parsed from workspace
  if (matchGitignore(state, norm, isDir)) return true;

  // Check git status ignored list
  if (state.gitStatusData?.ignored && Array.isArray(state.gitStatusData.ignored)) {
    return state.gitStatusData.ignored.some((ign) => {
      const ignNorm = ign.replace(/\/+$/, "");
      return norm === ignNorm || norm.startsWith(ignNorm + "/");
    });
  }

  return false;
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

  // Ensure index cached on gitStatusData
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

export async function fetchDirectoryItems(state, dirPath) {
  if (state.folderCache.has(dirPath)) {
    return state.folderCache.get(dirPath);
  }
  try {
    const data = await tauriInvoke("get_files", { path: dirPath });
    const items = Array.isArray(data) ? data : (data?.items || []);
    if (items.length > 0 || Array.isArray(data)) {
      state.folderCache.set(dirPath, items);
      return items;
    }
  } catch (e) {
    console.error("fetchDirectoryItems failed", e);
  }
  return [];
}

export async function loadExplorer(state, forceRefresh = false) {
  const ws = state.getActiveWorkspace();
  const treeEl = document.getElementById("rs-files-tree");
  if (!treeEl) return;

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
  const rootItems = await fetchDirectoryItems(state, ws.path);

  if (!rootItems || rootItems.length === 0) {
    treeEl.innerHTML = `<div class="rs-empty">Empty workspace directory</div>`;
    return;
  }

  treeEl.innerHTML = "";
  for (const item of rootItems) {
    const node = await buildTreeNode(state, item, 0);
    treeEl.appendChild(node);
  }
}

export async function buildTreeNode(state, item, level) {
  const wrapper = document.createElement("div");
  wrapper.className = "rs-tree-node";

  const row = document.createElement("div");
  row.className = `rs-file-item ${item.isDirectory ? "is-dir" : "is-file"}`;
  row.style.paddingLeft = `${level * 14 + 6}px`;
  row.setAttribute("data-path", item.path);
  row.setAttribute("data-isdir", item.isDirectory ? "true" : "false");

  const isOpen = item.isDirectory && state.openFolders.has(item.path);
  if (isOpen) row.classList.add("open");

  const isIgnored = isPathIgnored(state, item.path, item.isDirectory);
  const gitStatus = item.isDirectory
    ? getFolderGitStatus(state, item.path)
    : getFileGitStatus(state, item.path);
  if (gitStatus) {
    row.classList.add(`git-${gitStatus}`);
  }
  if (isIgnored) {
    row.classList.add("is-ignored");
  }

  const chevronHtml = item.isDirectory
    ? `<span class="rs-chevron"><svg class="rs-chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>`
    : `<span class="rs-chevron rs-chevron-spacer"></span>`;

  const icon = item.isDirectory
    ? (isOpen ? "&#128194;" : "&#128193;")
    : "&#128196;";

  let badgeHtml = "";
  if (isIgnored) {
    badgeHtml = `<span class="rs-git-badge ignored" title="Git Ignored">&#8856;</span>`;
  } else if (gitStatus) {
    badgeHtml = `<span class="rs-git-badge ${gitStatus}">${gitStatus}</span>`;
  }

  row.innerHTML = `
    ${chevronHtml}
    <span class="rs-file-icon">${icon}</span>
    <span class="rs-file-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
    ${badgeHtml}
  `;

  wrapper.appendChild(row);

  const childrenContainer = document.createElement("div");
  childrenContainer.className = "rs-tree-children";
  childrenContainer.style.display = isOpen ? "flex" : "none";
  wrapper.appendChild(childrenContainer);

  if (isOpen) {
    const subItems = await fetchDirectoryItems(state, item.path);
    for (const sub of subItems) {
      const subNode = await buildTreeNode(state, sub, level + 1);
      childrenContainer.appendChild(subNode);
    }
  }

  row.addEventListener("click", async () => {
    if (item.isDirectory) {
      const willOpen = !state.openFolders.has(item.path);
      const iconEl = row.querySelector(".rs-file-icon");

      if (willOpen) {
        state.openFolders.add(item.path);
        row.classList.add("open");
        if (iconEl) iconEl.innerHTML = "&#128194;";
        childrenContainer.innerHTML = `<div class="rs-empty" style="padding:4px ${level * 14 + 20}px; text-align:left;">Loading...</div>`;
        childrenContainer.style.display = "flex";

        const subItems = await fetchDirectoryItems(state, item.path);
        childrenContainer.innerHTML = "";
        if (subItems.length === 0) {
          childrenContainer.innerHTML = `<div class="rs-empty" style="padding:4px ${level * 14 + 20}px; text-align:left;">(empty)</div>`;
        } else {
          for (const sub of subItems) {
            const subNode = await buildTreeNode(state, sub, level + 1);
            childrenContainer.appendChild(subNode);
          }
        }
      } else {
        state.openFolders.delete(item.path);
        row.classList.remove("open");
        if (iconEl) iconEl.innerHTML = "&#128193;";
        childrenContainer.style.display = "none";
      }
    } else {
      openFileInWorkbench(state, item.path);
    }
  });

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showExplorerContextMenu(state, e, item, false);
  });

  return wrapper;
}

export function openFileInWorkbench(state, filePath) {
  if (!filePath) return;
  const isMd = /\.md$/i.test(filePath);
  const fileName = filePath.split(/[/\\]+/).filter(Boolean).pop() || filePath;

  // Check if file is already open in an existing tab
  const existing = state.tabs.find((t) => t.filePath === filePath && t.type !== "diff");
  if (existing) {
    state.switchTab(existing.id);
    return;
  }

  const type = isMd ? "markdown" : "editor";
  state.createTab(null, type, {
    title: fileName,
    filePath
  });
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

  try {
    const data = await tauriInvoke("get_file_content", { path: filePath });
    sizeEl.textContent = formatFileSize(data.size || 0);
    codeEl.textContent = data.content || "(Empty file)";
  } catch (err) {
    codeEl.textContent = "Error: " + String(err);
    sizeEl.textContent = "";
  }
}
