import { tauriInvoke } from "./api.js";
import { escapeHtml } from "./state.js";

export function getActiveWorkspace(state) {
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId) || null;
}

export async function loadWorkspaces(state) {
  try {
    const data = await tauriInvoke("get_workspaces");
    if (Array.isArray(data)) {
      state.workspaces = data;
      renderWorkspaces(state);
      if (state.workspaces.length > 0 && !state.activeWorkspaceId) {
        selectWorkspace(state, state.workspaces[0]);
      }
    }
  } catch (err) {
    console.error("Failed to load workspaces", err);
  }
}

export async function pickFolder(state) {
  try {
    const btn = document.getElementById("add-ws-btn");
    if (btn) btn.disabled = true;
    const data = await tauriInvoke("pick_folder");
    if (data && !data.canceled && data.id) {
      await loadWorkspaces(state);
      selectWorkspace(state, data);
    }
  } catch (err) {
    console.error("Pick folder error", err);
  } finally {
    const btn = document.getElementById("add-ws-btn");
    if (btn) btn.disabled = false;
  }
}

export async function addWorkspace(state, name, path) {
  try {
    const created = await tauriInvoke("create_workspace", { name, path });
    if (created && created.id) {
      state.isManualAdding = false;
      await loadWorkspaces(state);
      selectWorkspace(state, created);
    } else {
      alert("Failed to add workspace");
    }
  } catch (err) {
    alert(String(err) || "Error adding workspace");
  }
}

export async function updateWorkspace(state, id, name, path) {
  try {
    await tauriInvoke("update_workspace", { id, name, path });
    state.editingWorkspaceId = null;
    await loadWorkspaces(state);
  } catch (err) {
    alert(String(err) || "Error updating workspace");
  }
}

export async function deleteWorkspace(state, id) {
  if (!confirm("Remove workspace from list?")) return;
  try {
    await tauriInvoke("delete_workspace", { id });
    const toClose = state.tabs.filter((t) => t.workspaceId === id);
    for (const t of toClose) {
      state.closeTab(t.id);
    }
    await loadWorkspaces(state);
    if (state.activeWorkspaceId === id) {
      if (state.workspaces.length > 0) {
        selectWorkspace(state, state.workspaces[0]);
      } else {
        state.activeWorkspaceId = null;
        state.renderTabs();
        state.renderCwd();
      }
    }
  } catch (err) {
    alert(String(err) || "Error removing workspace");
  }
}

export function selectWorkspace(state, ws) {
  state.activeWorkspaceId = ws.id;
  state.fileExplorerPath = ws.path;
  const rememberedTabId = state.activeTabByWorkspace[ws.id];
  const wsTabs = state.tabs.filter((t) => t.workspaceId === ws.id);

  if (rememberedTabId && wsTabs.some((t) => t.id === rememberedTabId)) {
    state.switchTab(rememberedTabId);
  } else if (wsTabs.length > 0) {
    state.switchTab(wsTabs[0].id);
  } else {
    state.createTab(ws);
  }
  renderWorkspaces(state);
  state.renderTabs();
  state.renderCwd();
  state.reloadRightSidebar();
}

export function renderWorkspaces(state) {
  const listEl = document.getElementById("workspace-list");
  const countEl = document.getElementById("ws-count-badge");
  if (countEl) countEl.textContent = `${state.workspaces.length} repos`;
  if (!listEl) return;

  listEl.innerHTML = "";

  // If manual add panel is active
  if (state.isManualAdding) {
    const form = document.createElement("div");
    form.className = "form-panel";
    form.innerHTML = `
      <input id="input-ws-name" class="form-input" placeholder="Workspace Name" />
      <input id="input-ws-path" class="form-input" placeholder="Full path (/Users/...)" />
      <div class="form-actions">
        <button id="cancel-manual-add" class="btn btn-xs">Cancel</button>
        <button id="submit-manual-add" class="btn btn-xs btn-primary">Save</button>
      </div>
    `;
    listEl.appendChild(form);

    form.querySelector("#cancel-manual-add").onclick = () => {
      state.isManualAdding = false;
      renderWorkspaces(state);
    };
    form.querySelector("#submit-manual-add").onclick = () => {
      const n = document.getElementById("input-ws-name").value.trim();
      const p = document.getElementById("input-ws-path").value.trim();
      if (n && p) addWorkspace(state, n, p);
    };
  }

  if (state.workspaces.length === 0 && !state.isManualAdding) {
    const empty = document.createElement("div");
    empty.className = "terminal-empty";
    empty.style.position = "var(--pos-static)";
    empty.style.padding = "var(--space-3xl) var(--space-md)";
    empty.style.textAlign = "var(--text-align-center)";
    empty.innerHTML = `No workspaces yet.<br><button id="empty-add-btn" class="btn btn-xs btn-primary" style="margin-top: var(--space-md);">Add Repository</button>`;
    listEl.appendChild(empty);
    empty.querySelector("#empty-add-btn").onclick = () => pickFolder(state);
    return;
  }

  state.workspaces.forEach((ws) => {
    if (state.editingWorkspaceId === ws.id) {
      const editForm = document.createElement("div");
      editForm.className = "form-panel";
      editForm.innerHTML = `
        <input id="edit-ws-name-${ws.id}" class="form-input" value="${escapeHtml(ws.name)}" />
        <input id="edit-ws-path-${ws.id}" class="form-input" value="${escapeHtml(ws.path)}" />
        <div class="form-actions">
          <button id="cancel-edit-${ws.id}" class="btn btn-xs">Cancel</button>
          <button id="save-edit-${ws.id}" class="btn btn-xs btn-primary">Save</button>
        </div>
      `;
      listEl.appendChild(editForm);
      editForm.querySelector(`#cancel-edit-${ws.id}`).onclick = () => {
        state.editingWorkspaceId = null;
        renderWorkspaces(state);
      };
      editForm.querySelector(`#save-edit-${ws.id}`).onclick = () => {
        const n = document.getElementById(`edit-ws-name-${ws.id}`).value.trim();
        const p = document.getElementById(`edit-ws-path-${ws.id}`).value.trim();
        if (n && p) updateWorkspace(state, ws.id, n, p);
      };
      return;
    }

    const item = document.createElement("div");
    const isActive = ws.id === state.activeWorkspaceId;
    item.className = `ws-item ${isActive ? "active" : ""}`;
    item.innerHTML = `
      <div class="ws-info">
        <div class="ws-title">${escapeHtml(ws.name)}</div>
        <div class="ws-path" title="${escapeHtml(ws.path)}">${escapeHtml(ws.path)}</div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-icon btn-xs ws-more-btn" title="Workspace options" aria-label="Workspace options">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="1"/>
            <circle cx="12" cy="5" r="1"/>
            <circle cx="12" cy="19" r="1"/>
          </svg>
        </button>
        <div class="dropdown-menu dropdown-menu-right ws-dropdown-menu">
          <button class="dropdown-item" data-action="terminal">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"/>
              <line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            <span>Open in Terminal</span>
          </button>
          <button class="dropdown-item" data-action="rename">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
            </svg>
            <span>Rename</span>
          </button>
          <button class="dropdown-item" data-action="copy-path">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>
            <span>Copy Path</span>
          </button>
          <div class="dropdown-divider"></div>
          <button class="dropdown-item dropdown-item-danger" data-action="delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"/>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
            <span>Remove Workspace</span>
          </button>
        </div>
      </div>
    `;

    item.onclick = (e) => {
      if (e.target.closest("button") || e.target.closest(".dropdown-menu")) return;
      selectWorkspace(state, ws);
    };

    const moreBtn = item.querySelector(".ws-more-btn");
    const menu = item.querySelector(".ws-dropdown-menu");
    const actionsWrapper = item.querySelector(".ws-actions");

    const toggleWsMenu = (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains("open");
      document.querySelectorAll(".ws-dropdown-menu.open").forEach((m) => {
        m.classList.remove("open");
        m.closest(".ws-actions")?.classList.remove("has-open-menu");
        m.closest(".ws-item")?.classList.remove("has-open-menu");
      });
      if (!isOpen) {
        const rect = moreBtn.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        menu.classList.toggle("dropup", spaceBelow < 180);
        menu.classList.add("open");
        actionsWrapper.classList.add("has-open-menu");
        item.classList.add("has-open-menu");
      }
    };

    moreBtn.onclick = toggleWsMenu;
    item.oncontextmenu = (e) => {
      e.preventDefault();
      toggleWsMenu(e);
    };

    menu.querySelectorAll(".dropdown-item").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        menu.classList.remove("open");
        actionsWrapper.classList.remove("has-open-menu");
        item.classList.remove("has-open-menu");
        const action = btn.getAttribute("data-action");
        if (action === "terminal") {
          selectWorkspace(state, ws);
          state.createTab(ws, "terminal");
        } else if (action === "rename") {
          state.editingWorkspaceId = ws.id;
          renderWorkspaces(state);
        } else if (action === "copy-path") {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(ws.path);
          }
        } else if (action === "delete") {
          deleteWorkspace(state, ws.id);
        }
      };
    });

    listEl.appendChild(item);
  });
}
