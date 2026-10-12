import { tauriInvoke } from "../api.js";
import { showMessageDialog } from "../dialog.js";

export async function updateSyncIndicator(state) {
  const ws = state.getActiveWorkspace();
  const labelEl = document.getElementById("rs-git-sync-count");
  if (!labelEl) return;

  if (!ws) {
    labelEl.textContent = "";
    labelEl.classList.add("is-hidden");
    return;
  }

  try {
    const status = await tauriInvoke("git_get_sync_status", { repoPath: ws.path });
    if (status && (status.ahead > 0 || status.behind > 0)) {
      labelEl.textContent = `↓${status.behind} ↑${status.ahead}`;
      labelEl.classList.remove("is-hidden");
    } else {
      labelEl.textContent = "";
      labelEl.classList.add("is-hidden");
    }
  } catch {
    labelEl.textContent = "";
    labelEl.classList.add("is-hidden");
  }
}

export async function syncGitChanges(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  const syncBtn = document.getElementById("rs-git-sync");
  syncBtn?.classList.add("is-spinning");

  try {
    await tauriInvoke("git_pull", { repoPath: ws.path });
    await tauriInvoke("git_push", { repoPath: ws.path });
    await state.loadGitStatus();
    await state.loadExplorer(true);
  } catch (err) {
    showMessageDialog("Sync Failed", String(err));
  } finally {
    syncBtn?.classList.remove("is-spinning");
    await updateSyncIndicator(state);
  }
}

export function showGitMoreMenu(state, anchorEl) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;

  const existing = document.getElementById("rs-git-more-menu");
  if (existing) {
    existing.remove();
    return;
  }

  const menuEl = document.createElement("div");
  menuEl.id = "rs-git-more-menu";
  menuEl.className = "rs-git-menu";

  const items = [
    { label: "Fetch", action: () => executeGitAction(state, "git_fetch", "Fetch") },
    { label: "Pull", action: () => executeGitAction(state, "git_pull", "Pull") },
    { label: "Push", action: () => executeGitAction(state, "git_push", "Push") },
    { divider: true },
    { label: "Stash Changes", action: () => executeGitAction(state, "git_stash", "Stash", { includeUntracked: true }) },
    { label: "Pop Latest Stash", action: () => executeGitAction(state, "git_stash_pop", "Pop Stash") }
  ];

  items.forEach((item) => {
    if (item.divider) {
      const sep = document.createElement("div");
      sep.className = "rs-git-menu-divider";
      menuEl.appendChild(sep);
      return;
    }

    const row = document.createElement("div");
    row.className = "rs-git-menu-item";
    row.textContent = item.label;
    row.addEventListener("click", () => {
      menuEl.remove();
      item.action();
    });
    menuEl.appendChild(row);
  });

  document.body.appendChild(menuEl);

  const rect = anchorEl.getBoundingClientRect();
  menuEl.style.top = `${rect.bottom + 4}px`;
  menuEl.style.right = `${window.innerWidth - rect.right}px`;

  const onDocClick = (e) => {
    if (!menuEl.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
      menuEl.remove();
      document.removeEventListener("pointerdown", onDocClick);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", onDocClick), 10);
}

async function executeGitAction(state, cmd, actionName, extraArgs = {}) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  try {
    const res = await tauriInvoke(cmd, { repoPath: ws.path, ...extraArgs });
    await state.loadGitStatus();
    await state.loadExplorer(true);
    await updateSyncIndicator(state);
    if (res && res.trim()) {
      console.log(`Git ${actionName}:`, res);
    }
  } catch (err) {
    showMessageDialog(`${actionName} Failed`, String(err));
  }
}
