import { tauriInvoke } from "../api.js";
import { escapeHtml } from "../state.js";
import { showPromptDialog, showMessageDialog } from "../dialog.js";

export async function openBranchPicker(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;

  let modal = document.getElementById("rs-branch-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "rs-branch-modal";
    modal.className = "rs-modal is-hidden";
    modal.innerHTML = `
      <div class="rs-modal-overlay"></div>
      <div class="rs-modal-window rs-branch-window">
        <div class="rs-modal-header">
          <div class="rs-modal-title">
            <span>Switch Branch</span>
          </div>
          <button id="rs-branch-close" class="btn btn-icon btn-xs" title="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="rs-branch-search-wrap">
          <input id="rs-branch-search" type="text" class="rs-input rs-branch-search-input" placeholder="Select a branch or tag..." spellcheck="false" autocomplete="off" />
        </div>
        <div class="rs-branch-actions-row">
          <button id="rs-branch-create-btn" class="btn btn-xs rs-branch-create-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Create new branch...</span>
          </button>
        </div>
        <div id="rs-branch-list" class="rs-branch-list">
          <div class="rs-empty">Loading branches...</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector(".rs-modal-overlay")?.addEventListener("click", () => closeModal());
    modal.querySelector("#rs-branch-close")?.addEventListener("click", () => closeModal());
    modal.querySelector("#rs-branch-create-btn")?.addEventListener("click", async () => {
      closeModal();
      await handleCreateBranch(state);
    });
  }

  function closeModal() {
    modal.classList.add("is-hidden");
  }

  modal.classList.remove("is-hidden");
  const searchInput = modal.querySelector("#rs-branch-search");
  const listEl = modal.querySelector("#rs-branch-list");
  if (searchInput) {
    searchInput.value = "";
    setTimeout(() => searchInput.focus(), 50);
  }

  let branches = [];
  try {
    branches = await tauriInvoke("git_list_branches", { repoPath: ws.path });
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="rs-empty error">${escapeHtml(String(err))}</div>`;
    return;
  }

  function renderList(query = "") {
    if (!listEl) return;
    const q = query.trim().toLowerCase();
    const filtered = (branches || []).filter((b) => !q || b.name.toLowerCase().includes(q));

    if (!filtered.length) {
      listEl.innerHTML = `<div class="rs-empty">No matching branches</div>`;
      return;
    }

    listEl.innerHTML = "";
    filtered.forEach((b) => {
      const itemEl = document.createElement("div");
      itemEl.className = `rs-branch-item ${b.is_current ? "current" : ""} ${b.is_remote ? "remote" : ""}`;
      const iconSvg = b.is_remote
        ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/><path d="M6 9v12"/></svg>`
        : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`;

      const checkmark = b.is_current ? `<span class="rs-branch-check">&#10003;</span>` : `<span class="rs-branch-check-spacer"></span>`;

      itemEl.innerHTML = `
        ${checkmark}
        <span class="rs-branch-icon">${iconSvg}</span>
        <span class="rs-branch-name">${escapeHtml(b.name)}</span>
        ${b.is_remote ? '<span class="rs-branch-tag">remote</span>' : ""}
      `;

      itemEl.addEventListener("click", async () => {
        closeModal();
        if (b.is_current) return;
        await handleCheckoutBranch(state, b.name);
      });

      listEl.appendChild(itemEl);
    });
  }

  renderList();
  searchInput?.addEventListener("input", (e) => renderList(e.target.value));
}

async function handleCheckoutBranch(state, branchName) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  try {
    await tauriInvoke("git_checkout_branch", {
      repoPath: ws.path,
      branchName,
      createNew: false
    });
    await state.loadGitStatus();
    await state.loadExplorer(true);
  } catch (err) {
    showMessageDialog("Checkout Failed", String(err));
  }
}

async function handleCreateBranch(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  const newName = await showPromptDialog("Create New Branch", "Enter new branch name:");
  if (!newName || !newName.trim()) return;
  try {
    await tauriInvoke("git_checkout_branch", {
      repoPath: ws.path,
      branchName: newName.trim(),
      createNew: true
    });
    await state.loadGitStatus();
    await state.loadExplorer(true);
  } catch (err) {
    showMessageDialog("Create Branch Failed", String(err));
  }
}
