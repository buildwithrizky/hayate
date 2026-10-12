import { escapeHtml } from "./state.js";
import { getFileIcon } from "./explorer-icons.js";

let isSectionCollapsed = true;

export function renderOpenEditors(state) {
  const container = document.getElementById("rs-open-editors");
  if (!container) return;

  const currentTabs = state.activeWorkspaceId
    ? state.tabs.filter((t) => t.workspaceId === state.activeWorkspaceId)
    : state.tabs;

  container.innerHTML = `
    <div class="rs-section-header" id="rs-open-editors-toggle">
      <span class="rs-section-title">
        <span class="rs-section-chevron ${isSectionCollapsed ? "collapsed" : ""}">
          <svg class="rs-chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
        <span>OPEN EDITORS</span>
        <span class="rs-badge">${currentTabs.length}</span>
      </span>
      <div class="rs-section-actions">
        <button id="rs-open-editors-save-all" class="btn btn-icon btn-xs" title="Save All">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
        </button>
        <button id="rs-open-editors-close-all" class="btn btn-icon btn-xs" title="Close All">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="rs-section-body ${isSectionCollapsed ? "is-hidden" : ""}" id="rs-open-editors-list">
      ${
        currentTabs.length === 0
          ? `<div class="rs-empty rs-empty-compact">No open editors</div>`
          : ""
      }
    </div>
  `;

  const toggleBtn = container.querySelector("#rs-open-editors-toggle");
  toggleBtn.onclick = (e) => {
    if (e.target.closest(".btn-icon")) return;
    isSectionCollapsed = !isSectionCollapsed;
    renderOpenEditors(state);
  };

  const saveAllBtn = container.querySelector("#rs-open-editors-save-all");
  if (saveAllBtn) {
    saveAllBtn.onclick = async (e) => {
      e.stopPropagation();
      const dirtyTabs = currentTabs.filter((t) => t.isDirty);
      for (const t of dirtyTabs) {
        await state.saveTabContent(t);
      }
      renderOpenEditors(state);
    };
  }

  const closeAllBtn = container.querySelector("#rs-open-editors-close-all");
  if (closeAllBtn) {
    closeAllBtn.onclick = (e) => {
      e.stopPropagation();
      const tabIds = currentTabs.map((t) => t.id);
      for (const id of tabIds) {
        state.closeTab(id);
      }
    };
  }

  const listEl = container.querySelector("#rs-open-editors-list");
  if (!listEl || isSectionCollapsed || currentTabs.length === 0) return;

  currentTabs.forEach((tab) => {
    const isActive = tab.id === state.activeTabId;
    const row = document.createElement("div");
    row.className = `rs-editor-item ${isActive ? "active" : ""}`;

    const iconHtml = tab.filePath
      ? getFileIcon(tab.title, false, false)
      : `<span class="rs-file-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg></span>`;

    const dirtyHtml = tab.isDirty
      ? `<span class="rs-editor-dirty" title="Unsaved changes">&#x25cf;</span>`
      : "";

    row.innerHTML = `
      ${iconHtml}
      <span class="rs-editor-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title)}</span>
      ${dirtyHtml}
      <button class="rs-editor-close btn btn-icon btn-xs" title="Close">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;

    row.onclick = () => {
      state.switchTab(tab.id);
    };

    const closeBtn = row.querySelector(".rs-editor-close");
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      state.closeTab(tab.id);
    };

    listEl.appendChild(row);
  });
}
