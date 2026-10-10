import { tauriInvoke } from "../api.js";
import { escapeHtml } from "../state.js";

export function renderDiffTableHtml(rawDiff) {
  const rawLines = rawDiff.split("\n");
  let html = `<table class="wb-diff-table"><tbody>`;
  let oldLine = 0;
  let newLine = 0;

  for (const line of rawLines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      html += `<tr class="wb-diff-row hunk-header"><td class="wb-diff-gutter">...</td><td class="wb-diff-gutter">...</td><td class="wb-diff-sign"></td><td class="wb-diff-text">${escapeHtml(line)}</td></tr>`;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      const text = line.substring(1);
      html += `<tr class="wb-diff-row line-add"><td class="wb-diff-gutter"></td><td class="wb-diff-gutter">${newLine}</td><td class="wb-diff-sign">+</td><td class="wb-diff-text">${escapeHtml(text)}</td></tr>`;
      newLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      const text = line.substring(1);
      html += `<tr class="wb-diff-row line-del"><td class="wb-diff-gutter">${oldLine}</td><td class="wb-diff-gutter"></td><td class="wb-diff-sign">-</td><td class="wb-diff-text">${escapeHtml(text)}</td></tr>`;
      oldLine++;
    } else if (line.startsWith(" ") || line === "") {
      const text = line.startsWith(" ") ? line.substring(1) : line;
      html += `<tr class="wb-diff-row"><td class="wb-diff-gutter">${oldLine || ""}</td><td class="wb-diff-gutter">${newLine || ""}</td><td class="wb-diff-sign"></td><td class="wb-diff-text">${escapeHtml(text)}</td></tr>`;
      if (oldLine) oldLine++;
      if (newLine) newLine++;
    } else {
      // Meta headers (diff --git, index, +++, ---)
      html += `<tr class="wb-diff-row" style="opacity: 0.6; font-size: 11px;"><td class="wb-diff-gutter"></td><td class="wb-diff-gutter"></td><td class="wb-diff-sign"></td><td class="wb-diff-text">${escapeHtml(line)}</td></tr>`;
    }
  }

  html += `</tbody></table>`;
  return html;
}

export async function loadDiffForTab(state, tab) {
  const container = state.viewContainers.get(tab.id);
  if (!container) return;
  const diffBody = container.querySelector(".wb-diff-body");
  if (!diffBody) return;

  const repoPath = tab.repoPath;
  const file = tab.diffFile;

  // Untracked new file: render full file content as additions
  if (tab.gitStatusCode === "U") {
    try {
      const data = await tauriInvoke("get_file_content", { path: tab.filePath });
      const lines = (data.content || "").split("\n");
      let html = `<table class="wb-diff-table"><tbody>`;
      html += `<tr class="wb-diff-row hunk-header"><td class="wb-diff-gutter">...</td><td class="wb-diff-gutter">...</td><td class="wb-diff-sign"></td><td class="wb-diff-text">@@ +1,${lines.length} Untracked File @@</td></tr>`;
      lines.forEach((line, i) => {
        html += `<tr class="wb-diff-row line-add"><td class="wb-diff-gutter"></td><td class="wb-diff-gutter">${i + 1}</td><td class="wb-diff-sign">+</td><td class="wb-diff-text">${escapeHtml(line)}</td></tr>`;
      });
      html += `</tbody></table>`;
      diffBody.innerHTML = html;
      return;
    } catch (err) {
      diffBody.innerHTML = `<div class="wb-diff-clean">Error: ${escapeHtml(String(err))}</div>`;
      return;
    }
  }

  // Commit diff fetch
  if (tab.commitHash) {
    try {
      const data = await tauriInvoke("get_git_diff", {
        path: repoPath,
        commit: tab.commitHash
      });
      if (!data.diff || !data.diff.trim()) {
        diffBody.innerHTML = `<div class="wb-diff-clean">&#10003; Empty commit or merge commit</div>`;
        return;
      }
      diffBody.innerHTML = renderDiffTableHtml(data.diff);
      return;
    } catch (err) {
      diffBody.innerHTML = `<div class="wb-diff-clean">Error: ${escapeHtml(String(err))}</div>`;
      return;
    }
  }

  // Git diff fetch
  try {
    const data = await tauriInvoke("get_git_diff", {
      path: repoPath,
      file: file || null,
      staged: Boolean(tab.isStaged)
    });
    if (!data.diff || !data.diff.trim()) {
      diffBody.innerHTML = `<div class="wb-diff-clean">&#10003; No differences found between versions</div>`;
      return;
    }

    diffBody.innerHTML = renderDiffTableHtml(data.diff);
  } catch (err) {
    diffBody.innerHTML = `<div class="wb-diff-clean">Error: ${escapeHtml(String(err))}</div>`;
  }
}

export function mountDiffInstance(state, tab) {
  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `view-container-${tab.id}`;
  container.className = "terminal-instance wb-view hidden";

  const badgeLabel = tab.commitHash
    ? `Commit ${tab.commitHash.substring(0, 7)}`
    : tab.isStaged
    ? "Staged"
    : tab.gitStatusCode === "U"
    ? "Untracked"
    : "Working Tree";

  const badgeClass = tab.commitHash
    ? "commit"
    : tab.isStaged
    ? "staged"
    : tab.gitStatusCode === "U"
    ? "untracked"
    : "working";

  const isDeleted = tab.gitStatusCode === "D";

  container.innerHTML = `
    <div class="wb-diff-bar">
      <div class="wb-bar-meta">
        <span class="tab-type-tag is-diff">⇄ Diff</span>
        <span class="wb-diff-badge ${badgeClass}">${badgeLabel}</span>
        <span class="wb-bar-path" title="${escapeHtml(tab.filePath || tab.diffFile || '')}">${escapeHtml(tab.diffFile || tab.filePath || '')}</span>
      </div>
      <div class="wb-bar-actions">
        ${!isDeleted && tab.filePath ? `<button class="btn btn-xs btn-open-editor" title="Open in Editor">Open in Editor</button>` : ''}
        <button class="btn btn-xs btn-close" title="Close this tab">Close</button>
      </div>
    </div>
    <div class="wb-diff-body">
      <div class="wb-diff-clean">Computing diff...</div>
    </div>
  `;
  host.appendChild(container);

  const closeBtn = container.querySelector(".btn-close");
  const openEditorBtn = container.querySelector(".btn-open-editor");
  if (closeBtn) closeBtn.onclick = () => state.closeTab(tab.id);
  if (openEditorBtn) {
    openEditorBtn.onclick = () => {
      if (tab.filePath) state.openFileInWorkbench(tab.filePath);
    };
  }

  state.viewContainers.set(tab.id, container);
  loadDiffForTab(state, tab);
}
