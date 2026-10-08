/**
 * Web ADE Terminal - Vanilla Client
 */

// Terminal Theme Configuration
const TERM_THEME = {
  background: "#050608",
  foreground: "#f3f4f6",
  cursor: "#10b981",
  cursorAccent: "#050608",
  selectionBackground: "#3f3f4680",
  black: "#18181b",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#f4f4f5",
  brightBlack: "#71717a",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#ffffff"
};

class StateManager {
  constructor() {
    this.workspaces = [];
    this.activeWorkspaceId = null;
    this.tabs = [];
    this.activeTabId = null;
    this.activeTabByWorkspace = {};
    this.connectionStatus = "connecting";
    this.isSidebarOpen = true;
    this.isManualAdding = false;
    this.editingWorkspaceId = null;

    this.ws = null;
    this.reconnectTimer = null;
    this.intentionalClose = false;

    // session id -> { term, fitAddon, container, resizeObserver }
    this.terminalSessions = new Map();
  }

  // WebSocket Management
  initWebSocket() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws`;

    this.setConnectionStatus("connecting");
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.setConnectionStatus("connected");
        // Re-spawn or reconnect all running tabs
        this.tabs.forEach((tab) => {
          if (tab.repoPath) {
            this.spawnBackendShell(tab.id, tab.repoPath);
          }
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleBackendMessage(msg);
        } catch (e) {
          console.error("WS parse error", e);
        }
      };

      this.ws.onclose = () => {
        this.setConnectionStatus("offline");
        this.tabs.forEach((t) => {
          t.running = false;
          t.pid = null;
        });
        this.renderTabs();
        this.renderStatusBadge();
        this.scheduleWsReconnect();
      };

      this.ws.onerror = () => {
        this.setConnectionStatus("offline");
      };
    } catch {
      this.setConnectionStatus("offline");
      this.scheduleWsReconnect();
    }
  }

  scheduleWsReconnect() {
    if (this.intentionalClose) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.initWebSocket();
    }, 2000);
  }

  sendWs(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  setConnectionStatus(status) {
    this.connectionStatus = status;
    this.renderConnectionStatus();
  }

  renderConnectionStatus() {
    const el = document.getElementById("connection-status");
    if (!el) return;
    el.className = `status-badge ${this.connectionStatus}`;
    const dot = `<span class="dot"></span>`;
    const label = this.connectionStatus;
    el.innerHTML = `${dot}<span>${label}</span>`;
  }

  handleBackendMessage(msg) {
    const session = this.terminalSessions.get(msg.sessionId);
    const tab = this.tabs.find((t) => t.id === msg.sessionId);

    if (msg.type === "output") {
      session?.term?.write(msg.text);
    } else if (msg.type === "spawned") {
      if (tab) {
        tab.running = true;
        tab.pid = msg.pid;
      }
      this.renderTabs();
      this.renderStatusBadge();
    } else if (msg.type === "exit") {
      if (tab) {
        tab.running = false;
        tab.pid = null;
      }
      session?.term?.writeln(`\r\n\x1b[90m[Process completed with exit code ${msg.code}]\x1b[0m`);
      this.renderTabs();
      this.renderStatusBadge();
    } else if (msg.type === "error") {
      session?.term?.writeln(`\r\n\x1b[31m[Error: ${msg.error}]\x1b[0m`);
    } else if (msg.type === "stopped") {
      if (tab) {
        tab.running = false;
        tab.pid = null;
      }
      this.renderTabs();
      this.renderStatusBadge();
    }
  }

  // Workspaces API
  async loadWorkspaces() {
    try {
      const res = await fetch("/api/workspaces");
      if (res.ok) {
        this.workspaces = await res.json();
        this.renderWorkspaces();
        if (this.workspaces.length > 0 && !this.activeWorkspaceId) {
          this.selectWorkspace(this.workspaces[0]);
        }
      }
    } catch (err) {
      console.error("Failed to load workspaces", err);
    }
  }

  async pickFolder() {
    try {
      const btn = document.getElementById("add-ws-btn");
      if (btn) btn.disabled = true;
      const res = await fetch("/api/pick-folder", { method: "POST" });
      const data = await res.json();
      if (data && !data.canceled && data.id) {
        await this.loadWorkspaces();
        this.selectWorkspace(data);
      }
    } catch (err) {
      console.error("Pick folder error", err);
    } finally {
      const btn = document.getElementById("add-ws-btn");
      if (btn) btn.disabled = false;
    }
  }

  async addWorkspace(name, path) {
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, path })
      });
      if (res.ok) {
        const created = await res.json();
        this.isManualAdding = false;
        await this.loadWorkspaces();
        this.selectWorkspace(created);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to add workspace");
      }
    } catch {
      alert("Error adding workspace");
    }
  }

  async updateWorkspace(id, name, path) {
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, path })
      });
      if (res.ok) {
        this.editingWorkspaceId = null;
        await this.loadWorkspaces();
      }
    } catch {
      alert("Error updating workspace");
    }
  }

  async deleteWorkspace(id) {
    if (!confirm("Remove workspace from list?")) return;
    try {
      const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
      if (res.ok) {
        const toClose = this.tabs.filter((t) => t.workspaceId === id);
        for (const t of toClose) {
          this.closeTab(t.id);
        }
        await this.loadWorkspaces();
        if (this.activeWorkspaceId === id) {
          if (this.workspaces.length > 0) {
            this.selectWorkspace(this.workspaces[0]);
          } else {
            this.activeWorkspaceId = null;
            this.renderTabs();
            this.renderCwd();
          }
        }
      }
    } catch {
      alert("Error removing workspace");
    }
  }

  selectWorkspace(ws) {
    this.activeWorkspaceId = ws.id;
    const rememberedTabId = this.activeTabByWorkspace[ws.id];
    const wsTabs = this.tabs.filter((t) => t.workspaceId === ws.id);

    if (rememberedTabId && wsTabs.some((t) => t.id === rememberedTabId)) {
      this.switchTab(rememberedTabId);
    } else if (wsTabs.length > 0) {
      this.switchTab(wsTabs[0].id);
    } else {
      this.createTab(ws);
    }
    this.renderWorkspaces();
    this.renderTabs();
    this.renderCwd();
  }

  renderWorkspaces() {
    const listEl = document.getElementById("workspace-list");
    const countEl = document.getElementById("ws-count-badge");
    if (countEl) countEl.textContent = `${this.workspaces.length} repos`;
    if (!listEl) return;

    listEl.innerHTML = "";

    // If manual add panel is active
    if (this.isManualAdding) {
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
        this.isManualAdding = false;
        this.renderWorkspaces();
      };
      form.querySelector("#submit-manual-add").onclick = () => {
        const n = document.getElementById("input-ws-name").value.trim();
        const p = document.getElementById("input-ws-path").value.trim();
        if (n && p) this.addWorkspace(n, p);
      };
    }

    if (this.workspaces.length === 0 && !this.isManualAdding) {
      const empty = document.createElement("div");
      empty.className = "terminal-empty";
      empty.style.position = "static";
      empty.style.padding = "24px 8px";
      empty.style.textAlign = "center";
      empty.innerHTML = `No workspaces yet.<br><button id="empty-add-btn" class="btn btn-xs btn-primary" style="margin-top:8px;">Add Repository</button>`;
      listEl.appendChild(empty);
      empty.querySelector("#empty-add-btn").onclick = () => this.pickFolder();
      return;
    }

    this.workspaces.forEach((ws) => {
      if (this.editingWorkspaceId === ws.id) {
        const editForm = document.createElement("div");
        editForm.className = "form-panel";
        editForm.innerHTML = `
          <input id="edit-ws-name-${ws.id}" class="form-input" value="${this.escapeHtml(ws.name)}" />
          <input id="edit-ws-path-${ws.id}" class="form-input" value="${this.escapeHtml(ws.path)}" />
          <div class="form-actions">
            <button id="cancel-edit-${ws.id}" class="btn btn-xs">Cancel</button>
            <button id="save-edit-${ws.id}" class="btn btn-xs btn-primary">Save</button>
          </div>
        `;
        listEl.appendChild(editForm);
        editForm.querySelector(`#cancel-edit-${ws.id}`).onclick = () => {
          this.editingWorkspaceId = null;
          this.renderWorkspaces();
        };
        editForm.querySelector(`#save-edit-${ws.id}`).onclick = () => {
          const n = document.getElementById(`edit-ws-name-${ws.id}`).value.trim();
          const p = document.getElementById(`edit-ws-path-${ws.id}`).value.trim();
          if (n && p) this.updateWorkspace(ws.id, n, p);
        };
        return;
      }

      const item = document.createElement("div");
      const isActive = ws.id === this.activeWorkspaceId;
      item.className = `ws-item ${isActive ? "active" : ""}`;
      item.innerHTML = `
        <div class="ws-info">
          <div class="ws-title">${this.escapeHtml(ws.name)}</div>
          <div class="ws-path" title="${this.escapeHtml(ws.path)}">${this.escapeHtml(ws.path)}</div>
        </div>
        <div class="ws-actions">
          <button class="btn btn-xs btn-icon edit-btn" title="Edit workspace">&#9998;</button>
          <button class="btn btn-xs btn-icon btn-danger del-btn" title="Remove workspace">&times;</button>
        </div>
      `;

      item.onclick = (e) => {
        if (e.target.closest("button")) return;
        this.selectWorkspace(ws);
      };

      item.querySelector(".edit-btn").onclick = (e) => {
        e.stopPropagation();
        this.editingWorkspaceId = ws.id;
        this.renderWorkspaces();
      };

      item.querySelector(".del-btn").onclick = (e) => {
        e.stopPropagation();
        this.deleteWorkspace(ws.id);
      };

      listEl.appendChild(item);
    });
  }

  // Terminal & Tab Management
  createTab(workspace) {
    const targetWs = workspace || this.workspaces.find((w) => w.id === this.activeWorkspaceId) || this.workspaces[0];
    const repoPath = targetWs ? targetWs.path : "";
    const wsId = targetWs ? targetWs.id : "";
    const wsTabsCount = this.tabs.filter((t) => t.workspaceId === wsId).length;
    const title = targetWs
      ? wsTabsCount === 0
        ? targetWs.name
        : `Term ${wsTabsCount + 1}`
      : `Term ${this.tabs.length + 1}`;

    const id = "tab_" + Math.random().toString(36).substring(2, 9);
    const tab = {
      id,
      workspaceId: wsId,
      title,
      repoPath,
      running: false,
      pid: null
    };

    this.tabs.push(tab);
    if (wsId) {
      this.activeTabByWorkspace[wsId] = id;
    }

    // Mount xterm container
    this.mountTerminalInstance(tab);
    this.switchTab(id);

    // Initial shell spawn
    if (repoPath) {
      this.spawnBackendShell(tab.id, repoPath);
    }
  }

  mountTerminalInstance(tab) {
    const host = document.getElementById("terminal-host");
    const container = document.createElement("div");
    container.id = `term-container-${tab.id}`;
    container.className = "terminal-instance hidden";
    host.appendChild(container);

    const term = new Terminal({
      theme: TERM_THEME,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      convertEol: true,
      allowTransparency: true
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Keystroke forwarding
    term.onData((data) => {
      this.sendWs({
        action: "input",
        sessionId: tab.id,
        data
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      if (this.activeTabId === tab.id) {
        this.fitTerminal(tab.id);
      }
    });
    resizeObserver.observe(container);

    this.terminalSessions.set(tab.id, {
      term,
      fitAddon,
      container,
      resizeObserver
    });
  }

  fitTerminal(sessionId) {
    const session = this.terminalSessions.get(sessionId);
    if (!session) return;
    try {
      session.fitAddon.fit();
      const cols = session.term.cols;
      const rows = session.term.rows;
      if (cols > 0 && rows > 0) {
        this.sendWs({
          action: "resize",
          sessionId,
          cols,
          rows
        });
      }
    } catch {}
  }

  spawnBackendShell(sessionId, repoPath) {
    if (!repoPath) return;
    const session = this.terminalSessions.get(sessionId);
    if (session) {
      session.fitAddon.fit();
      const cols = session.term.cols || 80;
      const rows = session.term.rows || 24;

      this.sendWs({
        action: "spawn",
        sessionId,
        repoPath,
        cols,
        rows
      });
    }
  }

  switchTab(tabId) {
    this.activeTabId = tabId;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab && tab.workspaceId) {
      this.activeWorkspaceId = tab.workspaceId;
      this.activeTabByWorkspace[tab.workspaceId] = tabId;
    }

    this.terminalSessions.forEach((session, sId) => {
      if (sId === tabId) {
        session.container.classList.remove("hidden");
        requestAnimationFrame(() => {
          this.fitTerminal(sId);
          session.term.focus();
        });
      } else {
        session.container.classList.add("hidden");
      }
    });

    this.renderWorkspaces();
    this.renderTabs();
    this.renderCwd();
    this.renderStatusBadge();
  }

  closeTab(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const wsId = tab.workspaceId;
    const wsTabs = this.tabs.filter((t) => t.workspaceId === wsId);
    const idxInWs = wsTabs.findIndex((t) => t.id === tabId);

    // Teardown xterm & backend session
    this.sendWs({ action: "kill", sessionId: tabId });
    const session = this.terminalSessions.get(tabId);
    if (session) {
      session.resizeObserver.disconnect();
      session.term.dispose();
      session.container.remove();
      this.terminalSessions.delete(tabId);
    }

    this.tabs = this.tabs.filter((t) => t.id !== tabId);
    const remainingWsTabs = this.tabs.filter((t) => t.workspaceId === wsId);

    if (this.activeTabId === tabId) {
      if (remainingWsTabs.length > 0) {
        const nextIdx = Math.min(idxInWs, remainingWsTabs.length - 1);
        this.switchTab(remainingWsTabs[nextIdx].id);
      } else {
        const targetWs = this.workspaces.find((w) => w.id === wsId);
        if (targetWs) {
          this.createTab(targetWs);
        } else {
          this.activeTabId = null;
          delete this.activeTabByWorkspace[wsId];
          this.renderTabs();
          this.renderCwd();
          this.renderStatusBadge();
        }
      }
    } else if (this.activeTabByWorkspace[wsId] === tabId) {
      if (remainingWsTabs.length > 0) {
        this.activeTabByWorkspace[wsId] = remainingWsTabs[0].id;
      } else {
        delete this.activeTabByWorkspace[wsId];
      }
      this.renderTabs();
    }
  }

  restartActiveTab() {
    if (!this.activeTabId) return;
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    const session = this.terminalSessions.get(this.activeTabId);
    if (tab && session) {
      session.term.reset();
      session.term.writeln("\x1b[33m\r\n[Reconnecting shell session...]\x1b[0m\r\n");
      this.spawnBackendShell(tab.id, tab.repoPath);
    }
  }

  clearActiveTab() {
    if (!this.activeTabId) return;
    const session = this.terminalSessions.get(this.activeTabId);
    session?.term?.clear();
  }

  sendInputToActive(text) {
    if (!this.activeTabId) return;
    this.sendWs({
      action: "input",
      sessionId: this.activeTabId,
      data: text
    });
    const session = this.terminalSessions.get(this.activeTabId);
    session?.term?.focus();
  }

  renderTabs() {
    const container = document.getElementById("tabs-container");
    const emptyNotice = document.getElementById("terminal-empty-notice");
    if (!container) return;

    container.innerHTML = "";
    const currentTabs = this.activeWorkspaceId
      ? this.tabs.filter((t) => t.workspaceId === this.activeWorkspaceId)
      : this.tabs;

    if (emptyNotice) {
      emptyNotice.style.display = this.tabs.length === 0 ? "flex" : "none";
    }

    currentTabs.forEach((tab) => {
      const pill = document.createElement("div");
      const isActive = tab.id === this.activeTabId;
      pill.className = `tab-pill ${isActive ? "active" : ""}`;
      pill.innerHTML = `
        <span class="tab-dot ${tab.running ? "live" : ""}"></span>
        <span class="tab-title">${this.escapeHtml(tab.title)}</span>
        <button class="tab-close" title="Close tab">&times;</button>
      `;

      pill.onclick = () => this.switchTab(tab.id);
      pill.querySelector(".tab-close").onclick = (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      };

      container.appendChild(pill);
    });
  }

  renderStatusBadge() {
    const badge = document.getElementById("session-status-badge");
    if (!badge) return;
    const tab = this.tabs.find((t) => t.id === this.activeTabId);

    if (tab && tab.running) {
      badge.textContent = tab.pid ? `PID ${tab.pid}` : "LIVE";
      badge.style.background = "rgba(16, 185, 129, 0.15)";
      badge.style.borderColor = "rgba(16, 185, 129, 0.4)";
      badge.style.color = "#34d399";
    } else {
      badge.textContent = "OFFLINE";
      badge.style.background = "var(--bg-subtle)";
      badge.style.borderColor = "var(--border-subtle)";
      badge.style.color = "var(--text-dim)";
    }
  }

  renderCwd() {
    const label = document.getElementById("cwd-path");
    if (!label) return;
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    const ws = this.workspaces.find((w) => w.id === this.activeWorkspaceId);
    const p = tab?.repoPath || ws?.path || "No workspace";
    label.textContent = p;
    label.title = p;
  }

  escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, (tag) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[tag] || tag));
  }
}

// Global App Initialization
window.addEventListener("DOMContentLoaded", () => {
  const app = new StateManager();

  // Sidebar toggle
  document.getElementById("toggle-sidebar-btn")?.addEventListener("click", () => {
    const sb = document.getElementById("sidebar");
    if (!sb) return;
    sb.classList.toggle("collapsed");
    setTimeout(() => {
      if (app.activeTabId) app.fitTerminal(app.activeTabId);
    }, 160);
  });

  // Folder Pick button
  document.getElementById("add-ws-btn")?.addEventListener("click", () => {
    app.pickFolder();
  });

  // Footer manual path toggle
  document.getElementById("toggle-manual-add")?.addEventListener("click", () => {
    app.isManualAdding = !app.isManualAdding;
    app.renderWorkspaces();
  });

  // New Tab
  document.getElementById("new-tab-btn")?.addEventListener("click", () => {
    app.createTab();
  });

  // Restart & Clear
  document.getElementById("restart-term-btn")?.addEventListener("click", () => {
    app.restartActiveTab();
  });
  document.getElementById("clear-term-btn")?.addEventListener("click", () => {
    app.clearActiveTab();
  });

  // Prompt Run Form
  document.getElementById("prompt-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("prompt-input");
    const val = input.value.trim();
    if (val) {
      app.sendInputToActive(val + "\n");
      input.value = "";
    }
  });

  // Launch Pi button
  document.getElementById("launch-pi-btn")?.addEventListener("click", () => {
    app.sendInputToActive("pi\n");
  });

  // Global window resize
  window.addEventListener("resize", () => {
    if (app.activeTabId) {
      app.fitTerminal(app.activeTabId);
    }
  });

  // Start WS and fetch workspaces
  app.initWebSocket();
  app.loadWorkspaces();
});
