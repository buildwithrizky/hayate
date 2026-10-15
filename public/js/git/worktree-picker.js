import { tauriInvoke } from "../api.js";
import { escapeHtml } from "../state.js";
import { showPromptDialog, showConfirmDialog, showMessageDialog } from "../dialog.js";

export async function openWorktreePicker(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;

  let modal = document.getElementById("rs-worktree-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "rs-worktree-modal";
    modal.className = "rs-modal is-hidden";
    modal.innerHTML = `
      <div class="rs-modal-overlay"></div>
      <div class="rs-modal-window rs-branch-window">
        <div class="rs-modal-header">
          <div class="rs-modal-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            <span>Git Worktrees</span>
          </div>
          <button id="rs-worktree-close" class="btn btn-icon btn-xs" title="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="rs-branch-search-wrap">
          <input id="rs-worktree-search" type="text" class="rs-input rs-branch-search-input" placeholder="Search worktrees by branch or path..." spellcheck="false" autocomplete="off" />
        </div>
        <div class="rs-branch-actions-row">
          <button id="rs-worktree-create-btn" class="btn btn-xs rs-branch-create-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Create new worktree...</span>
          </button>
        </div>
        <div id="rs-worktree-list" class="rs-branch-list">
          <div class="rs-empty">Loading worktrees...</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector(".rs-modal-overlay")?.addEventListener("click", () => closeModal());
    modal.querySelector("#rs-worktree-close")?.addEventListener("click", () => closeModal());
    modal.querySelector("#rs-worktree-create-btn")?.addEventListener("click", async () => {
      closeModal();
      await handleCreateWorktree(state);
    });
  }

  function closeModal() {
    modal.classList.add("is-hidden");
  }

  modal.classList.remove("is-hidden");
  const searchInput = modal.querySelector("#rs-worktree-search");
  const listEl = modal.querySelector("#rs-worktree-list");
  if (searchInput) {
    searchInput.value = "";
    setTimeout(() => searchInput.focus(), 50);
  }

  let worktrees = [];
  try {
    worktrees = await tauriInvoke("git_list_worktrees", { repoPath: ws.path });
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="rs-empty error">${escapeHtml(String(err))}</div>`;
    return;
  }

  function renderList(query = "") {
    if (!listEl) return;
    const q = query.trim().toLowerCase();
    const filtered = (worktrees || []).filter(
      (w) => !q || w.branch.toLowerCase().includes(q) || w.path.toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="rs-empty">No worktrees found</div>`;
      return;
    }

    listEl.innerHTML = "";
    filtered.forEach((w) => {
      const item = document.createElement("div");
      item.className = `rs-branch-item rs-worktree-item ${w.is_main ? "is-main" : ""}`;

      let badge = "";
      if (w.is_main) {
        badge = `<span class="rs-branch-tag">main</span>`;
      } else if (w.is_agent_scratch) {
        badge = `<span class="rs-branch-tag rs-tag-agent" title="Agent Scratch Worktree">agent</span>`;
      }

      const branchName = w.branch || "(detached)";
      const shortPath = w.path.split("/").slice(-2).join("/");

      item.innerHTML = `
        <div class="rs-branch-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        </div>
        <div class="rs-branch-name">
          <span class="rs-worktree-branch">${escapeHtml(branchName)}</span>
          <span class="rs-worktree-path">${escapeHtml(shortPath)}</span>
        </div>
        ${badge}
        ${!w.is_main ? `<button class="btn btn-icon btn-xs rs-worktree-remove" title="Remove worktree">&times;</button>` : ""}
      `;

      item.addEventListener("click", async (e) => {
        if (e.target.closest(".rs-worktree-remove")) return;
        closeModal();
        await switchToWorktree(state, w);
      });

      const removeBtn = item.querySelector(".rs-worktree-remove");
      if (removeBtn) {
        removeBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const confirmed = await showConfirmDialog(
            "Remove Worktree",
            `Are you sure you want to remove worktree at:\n${w.path}\n(Branch: ${w.branch})`
          );
          if (confirmed) {
            try {
              await tauriInvoke("git_remove_worktree", {
                repoPath: ws.path,
                path: w.path,
                force: false
              });
              closeModal();
              openWorktreePicker(state);
            } catch (err) {
              showMessageDialog("Remove Worktree Failed", String(err));
            }
          }
        });
      }

      listEl.appendChild(item);
    });
  }

  renderList();

  searchInput?.addEventListener("input", (e) => {
    renderList(e.target.value);
  });
}

async function switchToWorktree(state, worktree) {
  const existingWs = state.workspaces.find((w) => w.path === worktree.path);
  if (existingWs) {
    state.selectWorkspace(existingWs);
    return;
  }

  const folderName = worktree.path.split("/").pop();
  const name = `${folderName} (${worktree.branch || "worktree"})`;
  await state.addWorkspace(name, worktree.path);
}

async function handleCreateWorktree(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;

  const branchName = await showPromptDialog(
    "New Worktree Branch",
    "Enter branch name for new worktree:",
    ""
  );
  if (!branchName?.trim()) return;

  const cleanBranch = branchName.trim();
  const defaultDir = `${ws.path}/.claude/worktrees/${cleanBranch}`;

  const targetPath = await showPromptDialog(
    "Worktree Path",
    "Enter destination directory path:",
    defaultDir
  );
  if (!targetPath?.trim()) return;

  try {
    await tauriInvoke("git_add_worktree", {
      repoPath: ws.path,
      path: targetPath.trim(),
      branch: cleanBranch,
      createBranch: true
    });
    await switchToWorktree(state, {
      path: targetPath.trim(),
      branch: cleanBranch,
      is_main: false,
      is_agent_scratch: targetPath.includes(".claude/worktrees")
    });
  } catch (err) {
    showMessageDialog("Create Worktree Failed", String(err));
  }
}
