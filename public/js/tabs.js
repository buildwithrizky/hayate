import { sendWs } from "./api.js";
import { escapeHtml } from "./state.js";

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
  }

  const id = "tab_" + Math.random().toString(36).substring(2, 9);
  const tab = {
    id,
    type: type || "terminal",
    workspaceId: wsId,
    title: initOptions.title || defaultTitle,
    repoPath,
    running: false,
    pid: null,
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
    if (repoPath) {
      state.spawnBackendShell(tab.id, repoPath);
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
  }
  return tab;
}

export function switchTab(state, tabId) {
  state.activeTabId = tabId;
  const tab = state.tabs.find((t) => t.id === tabId);

  if (tab && tab.workspaceId) {
    state.activeWorkspaceId = tab.workspaceId;
    state.activeTabByWorkspace[tab.workspaceId] = tabId;
  }

  // Hide or show terminal sessions
  state.terminalSessions.forEach((session, sId) => {
    if (sId === tabId) {
      session.container.classList.remove("hidden");
      requestAnimationFrame(() => {
        state.fitTerminal(sId);
        session.term.focus();
      });
    } else {
      session.container.classList.add("hidden");
    }
  });

  // Hide or show view containers (browser, markdown, editor, diff)
  state.viewContainers.forEach((container, vId) => {
    if (vId === tabId) {
      container.classList.remove("hidden");
      const textarea = container.querySelector(".wb-textarea");
      if (textarea) textarea.focus();
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

export function closeTab(state, tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  if (tab.isDirty) {
    const confirmClose = confirm(`Tab "${tab.title}" has unsaved changes. Close anyway?`);
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
      if (session.windowPasteHandler) {
        window.removeEventListener("paste", session.windowPasteHandler, { capture: true });
      }
      session.resizeObserver?.disconnect();
      session.term.dispose();
      session.container.remove();
      state.terminalSessions.delete(tabId);
    }
  } else {
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
      const targetWs = state.workspaces.find((w) => w.id === wsId);
      if (targetWs) {
        createTab(state, targetWs, "terminal");
      } else {
        state.activeTabId = null;
        delete state.activeTabByWorkspace[wsId];
        renderTabs(state);
        renderCwd(state);
        renderStatusBadge(state);
      }
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
      state.spawnBackendShell(tab.id, tab.repoPath);
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

export function renderTabs(state) {
  const container = document.getElementById("tabs-container");
  const emptyNotice = document.getElementById("terminal-empty-notice");
  if (!container) return;

  container.innerHTML = "";
  const currentTabs = state.activeWorkspaceId
    ? state.tabs.filter((t) => t.workspaceId === state.activeWorkspaceId)
    : state.tabs;

  if (emptyNotice) {
    emptyNotice.style.display = state.tabs.length === 0 ? "flex" : "none";
  }

  currentTabs.forEach((tab) => {
    const pill = document.createElement("div");
    const isActive = tab.id === state.activeTabId;
    pill.className = `tab-pill ${isActive ? "active" : ""}`;

    let typeBadge = "";
    if (tab.type === "terminal") {
      typeBadge = `<span class="tab-type-tag is-terminal">&gt;_</span>`;
    } else if (tab.type === "browser") {
      typeBadge = `<span class="tab-type-tag is-browser">&#x1F310;</span>`;
    } else if (tab.type === "markdown") {
      typeBadge = `<span class="tab-type-tag is-markdown">M&darr;</span>`;
    } else if (tab.type === "editor") {
      typeBadge = `<span class="tab-type-tag is-editor">&lt;/&gt;</span>`;
    } else if (tab.type === "diff") {
      typeBadge = `<span class="tab-type-tag is-diff">⇄</span>`;
    }

    const dirtyBadge = tab.isDirty ? `<span class="tab-dirty-dot" title="Unsaved changes">&#x25cf;</span>` : "";
    const dotEl = tab.type === "terminal" ? `<span class="tab-dot ${tab.running ? "live" : ""}"></span>` : "";

    pill.innerHTML = `
      ${typeBadge}
      ${dotEl}
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      ${dirtyBadge}
      <button class="tab-close" title="Close tab">&times;</button>
    `;

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
  const p = tab?.repoPath || ws?.path || "No workspace";
  label.textContent = p;
  label.title = p;
}
