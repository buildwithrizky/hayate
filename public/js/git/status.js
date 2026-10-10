import { tauriInvoke } from "../api.js";
import { escapeHtml } from "../state.js";
import { fetchDirectoryItems } from "../explorer.js";
import { openDiffTab } from "./diff.js";
import { loadGitCommits } from "./commits.js";

export async function fetchGitStatusData(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) {
    state.gitStatusData = null;
    state.gitignoreRules = [];
    state.updateStatusbar();
    return null;
  }
  await state.loadGitignore();
  try {
    const data = await tauriInvoke("get_git_status", { path: ws.path });
    if (data) {
      state.gitStatusData = data;
      const totalChanges = (data.staged?.length || 0) + (data.unstaged?.length || 0) + (data.untracked?.length || 0);
      const badgeEl = document.getElementById("rs-git-badge");
      if (badgeEl) {
        if (totalChanges > 0) {
          badgeEl.textContent = String(totalChanges);
          badgeEl.style.display = "inline-flex";
        } else {
          badgeEl.style.display = "none";
        }
      }
      state.updateStatusbar();
      return data;
    }
  } catch {}
  state.gitStatusData = null;
  state.updateStatusbar();
  return null;
}

export async function loadGitStatus(state) {
  const ws = state.getActiveWorkspace();
  const branchEl = document.getElementById("rs-git-branch");
  const groupsEl = document.getElementById("rs-git-groups");
  const badgeEl = document.getElementById("rs-git-badge");
  if (!groupsEl) return;

  if (!ws) {
    if (branchEl) branchEl.textContent = "-";
    if (badgeEl) badgeEl.style.display = "none";
    groupsEl.innerHTML = `<div class="rs-empty">No workspace selected</div>`;
    return;
  }

  groupsEl.innerHTML = `<div class="rs-empty">Checking git status...</div>`;

  try {
    const data = await tauriInvoke("get_git_status", { path: ws.path });
    state.gitStatusData = data;
    if (branchEl) {
      branchEl.textContent = data.branch || "HEAD";
      if (data.upstream) branchEl.title = `Upstream: ${data.upstream}`;
    }

    const staged = data.staged || [];
    const unstaged = data.unstaged || [];
    const untracked = data.untracked || [];
    const totalChanges = staged.length + unstaged.length + untracked.length;

    if (badgeEl) {
      if (totalChanges > 0) {
        badgeEl.textContent = String(totalChanges);
        badgeEl.style.display = "inline-flex";
      } else {
        badgeEl.style.display = "none";
      }
    }

    if (totalChanges === 0) {
      groupsEl.innerHTML = `<div class="rs-empty">&#10003; Working tree clean</div>`;
      return;
    }

    // Expand any directory paths (e.g. untracked bin/)
    const [expStaged, expUnstaged, expUntracked] = await Promise.all([
      expandGitItems(state, ws.path, staged),
      expandGitItems(state, ws.path, unstaged),
      expandGitItems(state, ws.path, untracked.map((f) => ({ file: f, status: "U" })))
    ]);

    groupsEl.innerHTML = "";

    if (expStaged.length > 0) {
      groupsEl.appendChild(renderGitSection(state, "Staged Changes", expStaged, true, ws.path));
    }
    if (expUnstaged.length > 0) {
      groupsEl.appendChild(renderGitSection(state, "Changes", expUnstaged, false, ws.path));
    }
    if (expUntracked.length > 0) {
      groupsEl.appendChild(renderGitSection(state, "Untracked", expUntracked, false, ws.path));
    }

    loadGitCommits(state);
  } catch (err) {
    if (branchEl) branchEl.textContent = "not a git repo";
    if (badgeEl) badgeEl.style.display = "none";
    groupsEl.innerHTML = `<div class="rs-empty">${escapeHtml(String(err) || "Not a git repository")}</div>`;
    loadGitCommits(state);
  }
}

// Expand trailing slash directory entries recursively
export async function expandGitItems(state, repoPath, items) {
  const result = [];
  for (const item of items) {
    const filePath = item.file || "";
    let code = item.status || "M";
    if (code === "?") code = "U";

    if (filePath.endsWith("/")) {
      const subFiles = await collectFilesRecursively(state, repoPath, filePath.replace(/\/+$/, ""));
      if (subFiles.length > 0) {
        for (const sf of subFiles) {
          result.push({ file: sf, status: code });
        }
      } else {
        result.push({ file: filePath, status: code });
      }
    } else {
      result.push({ file: filePath, status: code });
    }
  }
  return result;
}

export async function collectFilesRecursively(state, repoPath, relDir) {
  const fullDirPath = repoPath + "/" + relDir;
  const items = await fetchDirectoryItems(state, fullDirPath);
  const files = [];
  for (const it of items) {
    const childRel = relDir ? `${relDir}/${it.name}` : it.name;
    if (it.isDirectory) {
      const nested = await collectFilesRecursively(state, repoPath, childRel);
      files.push(...nested);
    } else {
      files.push(childRel);
    }
  }
  return files;
}

// Build hierarchical tree structure from flat file list
export function buildGitTree(files) {
  const root = { name: "", fullPath: "", isDir: true, children: new Map(), status: null };

  const statusOrder = { D: 4, M: 3, A: 2, U: 1 };
  function pickStatus(s1, s2) {
    if (!s1) return s2 || "M";
    if (!s2) return s1 || "M";
    return (statusOrder[s2] || 0) > (statusOrder[s1] || 0) ? s2 : s1;
  }

  for (const item of files) {
    const normalized = (item.file || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!normalized) continue;
    const parts = normalized.split("/");
    let current = root;
    let curPath = "";
    const itemStatus = item.status === "?" ? "U" : (item.status || "M");

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      curPath = curPath ? `${curPath}/${part}` : part;
      const isLeaf = i === parts.length - 1;

      if (isLeaf) {
        current.children.set(part, {
          name: part,
          fullPath: curPath,
          isDir: false,
          children: new Map(),
          status: itemStatus
        });
      } else {
        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            fullPath: curPath,
            isDir: true,
            children: new Map(),
            status: itemStatus
          });
        }
        current = current.children.get(part);
        current.status = pickStatus(current.status, itemStatus);
      }
    }
  }

  return root;
}

export function renderGitTreeNode(state, node, sectionKey, level, isStaged, repoPath) {
  const wrapper = document.createElement("div");
  wrapper.className = "rs-git-tree-node";

  const row = document.createElement("div");
  const itemPathKey = `${sectionKey}:${node.fullPath}`;

  let code = node.status || "M";
  if (code === "?") code = "U";

  if (node.isDir) {
    const isCollapsed = state.gitTreeCollapsed.has(itemPathKey);
    row.className = "rs-git-tree-row rs-git-folder-item";
    row.style.paddingLeft = `${level * 14 + 6}px`;

    row.innerHTML = `
      <span class="rs-git-chevron">${isCollapsed ? "&#9656;" : "&#9662;"}</span>
      <span class="rs-git-icon">${isCollapsed ? "&#128193;" : "&#128194;"}</span>
      <span class="rs-git-name" title="${escapeHtml(node.fullPath)}">${escapeHtml(node.name)}</span>
      <span class="rs-git-badge ${escapeHtml(code)}">${escapeHtml(code)}</span>
    `;

    wrapper.appendChild(row);

    const childrenEl = document.createElement("div");
    childrenEl.className = "rs-git-tree-children";
    if (isCollapsed) childrenEl.style.display = "none";

    const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    for (const child of sortedChildren) {
      childrenEl.appendChild(renderGitTreeNode(state, child, sectionKey, level + 1, isStaged, repoPath));
    }

    wrapper.appendChild(childrenEl);

    row.addEventListener("click", () => {
      const collapsed = state.gitTreeCollapsed.has(itemPathKey);
      const chev = row.querySelector(".rs-git-chevron");
      const ic = row.querySelector(".rs-git-icon");
      if (collapsed) {
        state.gitTreeCollapsed.delete(itemPathKey);
        if (chev) chev.innerHTML = "&#9662;";
        if (ic) ic.innerHTML = "&#128194;";
        childrenEl.style.display = "block";
      } else {
        state.gitTreeCollapsed.add(itemPathKey);
        if (chev) chev.innerHTML = "&#9656;";
        if (ic) ic.innerHTML = "&#128193;";
        childrenEl.style.display = "none";
      }
    });
  } else {
    row.className = `rs-git-tree-row rs-git-file-item git-${escapeHtml(code)}`;
    row.style.paddingLeft = `${level * 14 + 6}px`;

    let actionsHtml = "";
    if (isStaged) {
      actionsHtml = `<button class="rs-git-action-btn btn-unstage-file" title="Unstage Changes ( - )">&minus;</button>`;
    } else {
      actionsHtml = `
        <button class="rs-git-action-btn btn-discard-file" title="Discard Changes ( ⟲ )">&#x27f2;</button>
        <button class="rs-git-action-btn btn-stage-file" title="Stage Changes ( + )">&plus;</button>
      `;
    }

    row.innerHTML = `
      <span class="rs-git-chevron" style="opacity: 0; pointer-events: none;">&bull;</span>
      <span class="rs-git-icon">&#128196;</span>
      <span class="rs-git-name" title="${escapeHtml(node.fullPath)}">${escapeHtml(node.name)}</span>
      <span class="rs-git-actions">${actionsHtml}</span>
      <span class="rs-git-badge ${escapeHtml(code)}">${escapeHtml(code)}</span>
    `;

    // Action button click handlers (stop propagation to row click)
    const stageBtn = row.querySelector(".btn-stage-file");
    if (stageBtn) {
      stageBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        stageFile(state, node.fullPath);
      });
    }
    const unstageBtn = row.querySelector(".btn-unstage-file");
    if (unstageBtn) {
      unstageBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        unstageFile(state, node.fullPath);
      });
    }
    const discardBtn = row.querySelector(".btn-discard-file");
    if (discardBtn) {
      discardBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        discardFile(state, node.fullPath);
      });
    }

    row.addEventListener("click", () => {
      openDiffTab(state, node.fullPath, isStaged, code);
    });

    wrapper.appendChild(row);
  }

  return wrapper;
}

export function renderGitSection(state, title, files, isStaged, repoPath) {
  const isCollapsed = state.gitSectionsCollapsed.has(title);
  const sectionEl = document.createElement("div");
  sectionEl.className = `rs-git-section ${isCollapsed ? "collapsed" : ""}`;
  sectionEl.setAttribute("data-section", title);

  let sectionActionsHtml = "";
  if (title === "Changes") {
    sectionActionsHtml = `
      <span class="rs-git-actions">
        <button class="rs-git-action-btn btn-discard-all" title="Discard All Changes ( ⟲ )">&#x27f2;</button>
        <button class="rs-git-action-btn btn-stage-all" title="Stage All Changes ( + )">&plus;</button>
      </span>
    `;
  } else if (title === "Staged Changes") {
    sectionActionsHtml = `
      <span class="rs-git-actions">
        <button class="rs-git-action-btn btn-unstage-all" title="Unstage All ( - )">&minus;</button>
      </span>
    `;
  } else if (title === "Untracked") {
    sectionActionsHtml = `
      <span class="rs-git-actions">
        <button class="rs-git-action-btn btn-discard-all" title="Discard All Untracked ( ⟲ )">&#x27f2;</button>
        <button class="rs-git-action-btn btn-stage-all" title="Stage All Untracked ( + )">&plus;</button>
      </span>
    `;
  }

  const titleEl = document.createElement("div");
  titleEl.className = "rs-git-section-title";
  titleEl.innerHTML = `
    <span class="rs-git-section-label">
      <span class="rs-git-chevron">&#9662;</span>
      <span>${escapeHtml(title)}</span>
    </span>
    <div style="display: flex; align-items: center; gap: 6px;">
      ${sectionActionsHtml}
      <span class="rs-badge">${files.length}</span>
    </div>
  `;

  // Header action button event handlers
  const stageAllBtn = titleEl.querySelector(".btn-stage-all");
  if (stageAllBtn) {
    stageAllBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      stageAll(state);
    });
  }
  const unstageAllBtn = titleEl.querySelector(".btn-unstage-all");
  if (unstageAllBtn) {
    unstageAllBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      unstageAll(state);
    });
  }
  const discardAllBtn = titleEl.querySelector(".btn-discard-all");
  if (discardAllBtn) {
    discardAllBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      discardAll(state);
    });
  }

  const bodyEl = document.createElement("div");
  bodyEl.className = "rs-git-section-body";

  const treeRoot = buildGitTree(files);
  const sortedChildren = Array.from(treeRoot.children.values()).sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  for (const child of sortedChildren) {
    bodyEl.appendChild(renderGitTreeNode(state, child, title, 0, isStaged, repoPath));
  }

  titleEl.addEventListener("click", () => {
    if (state.gitSectionsCollapsed.has(title)) {
      state.gitSectionsCollapsed.delete(title);
      sectionEl.classList.remove("collapsed");
    } else {
      state.gitSectionsCollapsed.add(title);
      sectionEl.classList.add("collapsed");
    }
  });

  sectionEl.appendChild(titleEl);
  sectionEl.appendChild(bodyEl);
  return sectionEl;
}

export async function refreshGitAndExplorer(state) {
  await state.fetchGitStatusData();
  await loadGitStatus(state);
  if (state.activeRightPanel === "explorer") {
    state.loadExplorer(true);
  }
}

export async function stageFile(state, file) {
  const ws = state.getActiveWorkspace();
  if (!ws || !file) return;
  try {
    await tauriInvoke("git_stage", {
      path: ws.path,
      file,
      all: false
    });
    await refreshGitAndExplorer(state);
  } catch (err) {
    alert("Stage error: " + String(err));
  }
}

export async function stageAll(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  try {
    await tauriInvoke("git_stage", {
      path: ws.path,
      file: null,
      all: true
    });
    await refreshGitAndExplorer(state);
  } catch (err) {
    alert("Stage all error: " + String(err));
  }
}

export async function unstageFile(state, file) {
  const ws = state.getActiveWorkspace();
  if (!ws || !file) return;
  try {
    await tauriInvoke("git_unstage", {
      path: ws.path,
      file,
      all: false
    });
    await refreshGitAndExplorer(state);
  } catch (err) {
    alert("Unstage error: " + String(err));
  }
}

export async function unstageAll(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  try {
    await tauriInvoke("git_unstage", {
      path: ws.path,
      file: null,
      all: true
    });
    await refreshGitAndExplorer(state);
  } catch (err) {
    alert("Unstage all error: " + String(err));
  }
}

export async function discardFile(state, file) {
  const ws = state.getActiveWorkspace();
  if (!ws || !file) return;
  const ok = confirm(`Are you sure you want to discard changes in '${file}'? This cannot be undone.`);
  if (!ok) return;

  try {
    await tauriInvoke("git_discard", {
      path: ws.path,
      file,
      all: false
    });
    await refreshGitAndExplorer(state);
  } catch (err) {
    alert("Discard error: " + String(err));
  }
}

export async function discardAll(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  const ok = confirm("Are you sure you want to discard all changes in working tree? This cannot be undone.");
  if (!ok) return;

  try {
    await tauriInvoke("git_discard", {
      path: ws.path,
      file: null,
      all: true
    });
    await refreshGitAndExplorer(state);
  } catch (err) {
    alert("Discard all error: " + String(err));
  }
}
