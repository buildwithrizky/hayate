import { writeToTerminal, flushTerminalWrite } from "./views/terminal.js";

// Tauri IPC Helper (Tauri v2 global API)
export const tauriInvoke = (cmd, args = {}) => {
  if (typeof window !== "undefined" && window.__TAURI__?.core?.invoke) {
    return window.__TAURI__.core.invoke(cmd, args);
  }
  return Promise.reject(new Error("Tauri IPC not available"));
};

export const tauriListen = (event, handler) => {
  if (typeof window !== "undefined" && window.__TAURI__?.event?.listen) {
    return window.__TAURI__.event.listen(event, handler);
  }
  return Promise.resolve(() => {});
};

export function initTerminalFocusThrottling(state) {
  if (typeof window === "undefined" || state._terminalThrottlingInit) return;
  state._terminalThrottlingInit = true;

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.activeTabId) {
      const session = state.terminalSessions?.get(state.activeTabId);
      if (session && session.buffer) {
        const buffered = session.buffer;
        session.buffer = "";
        writeToTerminal(session, buffered);
        flushTerminalWrite(session);
      }
    }
  });
}

// Native Tauri PTY Communication
export async function initPty(state) {
  initTerminalFocusThrottling(state);
  try {
    state.unlistenPty = await tauriListen("pty-message", (event) => {
      handleBackendMessage(state, event.payload);
    });
  } catch (err) {
    console.error("Failed to setup pty-message listener", err);
  }
}

export async function sendWs(data) {
  if (globalThis.__test_sendWs) {
    return globalThis.__test_sendWs(data);
  }
  try {
    await tauriInvoke("pty_send", { msg: data });
    return true;
  } catch (err) {
    console.error("pty_send error", err);
    return false;
  }
}

export function handleBackendMessage(state, msg) {
  if (!msg) return;
  const session = state.terminalSessions.get(msg.sessionId);
  const tab = state.tabs.find((t) => t.id === msg.sessionId);

  if (msg.type === "output") {
    const isTabActive = state.activeTabId === msg.sessionId && !document.hidden;
    if (!isTabActive) {
      if (session) {
        const buf = (session.buffer || "") + msg.text;
        session.buffer = buf.length > 65536 ? buf.slice(-65536) : buf;
      }
    } else {
      if (session) {
        writeToTerminal(session, msg.text);
      } else {
        session?.term?.write(msg.text);
      }
    }
  } else if (msg.type === "spawned") {
    if (tab) {
      tab.running = true;
      tab.pid = msg.pid;
    }
    state.renderTabs();
    state.renderStatusBadge();
  } else if (msg.type === "exit") {
    if (tab) {
      tab.running = false;
      tab.pid = null;
    }
    if (session) {
      flushTerminalWrite(session);
    }
    session?.term?.writeln(`\r\n\x1b[90m[Process completed with exit code ${msg.code}]\x1b[0m`);
    state.renderTabs();
    state.renderStatusBadge();
  } else if (msg.type === "error") {
    if (session) {
      flushTerminalWrite(session);
    }
    session?.term?.writeln(`\r\n\x1b[31m[Error: ${msg.error}]\x1b[0m`);
  } else if (msg.type === "stopped") {
    if (tab) {
      tab.running = false;
      tab.pid = null;
    }
    if (session) {
      flushTerminalWrite(session);
    }
    state.renderTabs();
    state.renderStatusBadge();
  }
}

export function spawnBackendShell(state, sessionId, repoPath) {
  if (!repoPath) return;
  const session = state.terminalSessions.get(sessionId);
  if (session) {
    session.fitAddon?.fit?.();
    const cols = session.term.cols || 80;
    const rows = session.term.rows || 24;

    sendWs({
      action: "spawn",
      sessionId,
      repoPath,
      cols,
      rows
    });
  }
}

// Workspace auto-refresh watcher & focus integration
export function initFsWatcher(state) {
  let debounceTimer = null;
  let lastFocusTime = 0;
  let pendingFsRefresh = false;

  const triggerRefresh = (forceExplorer = false, changedPath = null) => {
    if (document.hidden) {
      pendingFsRefresh = true;
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (!state.getActiveWorkspace()) return;
      if (state.activeRightPanel === "explorer") {
        await state.fetchGitStatusData();
        if (forceExplorer) {
          await state.loadExplorer(true);
        } else {
          const treeEl = document.getElementById("rs-files-tree");
          const hasExistingDom = Boolean(treeEl && treeEl.querySelector(".rs-file-item"));
          const isGitInternal = changedPath && (changedPath.includes("/.git/") || changedPath.endsWith("/.git"));

          let canPartialRefresh = isGitInternal && hasExistingDom;
          if (!canPartialRefresh && hasExistingDom && changedPath) {
            try {
              canPartialRefresh = Boolean(treeEl.querySelector(`.rs-file-item[data-path="${CSS.escape(changedPath)}"]`));
            } catch {
              canPartialRefresh = false;
            }
          }

          if (canPartialRefresh && typeof state.refreshGitStatusBadges === "function") {
            state.refreshGitStatusBadges();
          } else {
            await state.loadExplorer(false);
          }
        }
      } else if (state.activeRightPanel === "git") {
        await state.loadGitStatus();
      } else {
        await state.fetchGitStatusData();
      }
    }, 200);
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && pendingFsRefresh) {
      pendingFsRefresh = false;
      triggerRefresh(false);
    }
  });

  tauriListen("workspace-fs-changed", (event) => {
    const changedPath = event?.payload?.path;
    if (changedPath && state.folderCache) {
      state.folderCache.delete(changedPath);
      const parentDir = changedPath.substring(0, changedPath.lastIndexOf("/"));
      if (parentDir) state.folderCache.delete(parentDir);
    }
    triggerRefresh(false, changedPath);
  }).catch((err) => console.error("Failed to listen workspace-fs-changed", err));

  window.addEventListener("focus", () => {
    const now = Date.now();
    if (now - lastFocusTime < 5000) return;
    lastFocusTime = now;
    triggerRefresh(false);
  });
}

export const createFile = (path) => tauriInvoke("create_file", { path });
export const createDir = (path) => tauriInvoke("create_dir", { path });
export const renamePath = (oldPath, newPath) => tauriInvoke("rename_path", { oldPath, newPath });
export const movePath = (srcPath, dstPath) => tauriInvoke("move_path", { srcPath, dstPath });
export const copyPath = (srcPath, dstPath) => tauriInvoke("copy_path", { srcPath, dstPath });
export const deletePath = (path) => tauriInvoke("delete_path", { path });
export const revealInFinder = (path) => tauriInvoke("reveal_in_finder", { path });
export const saveFileContent = (path, content) => tauriInvoke("save_file_content", { path, content });
export const getFileContent = (path) => tauriInvoke("get_file_content", { path });
export const searchInFiles = (params) => tauriInvoke("search_in_files", {
  rootPath: params.rootPath || params.root_path,
  query: params.query,
  caseSensitive: params.caseSensitive ?? params.case_sensitive ?? false,
  matchWholeWord: params.matchWholeWord ?? params.match_whole_word ?? false,
  useRegex: params.useRegex ?? params.use_regex ?? false,
  includePattern: params.includePattern ?? params.include_pattern ?? null,
  maxResults: params.maxResults ?? params.max_results ?? 2000
});
export const listWorkspaceFiles = (rootPath, maxFiles = 10000) =>
  tauriInvoke("list_workspace_files", { rootPath, maxFiles });


