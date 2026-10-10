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

// Native Tauri PTY Communication
export async function initPty(state) {
  try {
    state.unlistenPty = await tauriListen("pty-message", (event) => {
      handleBackendMessage(state, event.payload);
    });
  } catch (err) {
    console.error("Failed to setup pty-message listener", err);
  }
}

export async function sendWs(data) {
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
    session?.term?.write(msg.text);
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
    session?.term?.writeln(`\r\n\x1b[90m[Process completed with exit code ${msg.code}]\x1b[0m`);
    state.renderTabs();
    state.renderStatusBadge();
  } else if (msg.type === "error") {
    session?.term?.writeln(`\r\n\x1b[31m[Error: ${msg.error}]\x1b[0m`);
  } else if (msg.type === "stopped") {
    if (tab) {
      tab.running = false;
      tab.pid = null;
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
