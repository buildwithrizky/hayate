import { sendWs } from "./api.js";
import { escapeHtml } from "./state.js";
import { showConfirmDialog } from "./dialog.js";

export function createTab(state, workspace, type = "terminal", initOptions = {}) {
  const targetWs = workspace || state.workspaces.find((w) => w.id === state.activeWorkspaceId) || state.workspaces[0];
  const repoPath = targetWs ? targetWs.path : "";
  const wsId = targetWs ? targetWs.id : "";
  const wsTabsCount = state.tabs.filter((t) => t.workspaceId === wsId).length;

  let defaultTitle = `Term ${wsTabsCount + 1}`;
  if (type === "terminal") {
    defaultTitle = targetWs ? (wsTabsCount === 0 ? targetWs.name : `Term ${wsTabsCount + 1}`) : `Term ${state.tabs.length + 1}`;
  } else if (type === "browser") {
    defaultTitle = "Browser";
  } else if (type === "markdown") {
    defaultTitle = initOptions.filePath ? initOptions.filePath.split("/").pop() : "Scratch.md";
  } else if (type === "editor") {
    defaultTitle = initOptions.filePath ? initOptions.filePath.split("/").pop() : "Untitled";
  } else if (type === "diff") {
    defaultTitle = initOptions.title || "Diff";
  } else if (type === "image") {
    defaultTitle = initOptions.filePath ? initOptions.filePath.split("/").pop() : "Image";
  }

  let title = (initOptions.title || defaultTitle).replace(/^[⇄\s]+/, "");

  const id = "tab_" + Math.random().toString(36).substring(2, 9);
  const tab = {
    id,
    type: type || "terminal",
    workspaceId: wsId,
    title,
    repoPath,
    running: false,
    pid: null,
    // Terminal custom working directory
    cwd: initOptions.cwd || null,
    // Metadata for non-terminal views
    url: initOptions.url || "http://localhost:3000",
    filePath: initOptions.filePath || null,
    content: initOptions.content || "",
    savedContent: initOptions.content || "",
    isDirty: false,
    isEditMode: Boolean(initOptions.isEditMode),
    // Metadata for diff view
    diffFile: initOptions.diffFile || null,
    isStaged: Boolean(initOptions.isStaged),
    gitStatusCode: initOptions.gitStatusCode || "M",
    commitHash: initOptions.commitHash || null
  };

  state.tabs.push(tab);
  if (wsId) {
    state.activeTabByWorkspace[wsId] = id;
  }

  if (tab.type === "terminal") {
    state.mountTerminalInstance(tab);
    switchTab(state, id);
    const initialCwd = tab.cwd || repoPath;
    if (initialCwd) {
      state.spawnBackendShell(tab.id, initialCwd);
    }
  } else if (tab.type === "browser") {
    state.mountBrowserInstance(tab);
    switchTab(state, id);
  } else if (tab.type === "markdown") {
    state.mountMarkdownInstance(tab);
    switchTab(state, id);
    if (tab.filePath && !initOptions.content) {
      state.loadFileForTab(tab);
    }
  } else if (tab.type === "editor") {
    state.mountEditorInstance(tab);
    switchTab(state, id);
    if (tab.filePath && !initOptions.content) {
      state.loadFileForTab(tab);
    }
  } else if (tab.type === "diff") {
    state.mountDiffInstance(tab);
    switchTab(state, id);
  } else if (tab.type === "image") {
    state.mountImageInstance(tab);
    switchTab(state, id);
  }
  return tab;
}

export function switchTab(state, tabId = null) {
  state.activeTabId = tabId || null;
  const tab = tabId ? state.tabs.find((t) => t.id === tabId) : null;

  if (tab && tab.workspaceId) {
    state.activeWorkspaceId = tab.workspaceId;
    state.activeTabByWorkspace[tab.workspaceId] = tabId;
  }

  // Hide or show terminal sessions
  state.terminalSessions.forEach((session, sId) => {
    if (tabId && sId === tabId) {
      session.container.classList.remove("hidden");
      if (session.buffer) {
        session.term.write(session.buffer);
        session.buffer = "";
      }
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          state.fitTerminal(sId);
          session.term.focus();
        });
      } else {
        state.fitTerminal?.(sId);
        session.term?.focus?.();
      }
    } else {
      session.container.classList.add("hidden");
    }
  });

  // Hide or show view containers (browser, markdown, editor, diff)
  state.viewContainers.forEach((container, vId) => {
    if (tabId && vId === tabId) {
      container.classList.remove("hidden");
      const editorInstance = state.getEditorInstance?.(vId);
      const diffEditorInstance = state.getDiffEditorInstance?.(vId);
      if (editorInstance) {
        editorInstance.layout();
        editorInstance.focus();
      } else if (diffEditorInstance) {
        diffEditorInstance.layout();
      } else {
        const textarea = container.querySelector(".wb-textarea");
        if (textarea) textarea.focus();
      }
    } else {
      container.classList.add("hidden");
    }
  });

  state.renderWorkspaces();
  renderTabs(state);
  renderCwd(state);
  renderStatusBadge(state);
  state.reloadRightSidebar();
}

export async function closeTab(state, tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  if (tab.isDirty) {
    const confirmClose = await showConfirmDialog({
      title: "Unsaved Changes",
      message: `Tab "${tab.title}" has unsaved changes. Close anyway?`,
      confirmLabel: "Close Anyway",
      isDanger: true
    });
    if (!confirmClose) return;
  }

  const wsId = tab.workspaceId;
  const wsTabs = state.tabs.filter((t) => t.workspaceId === wsId);
  const idxInWs = wsTabs.findIndex((t) => t.id === tabId);

  // Teardown xterm & backend session if terminal
  if (tab.type === "terminal") {
    sendWs({ action: "kill", sessionId: tabId });
    const session = state.terminalSessions.get(tabId);
    if (session) {
      clearTimeout(session.resizeTimer);
      if (session.windowPasteHandler) {
        window.removeEventListener("paste", session.windowPasteHandler, { capture: true });
      }
      session.resizeObserver?.disconnect();
      session.term.dispose();
      session.container.remove();
      state.terminalSessions.delete(tabId);
    }
  } else {
    if (tab.type === "editor" || tab.type === "markdown") {
      state.disposeEditorInstance?.(tabId);
    } else if (tab.type === "diff") {
      state.disposeDiffInstance?.(tabId);
    } else if (tab.type === "image") {
      state.disposeImageInstance?.(tabId);
    }
    const viewEl = state.viewContainers.get(tabId);
    if (viewEl) {
      viewEl.remove();
      state.viewContainers.delete(tabId);
    }
  }

  state.tabs = state.tabs.filter((t) => t.id !== tabId);
  const remainingWsTabs = state.tabs.filter((t) => t.workspaceId === wsId);

  if (state.activeTabId === tabId) {
    if (remainingWsTabs.length > 0) {
      const nextIdx = Math.min(idxInWs, remainingWsTabs.length - 1);
      switchTab(state, remainingWsTabs[nextIdx].id);
    } else {
      delete state.activeTabByWorkspace[wsId];
      switchTab(state, null);
    }
  } else if (state.activeTabByWorkspace[wsId] === tabId) {
    if (remainingWsTabs.length > 0) {
      state.activeTabByWorkspace[wsId] = remainingWsTabs[0].id;
    } else {
      delete state.activeTabByWorkspace[wsId];
    }
    renderTabs(state);
  }
}

export function restartActiveTab(state) {
  if (!state.activeTabId) return;
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!tab) return;

  if (tab.type === "terminal") {
    const session = state.terminalSessions.get(state.activeTabId);
    if (session) {
      session.term.reset();
      session.term.writeln("\x1b[33m\r\n[Reconnecting shell session...]\x1b[0m\r\n");
      state.spawnBackendShell(tab.id, tab.cwd || tab.repoPath);
    }
  } else if (tab.type === "browser") {
    const container = state.viewContainers.get(tab.id);
    const iframe = container?.querySelector(".wb-browser-frame");
    if (iframe) iframe.src = tab.url;
  } else if (tab.type === "markdown" || tab.type === "editor") {
    if (tab.filePath) {
      state.loadFileForTab(tab);
    }
  }
}

export function clearActiveTab(state) {
  if (!state.activeTabId) return;
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (tab && tab.type === "terminal") {
    const session = state.terminalSessions.get(state.activeTabId);
    session?.term?.clear();
  }
}

export function sendInputToActive(state, text) {
  if (!state.activeTabId) return;
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!tab || tab.type !== "terminal") {
    // If active tab is not terminal, try finding or creating a terminal tab
    const termTab = state.tabs.find((t) => t.workspaceId === state.activeWorkspaceId && t.type === "terminal");
    if (termTab) {
      switchTab(state, termTab.id);
      sendWs({ action: "input", sessionId: termTab.id, data: text });
    }
    return;
  }
  sendWs({
    action: "input",
    sessionId: state.activeTabId,
    data: text
  });
  const session = state.terminalSessions.get(state.activeTabId);
  session?.term?.focus();
}

export function renameTab(state, tabId) {
  state.editingTabId = tabId || state.activeTabId;
  renderTabs(state);
}

export function renderTabs(state) {
  const container = document.getElementById("tabs-container");
  const emptyNotice = document.getElementById("terminal-empty-notice");
  if (!container) return;

  container.innerHTML = "";
  const currentTabs = state.activeWorkspaceId
    ? state.tabs.filter((t) => t.workspaceId === state.activeWorkspaceId)
    : state.tabs;

  if (emptyNotice) {
    emptyNotice.style.display = currentTabs.length === 0 ? "var(--display-flex)" : "var(--display-none)";
  }

  currentTabs.forEach((tab) => {
    const pill = document.createElement("div");
    const isActive = tab.id === state.activeTabId;
    pill.className = `tab-pill ${isActive ? "active" : ""}`;

    let typeBadge = "";
    if (tab.type === "terminal") {
      typeBadge = `<svg class="tab-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
    } else if (tab.type === "browser") {
      typeBadge = `<svg class="tab-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    } else if (tab.type === "markdown") {
      typeBadge = `<svg class="tab-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    } else if (tab.type === "editor") {
      typeBadge = `<svg class="tab-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
    } else if (tab.type === "diff") {
      typeBadge = `<svg class="tab-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="m21 3-7 7"/><path d="M8 21H3v-5"/><path d="m3 21 7-7"/></svg>`;
    } else if (tab.type === "image") {
      typeBadge = `<svg class="tab-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;
    }

    const dirtyBadge = tab.isDirty ? `<span class="tab-dirty-dot" title="Unsaved changes">&#x25cf;</span>` : "";
    const isEditing = tab.id === state.editingTabId;

    const titleEl = isEditing
      ? `<input class="tab-title-input" value="${escapeHtml(tab.title)}" />`
      : `<span class="tab-title">${escapeHtml(tab.title)}</span>`;

    pill.innerHTML = `
      ${typeBadge}
      ${titleEl}
      ${dirtyBadge}
      <button class="tab-close" title="Close tab">&times;</button>
    `;

    if (isEditing) {
      const input = pill.querySelector(".tab-title-input");
      if (input) {
        let finished = false;
        const commit = (val) => {
          if (finished) return;
          finished = true;
          const trimmed = val ? val.trim() : "";
          tab.title = trimmed || tab.title;
          state.editingTabId = null;
          renderTabs(state);
        };
        const cancel = () => {
          if (finished) return;
          finished = true;
          state.editingTabId = null;
          renderTabs(state);
        };

        input.onclick = (e) => e.stopPropagation();
        input.ondblclick = (e) => e.stopPropagation();
        input.onblur = () => commit(input.value);
        input.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            commit(input.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        };

        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      }
    } else {
      const titleSpan = pill.querySelector(".tab-title");
      if (titleSpan) {
        titleSpan.ondblclick = (e) => {
          e.stopPropagation();
          renameTab(state, tab.id);
        };
      }
    }

    pill.onclick = () => switchTab(state, tab.id);
    pill.querySelector(".tab-close").onclick = (e) => {
      e.stopPropagation();
      closeTab(state, tab.id);
    };

    container.appendChild(pill);
  });
}

export function renderStatusBadge(state) {
  const badge = document.getElementById("session-status-badge");
  if (!badge) return;
  const tab = state.tabs.find((t) => t.id === state.activeTabId);

  if (tab && tab.type === "terminal") {
    if (tab.running) {
      badge.textContent = tab.pid ? `PID ${tab.pid}` : "LIVE";
      badge.style.background = "rgba(16, 185, 129, 0.15)";
      badge.style.borderColor = "rgba(16, 185, 129, 0.4)";
      badge.style.color = "var(--accent-emerald)";
    } else {
      badge.textContent = "SHELL OFF";
      badge.style.background = "var(--bg-subtle)";
      badge.style.borderColor = "var(--border-subtle)";
      badge.style.color = "var(--text-dim)";
    }
  } else if (tab && tab.type === "browser") {
    badge.textContent = "BROWSER";
    badge.style.background = "rgba(0, 145, 255, 0.15)";
    badge.style.borderColor = "rgba(0, 145, 255, 0.4)";
    badge.style.color = "var(--accent-blue)";
  } else if (tab && tab.type === "markdown") {
    badge.textContent = tab.isEditMode ? "MD EDIT" : "MD PREVIEW";
    badge.style.background = "rgba(0, 210, 255, 0.15)";
    badge.style.borderColor = "rgba(0, 210, 255, 0.4)";
    badge.style.color = "var(--accent-cyan)";
  } else if (tab && tab.type === "editor") {
    badge.textContent = tab.isDirty ? "UNSAVED" : "EDITOR";
    badge.style.background = tab.isDirty ? "rgba(245, 158, 11, 0.15)" : "var(--bg-subtle)";
    badge.style.borderColor = tab.isDirty ? "rgba(245, 158, 11, 0.4)" : "var(--border-subtle)";
    badge.style.color = tab.isDirty ? "var(--accent-amber)" : "var(--text-muted)";
  } else if (tab && tab.type === "diff") {
    badge.textContent = "DIFF";
    badge.style.background = "rgba(0, 210, 255, 0.15)";
    badge.style.borderColor = "rgba(0, 210, 255, 0.4)";
    badge.style.color = "var(--accent-cyan)";
  } else if (tab && tab.type === "image") {
    badge.textContent = "IMAGE";
    badge.style.background = "rgba(0, 210, 255, 0.15)";
    badge.style.borderColor = "rgba(0, 210, 255, 0.4)";
    badge.style.color = "var(--accent-cyan)";
  } else {
    badge.textContent = "NO TAB";
    badge.style.background = "var(--bg-subtle)";
    badge.style.borderColor = "var(--border-subtle)";
    badge.style.color = "var(--text-dim)";
  }
}

export function renderCwd(state) {
  const label = document.getElementById("cwd-path");
  if (!label) return;
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  const p = tab?.cwd || tab?.repoPath || ws?.path || "No workspace";
  label.textContent = p;
  label.title = p;
}
