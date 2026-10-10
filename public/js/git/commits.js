import { tauriInvoke } from "../api.js";
import { escapeHtml } from "../state.js";

export async function loadGitCommits(state) {
  const listEl = document.getElementById("rs-git-commits-list");
  const countEl = document.getElementById("rs-commits-count");
  if (!listEl) return;

  const ws = state.getActiveWorkspace();
  if (!ws) {
    listEl.innerHTML = `<div class="rs-empty">No workspace selected</div>`;
    if (countEl) countEl.textContent = "0";
    return;
  }

  try {
    const data = await tauriInvoke("get_git_log", { path: ws.path });
    const commits = data.commits || [];

    if (countEl) countEl.textContent = String(commits.length);

    if (commits.length === 0) {
      listEl.innerHTML = `<div class="rs-empty">No commits yet</div>`;
      return;
    }

    listEl.innerHTML = "";
    commits.forEach((c) => {
      const item = document.createElement("div");
      item.className = "rs-commit-item";
      item.title = `${c.hash}\n${c.author} - ${c.relativeDate}\n\n${c.message}`;

      item.innerHTML = `
        <div class="rs-commit-item-msg">${escapeHtml(c.message)}</div>
        <div class="rs-commit-item-meta">
          <span class="rs-commit-hash">#${escapeHtml(c.shortHash)}</span>
          <span class="rs-commit-time">${escapeHtml(c.relativeDate)}</span>
          <span class="rs-commit-author">${escapeHtml(c.author)}</span>
        </div>
      `;

      item.addEventListener("click", () => {
        openCommitTab(state, c);
      });

      listEl.appendChild(item);
    });
  } catch (err) {
    listEl.innerHTML = `<div class="rs-empty">Failed to load commits: ${escapeHtml(String(err))}</div>`;
    if (countEl) countEl.textContent = "0";
  }
}

export function openCommitTab(state, commit) {
  const ws = state.getActiveWorkspace();
  const shortHash = commit.shortHash || (commit.hash ? commit.hash.substring(0, 7) : "commit");
  const tabTitle = `⇄ #${shortHash}`;

  // Switch if already open
  const existing = state.tabs.find((t) => t.type === "diff" && t.commitHash === commit.hash);
  if (existing) {
    state.switchTab(existing.id);
    return;
  }

  state.createTab(ws, "diff", {
    title: tabTitle,
    commitHash: commit.hash,
    diffFile: `Commit ${shortHash}: ${commit.message}`
  });
}

export async function previewDiff(state, repoPath, file, staged) {
  const modal = document.getElementById("rs-preview-modal");
  const titleEl = document.getElementById("rs-preview-title");
  const sizeEl = document.getElementById("rs-preview-size");
  const codeEl = document.getElementById("rs-preview-code");
  if (!modal || !titleEl || !codeEl) return;

  titleEl.textContent = `Diff: ${file} ${staged ? "(Staged)" : ""}`;
  sizeEl.textContent = "diff";
  codeEl.innerHTML = "Computing diff...";
  modal.style.display = "flex";

  try {
    const data = await tauriInvoke("get_git_diff", {
      path: repoPath,
      file: file || null,
      staged: Boolean(staged)
    });

    if (!data.diff || !data.diff.trim()) {
      codeEl.textContent = "(No diff or untracked new file)";
      return;
    }

    // Syntax-colored diff lines
    const lines = data.diff.split("\n");
    const colored = lines.map((l) => {
      const esc = escapeHtml(l);
      if (l.startsWith("+") && !l.startsWith("+++")) return `<span class="diff-add">${esc}</span>`;
      if (l.startsWith("-") && !l.startsWith("---")) return `<span class="diff-del">${esc}</span>`;
      if (l.startsWith("@@") || l.startsWith("diff ") || l.startsWith("index ")) return `<span class="diff-meta">${esc}</span>`;
      return esc;
    }).join("\n");

    codeEl.innerHTML = colored;
  } catch (err) {
    codeEl.textContent = "Error: " + String(err);
  }
}

export async function commitChanges(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) {
    alert("Select a workspace first");
    return;
  }

  const input = document.getElementById("rs-commit-msg");
  const stageCheck = document.getElementById("rs-commit-stage-all");
  const msg = input?.value.trim();
  if (!msg) {
    alert("Please enter a commit message");
    return;
  }

  const stageAllOption = stageCheck ? stageCheck.checked : true;
  const btn = document.getElementById("rs-commit-btn");
  if (btn) btn.disabled = true;

  try {
    await tauriInvoke("git_commit", {
      path: ws.path,
      message: msg,
      stageAll: stageAllOption
    });
    if (input) input.value = "";
    state.loadGitStatus();
  } catch (err) {
    alert("Commit error: " + String(err));
  } finally {
    if (btn) btn.disabled = false;
  }
}
