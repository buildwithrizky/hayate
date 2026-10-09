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
    // tab id -> container element for non-terminal views (browser, markdown, editor)
    this.viewContainers = new Map();

    // Right Sidebar (Orca style)
    this.isRightSidebarOpen = true;
    this.activeRightPanel = "explorer"; // 'explorer' | 'git'
    this.fileExplorerPath = null;
    this.gitStatusData = null;
    this.gitignoreRules = [];
    this.openFolders = new Set();
    this.folderCache = new Map();
    this.gitSectionsCollapsed = new Set();
    this.gitTreeCollapsed = new Set(); // Stores collapsed tree folder keys

    // AI Assistant state
    this.isAiPanelOpen = true;
    this.aiMessages = [];
    this.aiAttachments = []; // Array of { name, dataUrl, mime }
    this.aiAbortController = null;
    this.isAiStreaming = false;
  }

  // Language helper for PrismJS syntax highlighting
  getPrismLanguage(filePath) {
    if (!filePath) return "javascript";
    const ext = filePath.split(".").pop().toLowerCase();
    const map = {
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      ts: "typescript",
      mts: "typescript",
      cts: "typescript",
      jsx: "jsx",
      tsx: "tsx",
      json: "json",
      json5: "json",
      html: "html",
      htm: "html",
      svg: "html",
      xml: "html",
      css: "css",
      py: "python",
      sh: "bash",
      bash: "bash",
      zsh: "bash",
      md: "markdown",
      markdown: "markdown",
      yml: "yaml",
      yaml: "yaml",
      sql: "sql",
      diff: "diff",
      patch: "diff",
      rs: "rust",
      go: "go"
    };
    return map[ext] || "plain";
  }

  highlightCode(code, lang) {
    if (typeof window !== "undefined" && window.Prism) {
      const grammar = window.Prism.languages[lang] || window.Prism.languages.javascript || window.Prism.languages.plain;
      if (grammar) {
        return window.Prism.highlight(code, grammar, lang);
      }
    }
    return this.escapeHtml(code);
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
    this.fileExplorerPath = ws.path;
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
    this.reloadRightSidebar();
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

  // Workbench Tab Management: Terminal, Browser, Markdown, Editor
  createTab(workspace, type = "terminal", initOptions = {}) {
    const targetWs = workspace || this.workspaces.find((w) => w.id === this.activeWorkspaceId) || this.workspaces[0];
    const repoPath = targetWs ? targetWs.path : "";
    const wsId = targetWs ? targetWs.id : "";
    const wsTabsCount = this.tabs.filter((t) => t.workspaceId === wsId).length;

    let defaultTitle = `Term ${wsTabsCount + 1}`;
    if (type === "terminal") {
      defaultTitle = targetWs ? (wsTabsCount === 0 ? targetWs.name : `Term ${wsTabsCount + 1}`) : `Term ${this.tabs.length + 1}`;
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

    this.tabs.push(tab);
    if (wsId) {
      this.activeTabByWorkspace[wsId] = id;
    }

    if (tab.type === "terminal") {
      this.mountTerminalInstance(tab);
      this.switchTab(id);
      if (repoPath) {
        this.spawnBackendShell(tab.id, repoPath);
      }
    } else if (tab.type === "browser") {
      this.mountBrowserInstance(tab);
      this.switchTab(id);
    } else if (tab.type === "markdown") {
      this.mountMarkdownInstance(tab);
      this.switchTab(id);
      if (tab.filePath && !initOptions.content) {
        this.loadFileForTab(tab);
      }
    } else if (tab.type === "editor") {
      this.mountEditorInstance(tab);
      this.switchTab(id);
      if (tab.filePath && !initOptions.content) {
        this.loadFileForTab(tab);
      }
    } else if (tab.type === "diff") {
      this.mountDiffInstance(tab);
      this.switchTab(id);
    }
    return tab;
  }

  mountTerminalInstance(tab) {
    const host = document.getElementById("terminal-host");
    const container = document.createElement("div");
    container.id = `term-container-${tab.id}`;
    container.className = "terminal-instance hidden";
    host.appendChild(container);

    const TerminalClass = window.Terminal;
    if (!TerminalClass) {
      console.error("Terminal not loaded yet");
      return;
    }

    const term = new TerminalClass({
      theme: TERM_THEME,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      convertEol: true,
      allowTransparency: true
    });

    const FitAddonClass = window.FitAddon?.FitAddon || window.FitAddon;
    const fitAddon = FitAddonClass ? new FitAddonClass() : null;
    if (fitAddon) {
      term.loadAddon(fitAddon);
    }
    term.open(container);

    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        this.sendWs({
          action: "input",
          sessionId: tab.id,
          data: "\x1b[13;2u"
        });
        return false;
      }

      if (e.type === "keydown" && e.key === "Backspace" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        if (tab.lastAction === "paste_token" && tab.recentTokens && tab.recentTokens.length > 0) {
          const lastToken = tab.recentTokens.pop();
          tab.lastAction = null;
          this.sendWs({
            action: "input",
            sessionId: tab.id,
            data: "\x7f".repeat(lastToken.token.length + 1)
          });
          e.preventDefault();
          return false;
        }
      }
      return true;
    });

    // Keystroke forwarding
    term.onData((data) => {
      tab.lastAction = null;
      this.sendWs({
        action: "input",
        sessionId: tab.id,
        data
      });
    });

    // Helper: show/hide/click terminal image popover
    const showImagePopover = (event, text) => {
      let popover = document.getElementById("terminal-image-popover");
      if (!popover) {
        popover = document.createElement("div");
        popover.id = "terminal-image-popover";
        popover.className = "terminal-image-popover";
        document.body.appendChild(popover);
      }

      let src = "";
      let caption = text;
      const matchedToken = tab.recentTokens?.find(t => t.token === text);

      if (matchedToken) {
        src = matchedToken.previewUrl || `/api/image-preview?path=${encodeURIComponent(matchedToken.path || "")}`;
      } else if (text.startsWith("/api/upload-image") || text.startsWith("/api/image-preview")) {
        src = text;
      } else if (text.startsWith("/")) {
        src = `/api/image-preview?path=${encodeURIComponent(text)}`;
      } else {
        src = `/api/image-preview?path=${encodeURIComponent(text)}`;
      }

      popover.innerHTML = `
        <img src="${this.escapeHtml(src)}" alt="${this.escapeHtml(caption)}" />
        <div class="popover-caption">${this.escapeHtml(caption)}</div>
      `;
      popover.style.display = "block";

      const popoverWidth = 240;
      const popoverHeight = 190;
      let left = (event.clientX || 0) + 12;
      let top = (event.clientY || 0) + 12;

      if (left + popoverWidth > window.innerWidth) {
        left = Math.max(8, (event.clientX || 0) - popoverWidth - 12);
      }
      if (top + popoverHeight > window.innerHeight) {
        top = Math.max(8, (event.clientY || 0) - popoverHeight - 12);
      }

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };

    const hideImagePopover = () => {
      const popover = document.getElementById("terminal-image-popover");
      if (popover) {
        popover.style.display = "none";
      }
    };

    const activateImagePopover = (event, text) => {
      const matchedToken = tab.recentTokens?.find(t => t.token === text);
      let targetUrl = "";
      if (matchedToken) {
        targetUrl = matchedToken.previewUrl || `/api/image-preview?path=${encodeURIComponent(matchedToken.path || "")}`;
      } else if (text.startsWith("/api/")) {
        targetUrl = text;
      } else {
        targetUrl = `/api/image-preview?path=${encodeURIComponent(text)}`;
      }
      window.open(targetUrl, "_blank");
    };

    // Hover Thumbnail Preview (Link Provider)
    if (typeof term.registerLinkProvider === "function") {
      const IMAGE_REGEX_LIST = [
        /\[image\d+\.(?:png|jpe?g|webp|gif|svg)\]/gi,
        /\/api\/upload-image|\S+\.(?:png|jpe?g|webp|gif)/gi
      ];

      term.registerLinkProvider({
        provideLinks: (y, callback) => {
          const line = term.buffer.active.getLine(y - 1);
          if (!line) {
            callback(undefined);
            return;
          }

          const lineText = line.translateToString(true);
          const links = [];
          const matchedSpans = [];

          for (const regex of IMAGE_REGEX_LIST) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(lineText)) !== null) {
              const text = match[0];
              const startX = match.index + 1;
              const endX = match.index + text.length;

              const overlaps = matchedSpans.some(span => !(endX < span.startX || startX > span.endX));
              if (overlaps) continue;

              matchedSpans.push({ startX, endX });
              links.push({
                text,
                range: {
                  start: { x: startX, y },
                  end: { x: endX, y }
                },
                hover: (e, matchedText) => showImagePopover(e, matchedText),
                leave: () => hideImagePopover(),
                activate: (e, matchedText) => activateImagePopover(e, matchedText)
              });
            }
          }

          callback(links);
        }
      });
    }

    // Image paste forwarding
    const handlePaste = async (e) => {
      let file = null;
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.type && item.type.startsWith("image/")) {
            file = item.getAsFile();
            break;
          }
        }
      }

      if (!file && e.clipboardData?.files) {
        for (const f of e.clipboardData.files) {
          if ((f.type && f.type.startsWith("image/")) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name)) {
            file = f;
            break;
          }
        }
      }

      if (!file) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`/api/upload-image?sessionId=${encodeURIComponent(tab.id)}`, {
          method: "POST",
          body: formData
        });

        if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
        const data = await res.json();
        const token = data.token || "[image.png]";
        const previewUrl = data.previewUrl || `/api/image-preview?path=${encodeURIComponent(data.path || "")}`;

        tab.recentTokens = tab.recentTokens || [];
        tab.recentTokens.push({
          token,
          previewUrl,
          path: data.path || ""
        });
        tab.lastAction = "paste_token";

        this.sendWs({
          action: "input",
          sessionId: tab.id,
          data: token + " "
        });
        console.info("[Terminal Paste] Image uploaded:", data.path || token);
      } catch (err) {
        console.error("[Terminal Paste] Failed to upload image:", err);
      }
    };

    container.addEventListener("paste", handlePaste, { capture: true });
    if (term.textarea) {
      term.textarea.addEventListener("paste", handlePaste, { capture: true });
    }
    const windowPasteHandler = (e) => {
      if (this.activeTabId !== tab.id) return;
      const activeEl = document.activeElement;
      const isTargetInside = container.contains(e.target);
      const isFocusInside = activeEl && container.contains(activeEl);
      if (!isTargetInside && !isFocusInside) return;
      handlePaste(e);
    };
    window.addEventListener("paste", windowPasteHandler, { capture: true });

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
      resizeObserver,
      windowPasteHandler
    });
  }

  mountBrowserInstance(tab) {
    const host = document.getElementById("terminal-host");
    const container = document.createElement("div");
    container.id = `view-container-${tab.id}`;
    container.className = "terminal-instance wb-view hidden";
    container.innerHTML = `
      <div class="wb-browser-bar">
        <button class="btn btn-icon btn-xs btn-back" title="Back">&larr;</button>
        <button class="btn btn-icon btn-xs btn-forward" title="Forward">&rarr;</button>
        <button class="btn btn-icon btn-xs btn-reload" title="Reload">&#x21bb;</button>
        <input class="wb-browser-url" type="text" value="${this.escapeHtml(tab.url)}" placeholder="http://localhost:3000" />
        <button class="btn btn-xs btn-primary btn-go">Go</button>
        <button class="btn btn-icon btn-xs btn-external" title="Open in New Tab">&#x2197;</button>
      </div>
      <iframe class="wb-browser-frame" src="${this.escapeHtml(tab.url)}" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>
    `;
    host.appendChild(container);

    const iframe = container.querySelector(".wb-browser-frame");
    const urlInput = container.querySelector(".wb-browser-url");
    const btnBack = container.querySelector(".btn-back");
    const btnForward = container.querySelector(".btn-forward");
    const btnReload = container.querySelector(".btn-reload");
    const btnGo = container.querySelector(".btn-go");
    const btnExternal = container.querySelector(".btn-external");

    const navigateTo = (newUrl) => {
      let target = newUrl.trim();
      if (!target) return;
      if (!/^https?:\/\//i.test(target)) {
        target = "http://" + target;
      }
      tab.url = target;
      urlInput.value = target;
      try {
        const u = new URL(target);
        tab.title = u.host || target;
      } catch {
        tab.title = target;
      }
      iframe.src = target;
      this.renderTabs();
    };

    btnGo.onclick = () => navigateTo(urlInput.value);
    urlInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        navigateTo(urlInput.value);
      }
    };
    btnReload.onclick = () => {
      iframe.src = tab.url;
    };
    btnBack.onclick = () => {
      try { iframe.contentWindow?.history?.back(); } catch {}
    };
    btnForward.onclick = () => {
      try { iframe.contentWindow?.history?.forward(); } catch {}
    };
    btnExternal.onclick = () => {
      if (tab.url) window.open(tab.url, "_blank", "noopener,noreferrer");
    };

    this.viewContainers.set(tab.id, container);
  }

  mountMarkdownInstance(tab) {
    const host = document.getElementById("terminal-host");
    const container = document.createElement("div");
    container.id = `view-container-${tab.id}`;
    container.className = "terminal-instance wb-view hidden";
    container.innerHTML = `
      <div class="wb-markdown-bar">
        <div class="wb-bar-meta">
          <span class="tab-type-tag is-markdown">M&darr;</span>
          <span class="wb-bar-path" title="${this.escapeHtml(tab.filePath || 'Scratchpad')}">${this.escapeHtml(tab.filePath ? tab.filePath.split('/').pop() : 'Scratchpad.md')}</span>
          <span class="wb-save-status ${tab.isDirty ? 'unsaved' : ''}">${tab.isDirty ? '● Unsaved' : ''}</span>
        </div>
        <div class="wb-bar-actions">
          <button class="btn btn-xs btn-mode-toggle">${tab.isEditMode ? 'View Markdown' : 'Edit Source'}</button>
          <button class="btn btn-xs btn-primary btn-save" title="Save file (Ctrl+S)">Save</button>
        </div>
      </div>
      <div class="wb-markdown-content wb-md-preview" style="${tab.isEditMode ? 'display:none;' : ''}">
        ${this.renderMarkdownHtml(tab.content || '*Empty markdown document*')}
      </div>
      <div class="wb-editor-body" style="${tab.isEditMode ? 'display:flex;' : 'display:none;'}">
        <div class="wb-line-numbers">1</div>
        <textarea class="wb-textarea" spellcheck="false" placeholder="Write markdown here...">${this.escapeHtml(tab.content || '')}</textarea>
      </div>
    `;
    host.appendChild(container);

    const previewEl = container.querySelector(".wb-markdown-content");
    const editorBody = container.querySelector(".wb-editor-body");
    const textarea = container.querySelector(".wb-textarea");
    const lineNums = container.querySelector(".wb-line-numbers");
    const toggleBtn = container.querySelector(".btn-mode-toggle");
    const saveBtn = container.querySelector(".btn-save");
    const statusEl = container.querySelector(".wb-save-status");

    const updateLines = () => {
      const count = (textarea.value.split("\n").length) || 1;
      let nums = "";
      for (let i = 1; i <= count; i++) nums += i + "\n";
      lineNums.textContent = nums;
    };
    updateLines();

    textarea.addEventListener("input", () => {
      tab.content = textarea.value;
      tab.isDirty = tab.content !== tab.savedContent;
      statusEl.textContent = tab.isDirty ? "● Unsaved" : "";
      statusEl.className = `wb-save-status ${tab.isDirty ? 'unsaved' : ''}`;
      updateLines();
      this.renderTabs();
    });

    textarea.addEventListener("scroll", () => {
      lineNums.scrollTop = textarea.scrollTop;
    });

    textarea.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        this.saveTabContent(tab);
      }
    });

    toggleBtn.onclick = () => {
      tab.isEditMode = !tab.isEditMode;
      if (tab.isEditMode) {
        toggleBtn.textContent = "View Markdown";
        previewEl.style.display = "none";
        editorBody.style.display = "flex";
        textarea.value = tab.content;
        updateLines();
        textarea.focus();
      } else {
        toggleBtn.textContent = "Edit Source";
        editorBody.style.display = "none";
        previewEl.style.display = "block";
        previewEl.innerHTML = this.renderMarkdownHtml(tab.content || "*Empty markdown document*");
      }
    };

    saveBtn.onclick = () => this.saveTabContent(tab);

    this.viewContainers.set(tab.id, container);
  }

  mountEditorInstance(tab) {
    const host = document.getElementById("terminal-host");
    const container = document.createElement("div");
    container.id = `view-container-${tab.id}`;
    container.className = "terminal-instance wb-view hidden";
    const lang = this.getPrismLanguage(tab.filePath);
    container.innerHTML = `
      <div class="wb-editor-bar">
        <div class="wb-bar-meta">
          <span class="tab-type-tag is-editor">&lt;/&gt;</span>
          <span class="wb-bar-path" title="${this.escapeHtml(tab.filePath || 'Scratch')}">${this.escapeHtml(tab.filePath ? tab.filePath.split('/').pop() : 'Scratchpad')}</span>
          <span class="wb-save-status ${tab.isDirty ? 'unsaved' : ''}">${tab.isDirty ? '● Unsaved' : ''}</span>
        </div>
        <div class="wb-bar-actions">
          <button class="btn btn-xs btn-primary btn-save" title="Save file (Ctrl+S / Cmd+S)">Save</button>
          <button class="btn btn-xs btn-close" title="Close this tab">Close</button>
        </div>
      </div>
      <div class="wb-editor-body">
        <div class="wb-line-numbers">1</div>
        <div class="wb-editor-stage">
          <pre class="wb-highlight-layer"><code class="language-${lang}">${this.highlightCode(tab.content || '', lang)}</code></pre>
          <textarea class="wb-textarea" spellcheck="false" placeholder="Type code here...">${this.escapeHtml(tab.content || '')}</textarea>
        </div>
      </div>
    `;
    host.appendChild(container);

    const textarea = container.querySelector(".wb-textarea");
    const highlightCode = container.querySelector(".wb-highlight-layer code");
    const highlightLayer = container.querySelector(".wb-highlight-layer");
    const lineNums = container.querySelector(".wb-line-numbers");
    const saveBtn = container.querySelector(".btn-save");
    const closeBtn = container.querySelector(".btn-close");
    const statusEl = container.querySelector(".wb-save-status");

    const updateLines = () => {
      const count = (textarea.value.split("\n").length) || 1;
      let nums = "";
      for (let i = 1; i <= count; i++) nums += i + "\n";
      lineNums.textContent = nums;
    };

    const updateHighlight = () => {
      const currentLang = this.getPrismLanguage(tab.filePath);
      highlightCode.className = `language-${currentLang}`;
      const codeVal = textarea.value;
      // Preserve trailing newline space so cursor matches
      const paddedVal = codeVal.endsWith("\n") ? codeVal + " " : codeVal;
      highlightCode.innerHTML = this.highlightCode(paddedVal, currentLang);
    };

    updateLines();
    updateHighlight();

    const syncScroll = () => {
      lineNums.scrollTop = textarea.scrollTop;
      highlightLayer.scrollTop = textarea.scrollTop;
      highlightLayer.scrollLeft = textarea.scrollLeft;
    };

    textarea.addEventListener("scroll", syncScroll);

    textarea.addEventListener("input", () => {
      tab.content = textarea.value;
      tab.isDirty = tab.content !== tab.savedContent;
      statusEl.textContent = tab.isDirty ? "● Unsaved" : "";
      statusEl.className = `wb-save-status ${tab.isDirty ? 'unsaved' : ''}`;
      updateLines();
      updateHighlight();
      syncScroll();
      this.renderTabs();
    });

    // Indentation, auto-indent & save shortcut
    textarea.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        this.saveTabContent(tab);
      } else if (e.key === "Tab") {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + "  " + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        textarea.dispatchEvent(new Event("input"));
      } else if (e.key === "Enter") {
        // Auto-indent: keep leading indentation of previous line
        const pos = textarea.selectionStart;
        const textBefore = textarea.value.substring(0, pos);
        const lastLine = textBefore.split("\n").pop() || "";
        const match = lastLine.match(/^(\s+)/);
        if (match) {
          e.preventDefault();
          const indent = match[1];
          const textAfter = textarea.value.substring(textarea.selectionEnd);
          textarea.value = textBefore + "\n" + indent + textAfter;
          textarea.selectionStart = textarea.selectionEnd = pos + 1 + indent.length;
          textarea.dispatchEvent(new Event("input"));
        }
      }
    });

    saveBtn.onclick = () => this.saveTabContent(tab);
    closeBtn.onclick = () => this.closeTab(tab.id);

    this.viewContainers.set(tab.id, container);
  }

  mountDiffInstance(tab) {
    const host = document.getElementById("terminal-host");
    const container = document.createElement("div");
    container.id = `view-container-${tab.id}`;
    container.className = "terminal-instance wb-view hidden";

    const badgeLabel = tab.commitHash
      ? `Commit ${tab.commitHash.substring(0, 7)}`
      : tab.isStaged
      ? "Staged"
      : tab.gitStatusCode === "U"
      ? "Untracked"
      : "Working Tree";

    const badgeClass = tab.commitHash
      ? "commit"
      : tab.isStaged
      ? "staged"
      : tab.gitStatusCode === "U"
      ? "untracked"
      : "working";

    const isDeleted = tab.gitStatusCode === "D";

    container.innerHTML = `
      <div class="wb-diff-bar">
        <div class="wb-bar-meta">
          <span class="tab-type-tag is-diff">⇄ Diff</span>
          <span class="wb-diff-badge ${badgeClass}">${badgeLabel}</span>
          <span class="wb-bar-path" title="${this.escapeHtml(tab.filePath || tab.diffFile || '')}">${this.escapeHtml(tab.diffFile || tab.filePath || '')}</span>
        </div>
        <div class="wb-bar-actions">
          ${!isDeleted && tab.filePath ? `<button class="btn btn-xs btn-open-editor" title="Open in Editor">Open in Editor</button>` : ''}
          <button class="btn btn-xs btn-close" title="Close this tab">Close</button>
        </div>
      </div>
      <div class="wb-diff-body">
        <div class="wb-diff-clean">Computing diff...</div>
      </div>
    `;
    host.appendChild(container);

    const closeBtn = container.querySelector(".btn-close");
    const openEditorBtn = container.querySelector(".btn-open-editor");
    if (closeBtn) closeBtn.onclick = () => this.closeTab(tab.id);
    if (openEditorBtn) {
      openEditorBtn.onclick = () => {
        if (tab.filePath) this.openFileInWorkbench(tab.filePath);
      };
    }

    this.viewContainers.set(tab.id, container);
    this.loadDiffForTab(tab);
  }

  async loadDiffForTab(tab) {
    const container = this.viewContainers.get(tab.id);
    if (!container) return;
    const diffBody = container.querySelector(".wb-diff-body");
    if (!diffBody) return;

    const repoPath = tab.repoPath;
    const file = tab.diffFile;

    // Untracked new file: render full file content as additions
    if (tab.gitStatusCode === "U") {
      try {
        const res = await fetch(`/api/file-content?path=${encodeURIComponent(tab.filePath)}`);
        const data = await res.json();
        if (!res.ok || data.error) {
          diffBody.innerHTML = `<div class="wb-diff-clean">${this.escapeHtml(data.error || "Failed to load untracked file")}</div>`;
          return;
        }

        const lines = (data.content || "").split("\n");
        let html = `<table class="wb-diff-table"><tbody>`;
        html += `<tr class="wb-diff-row hunk-header"><td class="wb-diff-gutter">...</td><td class="wb-diff-gutter">...</td><td class="wb-diff-sign"></td><td class="wb-diff-text">@@ +1,${lines.length} Untracked File @@</td></tr>`;
        lines.forEach((line, i) => {
          html += `<tr class="wb-diff-row line-add"><td class="wb-diff-gutter"></td><td class="wb-diff-gutter">${i + 1}</td><td class="wb-diff-sign">+</td><td class="wb-diff-text">${this.escapeHtml(line)}</td></tr>`;
        });
        html += `</tbody></table>`;
        diffBody.innerHTML = html;
        return;
      } catch (err) {
        diffBody.innerHTML = `<div class="wb-diff-clean">Error: ${this.escapeHtml(String(err))}</div>`;
        return;
      }
    }

    // Commit diff fetch
    if (tab.commitHash) {
      try {
        const url = `/api/git/diff?path=${encodeURIComponent(repoPath)}&commit=${encodeURIComponent(tab.commitHash)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok || data.error) {
          diffBody.innerHTML = `<div class="wb-diff-clean">${this.escapeHtml(data.error || "Failed to load commit diff")}</div>`;
          return;
        }
        if (!data.diff || !data.diff.trim()) {
          diffBody.innerHTML = `<div class="wb-diff-clean">&#10003; Empty commit or merge commit</div>`;
          return;
        }
        diffBody.innerHTML = this.renderDiffTableHtml(data.diff);
        return;
      } catch (err) {
        diffBody.innerHTML = `<div class="wb-diff-clean">Error: ${this.escapeHtml(String(err))}</div>`;
        return;
      }
    }

    // Git diff fetch
    try {
      const url = `/api/git/diff?path=${encodeURIComponent(repoPath)}&file=${encodeURIComponent(file || "")}&staged=${Boolean(tab.isStaged)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.error) {
        diffBody.innerHTML = `<div class="wb-diff-clean">${this.escapeHtml(data.error || "Failed to load diff")}</div>`;
        return;
      }

      if (!data.diff || !data.diff.trim()) {
        diffBody.innerHTML = `<div class="wb-diff-clean">&#10003; No differences found between versions</div>`;
        return;
      }

      diffBody.innerHTML = this.renderDiffTableHtml(data.diff);
    } catch (err) {
      diffBody.innerHTML = `<div class="wb-diff-clean">Error: ${this.escapeHtml(String(err))}</div>`;
    }
  }

  // Parse unified diff into VS Code style HTML table with line numbers & highlight
  renderDiffTableHtml(rawDiff) {
    const rawLines = rawDiff.split("\n");
    let html = `<table class="wb-diff-table"><tbody>`;
    let oldLine = 0;
    let newLine = 0;

    for (const line of rawLines) {
      if (line.startsWith("@@")) {
        const match = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          newLine = parseInt(match[2], 10);
        }
        html += `<tr class="wb-diff-row hunk-header"><td class="wb-diff-gutter">...</td><td class="wb-diff-gutter">...</td><td class="wb-diff-sign"></td><td class="wb-diff-text">${this.escapeHtml(line)}</td></tr>`;
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        const text = line.substring(1);
        html += `<tr class="wb-diff-row line-add"><td class="wb-diff-gutter"></td><td class="wb-diff-gutter">${newLine}</td><td class="wb-diff-sign">+</td><td class="wb-diff-text">${this.escapeHtml(text)}</td></tr>`;
        newLine++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        const text = line.substring(1);
        html += `<tr class="wb-diff-row line-del"><td class="wb-diff-gutter">${oldLine}</td><td class="wb-diff-gutter"></td><td class="wb-diff-sign">-</td><td class="wb-diff-text">${this.escapeHtml(text)}</td></tr>`;
        oldLine++;
      } else if (line.startsWith(" ") || line === "") {
        const text = line.startsWith(" ") ? line.substring(1) : line;
        html += `<tr class="wb-diff-row"><td class="wb-diff-gutter">${oldLine || ""}</td><td class="wb-diff-gutter">${newLine || ""}</td><td class="wb-diff-sign"></td><td class="wb-diff-text">${this.escapeHtml(text)}</td></tr>`;
        if (oldLine) oldLine++;
        if (newLine) newLine++;
      } else {
        // Meta headers (diff --git, index, +++, ---)
        html += `<tr class="wb-diff-row" style="opacity: 0.6; font-size: 11px;"><td class="wb-diff-gutter"></td><td class="wb-diff-gutter"></td><td class="wb-diff-sign"></td><td class="wb-diff-text">${this.escapeHtml(line)}</td></tr>`;
      }
    }

    html += `</tbody></table>`;
    return html;
  }

  async loadFileForTab(tab) {
    if (!tab.filePath) return;
    try {
      const res = await fetch(`/api/file-content?path=${encodeURIComponent(tab.filePath)}`);
      const data = await res.json();
      if (res.ok && data.content !== undefined) {
        tab.content = data.content;
        tab.savedContent = data.content;
        tab.isDirty = false;

        const container = this.viewContainers.get(tab.id);
        if (container) {
          const textarea = container.querySelector(".wb-textarea");
          if (textarea) {
            textarea.value = tab.content;
            textarea.dispatchEvent(new Event("input"));
          }
          const preview = container.querySelector(".wb-md-preview");
          if (preview) {
            preview.innerHTML = this.renderMarkdownHtml(tab.content || "*Empty markdown document*");
          }
        }
      }
    } catch (e) {
      console.error("Failed to load file content for tab", e);
    }
  }

  async saveTabContent(tab) {
    if (!tab.filePath) {
      const defaultName = tab.type === "markdown" ? "untitled.md" : "untitled.txt";
      const ws = this.getActiveWorkspace();
      const basePath = ws ? ws.path : "";
      const pathPrompt = prompt("Save file as full path:", basePath ? `${basePath}/${defaultName}` : defaultName);
      if (!pathPrompt) return;
      tab.filePath = pathPrompt.trim();
      tab.title = tab.filePath.split("/").pop();
    }

    try {
      const res = await fetch("/api/file-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: tab.filePath,
          content: tab.content
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || "Save file failed");
        return;
      }
      tab.savedContent = tab.content;
      tab.isDirty = false;

      const container = this.viewContainers.get(tab.id);
      if (container) {
        const statusEl = container.querySelector(".wb-save-status");
        if (statusEl) {
          statusEl.textContent = "Saved ✓";
          statusEl.className = "wb-save-status saved";
          setTimeout(() => {
            if (!tab.isDirty) statusEl.textContent = "";
          }, 1800);
        }
      }
      this.renderTabs();
      this.fetchGitStatusData().then(() => {
        if (this.activeRightPanel === "explorer") {
          this.loadExplorer();
        } else {
          this.loadGitStatus();
        }
      });
    } catch (err) {
      alert("Error saving: " + String(err));
    }
  }

  // Pure lightweight Markdown renderer (headings, bold, italic, codeblocks, inline code, links, blockquotes, lists, tables)
  renderMarkdownHtml(mdText) {
    if (!mdText) return "";
    let src = this.escapeHtml(mdText);

    // Code blocks ```lang ... ```
    src = src.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code `...`
    src = src.replace(/`([^`\n]+)`/g, "<code>$1</code>");

    // Headings
    src = src.replace(/^#### (.*?)$/gm, "<h4>$1</h4>");
    src = src.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
    src = src.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
    src = src.replace(/^# (.*?)$/gm, "<h1>$1</h1>");

    // Bold & Italic
    src = src.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    src = src.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // Blockquotes
    src = src.replace(/^> (.*?)$/gm, "<blockquote>$1</blockquote>");

    // Horizontal Rule
    src = src.replace(/^---$/gm, "<hr />");

    // Links [text](url)
    src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Tables: simple detection of | col | col |
    const lines = src.split("\n");
    const parsedLines = [];
    let inTable = false;
    let tableRows = [];

    const flushTable = () => {
      if (!tableRows.length) return;
      let tableHtml = "<table>";
      tableRows.forEach((r, idx) => {
        if (idx === 1 && r.some(c => /^:?-+:?$/.test(c.trim()))) {
          return; // Skip separator line
        }
        const tag = idx === 0 ? "th" : "td";
        tableHtml += "<tr>" + r.map(c => `<${tag}>${c.trim()}</${tag}>`).join("") + "</tr>";
      });
      tableHtml += "</table>";
      parsedLines.push(tableHtml);
      tableRows = [];
      inTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        inTable = true;
        const cells = line.trim().slice(1, -1).split("|");
        tableRows.push(cells);
      } else {
        if (inTable) flushTable();
        // Unordered lists
        if (/^\s*[-*]\s+(.*)$/.test(line)) {
          parsedLines.push(`<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`);
        } else if (/^\s*\d+\.\s+(.*)$/.test(line)) {
          parsedLines.push(`<li>${line.replace(/^\s*\d+\.\s+/, "")}</li>`);
        } else if (line.trim().length > 0 && !line.startsWith("<h") && !line.startsWith("<blockquote") && !line.startsWith("<pre")) {
          parsedLines.push(`<p>${line}</p>`);
        } else {
          parsedLines.push(line);
        }
      }
    }
    if (inTable) flushTable();

    return parsedLines.join("\n");
  }

  fitTerminal(sessionId) {
    const session = this.terminalSessions.get(sessionId);
    if (!session) return;
    try {
      if (session.fitAddon) {
        session.fitAddon.fit();
      }
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

    // Hide or show terminal sessions
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

    // Hide or show view containers (browser, markdown, editor)
    this.viewContainers.forEach((container, vId) => {
      if (vId === tabId) {
        container.classList.remove("hidden");
        const textarea = container.querySelector(".wb-textarea");
        if (textarea) textarea.focus();
      } else {
        container.classList.add("hidden");
      }
    });

    this.renderWorkspaces();
    this.renderTabs();
    this.renderCwd();
    this.renderStatusBadge();
    this.reloadRightSidebar();
  }

  closeTab(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    if (tab.isDirty) {
      const confirmClose = confirm(`Tab "${tab.title}" has unsaved changes. Close anyway?`);
      if (!confirmClose) return;
    }

    const wsId = tab.workspaceId;
    const wsTabs = this.tabs.filter((t) => t.workspaceId === wsId);
    const idxInWs = wsTabs.findIndex((t) => t.id === tabId);

    // Teardown xterm & backend session if terminal
    if (tab.type === "terminal") {
      this.sendWs({ action: "kill", sessionId: tabId });
      const session = this.terminalSessions.get(tabId);
      if (session) {
        if (session.windowPasteHandler) {
          window.removeEventListener("paste", session.windowPasteHandler, { capture: true });
        }
        session.resizeObserver?.disconnect();
        session.term.dispose();
        session.container.remove();
        this.terminalSessions.delete(tabId);
      }
    } else {
      const viewEl = this.viewContainers.get(tabId);
      if (viewEl) {
        viewEl.remove();
        this.viewContainers.delete(tabId);
      }
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
          this.createTab(targetWs, "terminal");
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
    if (!tab) return;

    if (tab.type === "terminal") {
      const session = this.terminalSessions.get(this.activeTabId);
      if (session) {
        session.term.reset();
        session.term.writeln("\x1b[33m\r\n[Reconnecting shell session...]\x1b[0m\r\n");
        this.spawnBackendShell(tab.id, tab.repoPath);
      }
    } else if (tab.type === "browser") {
      const container = this.viewContainers.get(tab.id);
      const iframe = container?.querySelector(".wb-browser-frame");
      if (iframe) iframe.src = tab.url;
    } else if (tab.type === "markdown" || tab.type === "editor") {
      if (tab.filePath) {
        this.loadFileForTab(tab);
      }
    }
  }

  clearActiveTab() {
    if (!this.activeTabId) return;
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (tab && tab.type === "terminal") {
      const session = this.terminalSessions.get(this.activeTabId);
      session?.term?.clear();
    }
  }

  sendInputToActive(text) {
    if (!this.activeTabId) return;
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab || tab.type !== "terminal") {
      // If active tab is not terminal, try finding or creating a terminal tab
      const termTab = this.tabs.find((t) => t.workspaceId === this.activeWorkspaceId && t.type === "terminal");
      if (termTab) {
        this.switchTab(termTab.id);
        this.sendWs({ action: "input", sessionId: termTab.id, data: text });
      }
      return;
    }
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
        <span class="tab-title">${this.escapeHtml(tab.title)}</span>
        ${dirtyBadge}
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

    if (tab && tab.type === "terminal") {
      if (tab.running) {
        badge.textContent = tab.pid ? `PID ${tab.pid}` : "LIVE";
        badge.style.background = "rgba(16, 185, 129, 0.15)";
        badge.style.borderColor = "rgba(16, 185, 129, 0.4)";
        badge.style.color = "#34d399";
      } else {
        badge.textContent = "SHELL OFF";
        badge.style.background = "var(--bg-subtle)";
        badge.style.borderColor = "var(--border-subtle)";
        badge.style.color = "var(--text-dim)";
      }
    } else if (tab && tab.type === "browser") {
      badge.textContent = "BROWSER";
      badge.style.background = "rgba(59, 130, 246, 0.15)";
      badge.style.borderColor = "rgba(59, 130, 246, 0.4)";
      badge.style.color = "#60a5fa";
    } else if (tab && tab.type === "markdown") {
      badge.textContent = tab.isEditMode ? "MD EDIT" : "MD PREVIEW";
      badge.style.background = "rgba(168, 85, 247, 0.15)";
      badge.style.borderColor = "rgba(168, 85, 247, 0.4)";
      badge.style.color = "#c084fc";
    } else if (tab && tab.type === "editor") {
      badge.textContent = tab.isDirty ? "UNSAVED" : "EDITOR";
      badge.style.background = tab.isDirty ? "rgba(251, 191, 36, 0.15)" : "var(--bg-subtle)";
      badge.style.borderColor = tab.isDirty ? "rgba(251, 191, 36, 0.4)" : "var(--border-subtle)";
      badge.style.color = tab.isDirty ? "#fbbf24" : "var(--text-muted)";
    } else if (tab && tab.type === "diff") {
      badge.textContent = "DIFF";
      badge.style.background = "rgba(56, 189, 248, 0.15)";
      badge.style.borderColor = "rgba(56, 189, 248, 0.4)";
      badge.style.color = "#38bdf8";
    } else {
      badge.textContent = "NO TAB";
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

  // Right Sidebar (Orca style) Methods
  getActiveWorkspace() {
    return this.workspaces.find((w) => w.id === this.activeWorkspaceId) || null;
  }

  toggleRightSidebar(forceState) {
    const rs = document.getElementById("right-sidebar");
    if (!rs) return;
    if (typeof forceState === "boolean") {
      this.isRightSidebarOpen = forceState;
    } else {
      this.isRightSidebarOpen = !this.isRightSidebarOpen;
    }
    if (this.isRightSidebarOpen) {
      rs.classList.remove("collapsed");
    } else {
      rs.classList.add("collapsed");
    }
    // Trigger window resize and terminal fit after layout transition
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      if (this.activeTabId) this.fitTerminal(this.activeTabId);
    }, 200);
  }

  switchRightPanel(panelName) {
    this.activeRightPanel = panelName;
    const tabExplorer = document.getElementById("rs-tab-explorer");
    const tabGit = document.getElementById("rs-tab-git");
    const panelExplorer = document.getElementById("rs-panel-explorer");
    const panelGit = document.getElementById("rs-panel-git");

    if (panelName === "explorer") {
      tabExplorer?.classList.add("active");
      tabGit?.classList.remove("active");
      panelExplorer?.classList.add("active");
      panelGit?.classList.remove("active");
      this.loadExplorer();
    } else {
      tabExplorer?.classList.remove("active");
      tabGit?.classList.add("active");
      panelExplorer?.classList.remove("active");
      panelGit?.classList.add("active");
      this.loadGitStatus();
    }
  }

  reloadRightSidebar() {
    const ws = this.getActiveWorkspace();
    const wsNameEl = document.getElementById("rs-ws-name");
    if (wsNameEl) {
      wsNameEl.textContent = ws ? ws.name : "-";
      wsNameEl.title = ws ? ws.path : "";
    }
    // Refresh git status so status badges stay in sync
    this.fetchGitStatusData().then(() => {
      this.updateStatusbar();
      if (this.activeRightPanel === "explorer") {
        this.loadExplorer();
      } else {
        this.loadGitStatus();
      }
    });
  }

  async loadGitignore() {
    const ws = this.getActiveWorkspace();
    if (!ws) {
      this.gitignoreRules = [];
      return;
    }
    try {
      const res = await fetch(`/api/file-content?path=${encodeURIComponent(ws.path + "/.gitignore")}`);
      if (res.ok) {
        const data = await res.json();
        if (data.content) {
          this.gitignoreRules = data.content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"));
          return;
        }
      }
    } catch {}
    this.gitignoreRules = [];
  }

  matchGitignore(relPath, isDir = false) {
    if (!this.gitignoreRules || !this.gitignoreRules.length) return false;
    const cleanRel = relPath.replace(/^\/+/, "");
    const parts = cleanRel.split("/");
    const basename = parts[parts.length - 1];

    for (const rule of this.gitignoreRules) {
      let r = rule.trim();
      if (!r) continue;
      const isDirOnly = r.endsWith("/");
      if (isDirOnly) {
        r = r.slice(0, -1);
        if (!isDir && !cleanRel.includes("/")) continue;
      }

      // Exact match on relative path or basename
      if (r === cleanRel || r === basename) return true;

      // Leading slash match against root
      if (r.startsWith("/")) {
        const rootPattern = r.slice(1);
        if (cleanRel === rootPattern || cleanRel.startsWith(rootPattern + "/")) return true;
        continue;
      }

      // Subdirectory match (e.g. node_modules anywhere in path)
      if (cleanRel === r || cleanRel.startsWith(r + "/") || parts.includes(r)) return true;

      // Wildcard match (e.g. *.log, temp-*)
      if (r.includes("*")) {
        const rx = new RegExp("^" + r.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*") + "$");
        if (rx.test(basename) || rx.test(cleanRel)) return true;
      }
    }
    return false;
  }

  async fetchGitStatusData() {
    const ws = this.getActiveWorkspace();
    if (!ws) {
      this.gitStatusData = null;
      this.gitignoreRules = [];
      this.updateStatusbar();
      return null;
    }
    await this.loadGitignore();
    try {
      const res = await fetch(`/api/git/status?path=${encodeURIComponent(ws.path)}`);
      const data = await res.json();
      if (res.ok && !data.error) {
        this.gitStatusData = data;
        const totalChanges = (data.staged?.length || 0) + (data.unstaged?.length || 0) + (data.untracked?.length || 0);
        const badgeEl = document.getElementById("rs-git-badge");
        if (badgeEl) {
          if (totalChanges > 0) {
            badgeEl.textContent = String(totalChanges);
            badgeEl.style.display = "inline-flex";
          } else {
            badgeEl.style.display = "none";
          }
        }
        this.updateStatusbar();
        return data;
      }
    } catch {}
    this.gitStatusData = null;
    this.updateStatusbar();
    return null;
  }

  isPathIgnored(targetPath, isDir = false) {
    const ws = this.getActiveWorkspace();
    if (!ws) return false;

    let relPath = targetPath;
    if (targetPath.startsWith(ws.path)) {
      relPath = targetPath.slice(ws.path.length).replace(/^\/+/, "");
    }
    const norm = relPath.replace(/\/+$/, "");
    if (!norm) return false;

    // Check .gitignore rules parsed from workspace
    if (this.matchGitignore(norm, isDir)) return true;

    // Check git status ignored list
    if (this.gitStatusData?.ignored && Array.isArray(this.gitStatusData.ignored)) {
      return this.gitStatusData.ignored.some((ign) => {
        const ignNorm = ign.replace(/\/+$/, "");
        return norm === ignNorm || ignNorm.startsWith(norm + "/") || norm.startsWith(ignNorm + "/");
      });
    }

    return false;
  }

  getFileGitStatus(filePath) {
    if (!this.gitStatusData) return null;
    const ws = this.getActiveWorkspace();
    if (!ws) return null;

    let relPath = filePath;
    if (filePath.startsWith(ws.path)) {
      relPath = filePath.slice(ws.path.length).replace(/^\/+/, "");
    }

    if (this.gitStatusData.untracked && (this.gitStatusData.untracked.includes(relPath) || this.gitStatusData.untracked.some(u => relPath.startsWith(u.replace(/\/+$/, "") + "/")))) {
      return "U";
    }

    const stagedItem = this.gitStatusData.staged?.find(i => i.file === relPath);
    if (stagedItem) {
      const st = stagedItem.status;
      if (st === "A") return "A";
      if (st === "D") return "D";
      return "M";
    }

    const unstagedItem = this.gitStatusData.unstaged?.find(i => i.file === relPath);
    if (unstagedItem) {
      const st = unstagedItem.status;
      if (st === "D") return "D";
      return "M";
    }

    return null;
  }

  getFolderGitStatus(folderPath) {
    if (!this.gitStatusData) return null;
    const ws = this.getActiveWorkspace();
    if (!ws) return null;

    let relDir = folderPath;
    if (folderPath.startsWith(ws.path)) {
      relDir = folderPath.slice(ws.path.length).replace(/^\/+/, "");
    }
    const prefix = relDir ? (relDir.endsWith("/") ? relDir : relDir + "/") : "";

    let hasM = false;
    let hasU = false;

    const check = (file, st) => {
      if (prefix === "" || file === relDir || file.startsWith(prefix) || (relDir && relDir.startsWith(file.replace(/\/+$/, "") + "/"))) {
        if (st === "M" || st === "D") hasM = true;
        else if (st === "U" || st === "?" || st === "A") hasU = true;
      }
    };

    this.gitStatusData.untracked?.forEach(f => check(f, "U"));
    this.gitStatusData.staged?.forEach(item => check(item.file, item.status));
    this.gitStatusData.unstaged?.forEach(item => check(item.file, item.status));

    if (hasM) return "M";
    if (hasU) return "U";
    return null;
  }

  async fetchDirectoryItems(dirPath) {
    if (this.folderCache.has(dirPath)) {
      return this.folderCache.get(dirPath);
    }
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      if (res.ok && data.items) {
        this.folderCache.set(dirPath, data.items);
        return data.items;
      }
    } catch (e) {
      console.error("fetchDirectoryItems failed", e);
    }
    return [];
  }

  async loadExplorer(forceRefresh = false) {
    const ws = this.getActiveWorkspace();
    const treeEl = document.getElementById("rs-files-tree");
    if (!treeEl) return;

    if (!ws) {
      treeEl.innerHTML = `<div class="rs-empty">No workspace selected</div>`;
      return;
    }

    if (forceRefresh) {
      this.folderCache.clear();
      await this.fetchGitStatusData();
    } else if (!this.gitStatusData) {
      await this.fetchGitStatusData();
    }

    treeEl.innerHTML = `<div class="rs-empty">Loading files...</div>`;
    const rootItems = await this.fetchDirectoryItems(ws.path);

    if (!rootItems || rootItems.length === 0) {
      treeEl.innerHTML = `<div class="rs-empty">Empty workspace directory</div>`;
      return;
    }

    treeEl.innerHTML = "";
    for (const item of rootItems) {
      const node = await this.buildTreeNode(item, 0);
      treeEl.appendChild(node);
    }
  }

  async buildTreeNode(item, level) {
    const wrapper = document.createElement("div");
    wrapper.className = "rs-tree-node";

    const row = document.createElement("div");
    row.className = `rs-file-item ${item.isDirectory ? "is-dir" : "is-file"}`;
    row.style.paddingLeft = `${level * 14 + 6}px`;
    row.setAttribute("data-path", item.path);
    row.setAttribute("data-isdir", item.isDirectory ? "true" : "false");

    const isOpen = item.isDirectory && this.openFolders.has(item.path);
    if (isOpen) row.classList.add("open");

    const isIgnored = this.isPathIgnored(item.path, item.isDirectory);

    const gitStatus = item.isDirectory
      ? this.getFolderGitStatus(item.path)
      : this.getFileGitStatus(item.path);
    if (gitStatus) {
      row.classList.add(`git-${gitStatus}`);
    }
    if (isIgnored) {
      row.classList.add("is-ignored");
    }

    const chevronHtml = item.isDirectory
      ? `<span class="rs-chevron">${isOpen ? "&#9662;" : "&#9656;"}</span>`
      : `<span class="rs-chevron" style="opacity:0;">&bull;</span>`;

    const icon = item.isDirectory
      ? (isOpen ? "&#128194;" : "&#128193;")
      : "&#128196;";

    let badgeHtml = "";
    if (isIgnored) {
      badgeHtml = `<span class="rs-git-badge ignored" title="Git Ignored">&#8856;</span>`;
    } else if (gitStatus) {
      badgeHtml = `<span class="rs-git-badge ${gitStatus}">${gitStatus}</span>`;
    }

    row.innerHTML = `
      ${chevronHtml}
      <span class="rs-file-icon">${icon}</span>
      <span class="rs-file-name" title="${this.escapeHtml(item.name)}">${this.escapeHtml(item.name)}</span>
      ${badgeHtml}
    `;

    wrapper.appendChild(row);

    const childrenContainer = document.createElement("div");
    childrenContainer.className = "rs-tree-children";
    childrenContainer.style.display = isOpen ? "flex" : "none";
    wrapper.appendChild(childrenContainer);

    if (isOpen) {
      const subItems = await this.fetchDirectoryItems(item.path);
      for (const sub of subItems) {
        const subNode = await this.buildTreeNode(sub, level + 1);
        childrenContainer.appendChild(subNode);
      }
    }

    row.addEventListener("click", async () => {
      if (item.isDirectory) {
        const willOpen = !this.openFolders.has(item.path);
        const chevronEl = row.querySelector(".rs-chevron");
        const iconEl = row.querySelector(".rs-file-icon");

        if (willOpen) {
          this.openFolders.add(item.path);
          row.classList.add("open");
          if (chevronEl) chevronEl.innerHTML = "&#9662;";
          if (iconEl) iconEl.innerHTML = "&#128194;";
          childrenContainer.innerHTML = `<div class="rs-empty" style="padding:4px ${level * 14 + 20}px; text-align:left;">Loading...</div>`;
          childrenContainer.style.display = "flex";

          const subItems = await this.fetchDirectoryItems(item.path);
          childrenContainer.innerHTML = "";
          if (subItems.length === 0) {
            childrenContainer.innerHTML = `<div class="rs-empty" style="padding:4px ${level * 14 + 20}px; text-align:left;">(empty)</div>`;
          } else {
            for (const sub of subItems) {
              const subNode = await this.buildTreeNode(sub, level + 1);
              childrenContainer.appendChild(subNode);
            }
          }
        } else {
          this.openFolders.delete(item.path);
          row.classList.remove("open");
          if (chevronEl) chevronEl.innerHTML = "&#9656;";
          if (iconEl) iconEl.innerHTML = "&#128193;";
          childrenContainer.style.display = "none";
        }
      } else {
        this.openFileInWorkbench(item.path);
      }
    });

    return wrapper;
  }

  // Open file in workbench tab (Markdown or Code Editor)
  openFileInWorkbench(filePath) {
    if (!filePath) return;
    const isMd = /\.md$/i.test(filePath);
    const fileName = filePath.split("/").pop();

    // Check if file is already open in an existing tab
    const existing = this.tabs.find((t) => t.filePath === filePath && t.type !== "diff");
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    const type = isMd ? "markdown" : "editor";
    this.createTab(null, type, {
      title: fileName,
      filePath
    });
  }

  // Open Git Diff in Workbench Tab ala VS Code
  openDiffTab(file, isStaged, statusCode = "M", commitHash = null) {
    if (!file) return;
    const ws = this.getActiveWorkspace();
    const repoPath = ws ? ws.path : "";
    const basename = file.split("/").pop();
    const fullFilePath = repoPath ? `${repoPath}/${file}` : file;

    const diffTitle = commitHash
      ? `⇄ ${basename} (${commitHash.substring(0, 7)})`
      : `⇄ ${basename} (${isStaged ? "Staged" : "Working Tree"})`;

    // Check if already open
    const existing = this.tabs.find((t) =>
      t.type === "diff" &&
      t.diffFile === file &&
      t.isStaged === Boolean(isStaged) &&
      t.commitHash === commitHash
    );

    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    this.createTab(ws, "diff", {
      title: diffTitle,
      diffFile: file,
      filePath: fullFilePath,
      isStaged: Boolean(isStaged),
      gitStatusCode: statusCode || "M",
      commitHash
    });
  }

  async previewFile(filePath) {
    const modal = document.getElementById("rs-preview-modal");
    const titleEl = document.getElementById("rs-preview-title");
    const sizeEl = document.getElementById("rs-preview-size");
    const codeEl = document.getElementById("rs-preview-code");
    if (!modal || !titleEl || !codeEl) return;

    const fileName = filePath.split("/").pop();
    titleEl.textContent = fileName;
    sizeEl.textContent = "...";
    codeEl.textContent = "Loading...";
    modal.style.display = "flex";

    try {
      const res = await fetch(`/api/file-content?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        codeEl.textContent = data.error || "Failed to load file content";
        sizeEl.textContent = "";
        return;
      }
      sizeEl.textContent = this.formatFileSize(data.size || 0);
      codeEl.textContent = data.content || "(Empty file)";
    } catch (err) {
      codeEl.textContent = "Error: " + String(err);
      sizeEl.textContent = "";
    }
  }

  async loadGitStatus() {
    const ws = this.getActiveWorkspace();
    const branchEl = document.getElementById("rs-git-branch");
    const groupsEl = document.getElementById("rs-git-groups");
    const badgeEl = document.getElementById("rs-git-badge");
    if (!groupsEl) return;

    if (!ws) {
      if (branchEl) branchEl.textContent = "-";
      if (badgeEl) badgeEl.style.display = "none";
      groupsEl.innerHTML = `<div class="rs-empty">No workspace selected</div>`;
      return;
    }

    groupsEl.innerHTML = `<div class="rs-empty">Checking git status...</div>`;

    try {
      const res = await fetch(`/api/git/status?path=${encodeURIComponent(ws.path)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        if (branchEl) branchEl.textContent = "not a git repo";
        if (badgeEl) badgeEl.style.display = "none";
        groupsEl.innerHTML = `<div class="rs-empty">${this.escapeHtml(data.error || "Not a git repository")}</div>`;
        return;
      }

      this.gitStatusData = data;
      if (branchEl) {
        branchEl.textContent = data.branch || "HEAD";
        if (data.upstream) branchEl.title = `Upstream: ${data.upstream}`;
      }

      const staged = data.staged || [];
      const unstaged = data.unstaged || [];
      const untracked = data.untracked || [];
      const totalChanges = staged.length + unstaged.length + untracked.length;

      if (badgeEl) {
        if (totalChanges > 0) {
          badgeEl.textContent = String(totalChanges);
          badgeEl.style.display = "inline-flex";
        } else {
          badgeEl.style.display = "none";
        }
      }

      if (totalChanges === 0) {
        groupsEl.innerHTML = `<div class="rs-empty">&#10003; Working tree clean</div>`;
        return;
      }

      // Expand any directory paths (e.g. untracked bin/)
      const [expStaged, expUnstaged, expUntracked] = await Promise.all([
        this.expandGitItems(ws.path, staged),
        this.expandGitItems(ws.path, unstaged),
        this.expandGitItems(ws.path, untracked.map((f) => ({ file: f, status: "U" })))
      ]);

      groupsEl.innerHTML = "";

      if (expStaged.length > 0) {
        groupsEl.appendChild(this.renderGitSection("Staged Changes", expStaged, true, ws.path));
      }
      if (expUnstaged.length > 0) {
        groupsEl.appendChild(this.renderGitSection("Changes", expUnstaged, false, ws.path));
      }
      if (expUntracked.length > 0) {
        groupsEl.appendChild(this.renderGitSection("Untracked", expUntracked, false, ws.path));
      }

      this.loadGitCommits();
    } catch (err) {
      groupsEl.innerHTML = `<div class="rs-empty">Error: ${this.escapeHtml(String(err))}</div>`;
      this.loadGitCommits();
    }
  }

  // Expand trailing slash directory entries recursively using fetchDirectoryItems
  async expandGitItems(repoPath, items) {
    const result = [];
    for (const item of items) {
      const filePath = item.file || "";
      let code = item.status || "M";
      if (code === "?") code = "U";

      if (filePath.endsWith("/")) {
        const subFiles = await this.collectFilesRecursively(repoPath, filePath.replace(/\/+$/, ""));
        if (subFiles.length > 0) {
          for (const sf of subFiles) {
            result.push({ file: sf, status: code });
          }
        } else {
          result.push({ file: filePath, status: code });
        }
      } else {
        result.push({ file: filePath, status: code });
      }
    }
    return result;
  }

  async collectFilesRecursively(repoPath, relDir) {
    const fullDirPath = repoPath + "/" + relDir;
    const items = await this.fetchDirectoryItems(fullDirPath);
    const files = [];
    for (const it of items) {
      const childRel = relDir ? `${relDir}/${it.name}` : it.name;
      if (it.isDirectory) {
        const nested = await this.collectFilesRecursively(repoPath, childRel);
        files.push(...nested);
      } else {
        files.push(childRel);
      }
    }
    return files;
  }

  // Build hierarchical tree structure from flat file list
  buildGitTree(files) {
    const root = { name: "", fullPath: "", isDir: true, children: new Map(), status: null };

    const statusOrder = { D: 4, M: 3, A: 2, U: 1 };
    function pickStatus(s1, s2) {
      if (!s1) return s2 || "M";
      if (!s2) return s1 || "M";
      return (statusOrder[s2] || 0) > (statusOrder[s1] || 0) ? s2 : s1;
    }

    for (const item of files) {
      const normalized = (item.file || "").replace(/^\/+/, "").replace(/\/+$/, "");
      if (!normalized) continue;
      const parts = normalized.split("/");
      let current = root;
      let curPath = "";
      const itemStatus = item.status === "?" ? "U" : (item.status || "M");

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        curPath = curPath ? `${curPath}/${part}` : part;
        const isLeaf = i === parts.length - 1;

        if (isLeaf) {
          current.children.set(part, {
            name: part,
            fullPath: curPath,
            isDir: false,
            children: new Map(),
            status: itemStatus
          });
        } else {
          if (!current.children.has(part)) {
            current.children.set(part, {
              name: part,
              fullPath: curPath,
              isDir: true,
              children: new Map(),
              status: itemStatus
            });
          }
          current = current.children.get(part);
          current.status = pickStatus(current.status, itemStatus);
        }
      }
    }

    return root;
  }

  renderGitTreeNode(node, sectionKey, level, isStaged, repoPath) {
    const wrapper = document.createElement("div");
    wrapper.className = "rs-git-tree-node";

    const row = document.createElement("div");
    const itemPathKey = `${sectionKey}:${node.fullPath}`;

    let code = node.status || "M";
    if (code === "?") code = "U";

    if (node.isDir) {
      const isCollapsed = this.gitTreeCollapsed.has(itemPathKey);
      row.className = "rs-git-tree-row rs-git-folder-item";
      row.style.paddingLeft = `${level * 14 + 6}px`;

      row.innerHTML = `
        <span class="rs-git-chevron">${isCollapsed ? "&#9656;" : "&#9662;"}</span>
        <span class="rs-git-icon">${isCollapsed ? "&#128193;" : "&#128194;"}</span>
        <span class="rs-git-name" title="${this.escapeHtml(node.fullPath)}">${this.escapeHtml(node.name)}</span>
        <span class="rs-git-badge ${this.escapeHtml(code)}">${this.escapeHtml(code)}</span>
      `;

      wrapper.appendChild(row);

      const childrenEl = document.createElement("div");
      childrenEl.className = "rs-git-tree-children";
      if (isCollapsed) childrenEl.style.display = "none";

      const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      for (const child of sortedChildren) {
        childrenEl.appendChild(this.renderGitTreeNode(child, sectionKey, level + 1, isStaged, repoPath));
      }

      wrapper.appendChild(childrenEl);

      row.addEventListener("click", () => {
        const collapsed = this.gitTreeCollapsed.has(itemPathKey);
        const chev = row.querySelector(".rs-git-chevron");
        const ic = row.querySelector(".rs-git-icon");
        if (collapsed) {
          this.gitTreeCollapsed.delete(itemPathKey);
          if (chev) chev.innerHTML = "&#9662;";
          if (ic) ic.innerHTML = "&#128194;";
          childrenEl.style.display = "block";
        } else {
          this.gitTreeCollapsed.add(itemPathKey);
          if (chev) chev.innerHTML = "&#9656;";
          if (ic) ic.innerHTML = "&#128193;";
          childrenEl.style.display = "none";
        }
      });
    } else {
      row.className = `rs-git-tree-row rs-git-file-item git-${this.escapeHtml(code)}`;
      row.style.paddingLeft = `${level * 14 + 6}px`;

      let actionsHtml = "";
      if (isStaged) {
        actionsHtml = `<button class="rs-git-action-btn btn-unstage-file" title="Unstage Changes ( - )">&minus;</button>`;
      } else {
        actionsHtml = `
          <button class="rs-git-action-btn btn-discard-file" title="Discard Changes ( ⟲ )">&#x27f2;</button>
          <button class="rs-git-action-btn btn-stage-file" title="Stage Changes ( + )">&plus;</button>
        `;
      }

      row.innerHTML = `
        <span class="rs-git-chevron" style="opacity: 0; pointer-events: none;">&bull;</span>
        <span class="rs-git-icon">&#128196;</span>
        <span class="rs-git-name" title="${this.escapeHtml(node.fullPath)}">${this.escapeHtml(node.name)}</span>
        <span class="rs-git-actions">${actionsHtml}</span>
        <span class="rs-git-badge ${this.escapeHtml(code)}">${this.escapeHtml(code)}</span>
      `;

      // Action button click handlers (stop propagation to row click)
      const stageBtn = row.querySelector(".btn-stage-file");
      if (stageBtn) {
        stageBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.stageFile(node.fullPath);
        });
      }
      const unstageBtn = row.querySelector(".btn-unstage-file");
      if (unstageBtn) {
        unstageBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.unstageFile(node.fullPath);
        });
      }
      const discardBtn = row.querySelector(".btn-discard-file");
      if (discardBtn) {
        discardBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.discardFile(node.fullPath);
        });
      }

      row.addEventListener("click", () => {
        this.openDiffTab(node.fullPath, isStaged, code);
      });

      wrapper.appendChild(row);
    }

    return wrapper;
  }

  renderGitSection(title, files, isStaged, repoPath) {
    const isCollapsed = this.gitSectionsCollapsed.has(title);
    const sectionEl = document.createElement("div");
    sectionEl.className = `rs-git-section ${isCollapsed ? "collapsed" : ""}`;
    sectionEl.setAttribute("data-section", title);

    let sectionActionsHtml = "";
    if (title === "Changes") {
      sectionActionsHtml = `
        <span class="rs-git-actions">
          <button class="rs-git-action-btn btn-discard-all" title="Discard All Changes ( ⟲ )">&#x27f2;</button>
          <button class="rs-git-action-btn btn-stage-all" title="Stage All Changes ( + )">&plus;</button>
        </span>
      `;
    } else if (title === "Staged Changes") {
      sectionActionsHtml = `
        <span class="rs-git-actions">
          <button class="rs-git-action-btn btn-unstage-all" title="Unstage All ( - )">&minus;</button>
        </span>
      `;
    } else if (title === "Untracked") {
      sectionActionsHtml = `
        <span class="rs-git-actions">
          <button class="rs-git-action-btn btn-discard-all" title="Discard All Untracked ( ⟲ )">&#x27f2;</button>
          <button class="rs-git-action-btn btn-stage-all" title="Stage All Untracked ( + )">&plus;</button>
        </span>
      `;
    }

    const titleEl = document.createElement("div");
    titleEl.className = "rs-git-section-title";
    titleEl.innerHTML = `
      <span class="rs-git-section-label">
        <span class="rs-git-chevron">&#9662;</span>
        <span>${this.escapeHtml(title)}</span>
      </span>
      <div style="display: flex; align-items: center; gap: 6px;">
        ${sectionActionsHtml}
        <span class="rs-badge">${files.length}</span>
      </div>
    `;

    // Header action button event handlers
    const stageAllBtn = titleEl.querySelector(".btn-stage-all");
    if (stageAllBtn) {
      stageAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.stageAll();
      });
    }
    const unstageAllBtn = titleEl.querySelector(".btn-unstage-all");
    if (unstageAllBtn) {
      unstageAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.unstageAll();
      });
    }
    const discardAllBtn = titleEl.querySelector(".btn-discard-all");
    if (discardAllBtn) {
      discardAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.discardAll();
      });
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "rs-git-section-body";

    const treeRoot = this.buildGitTree(files);
    const sortedChildren = Array.from(treeRoot.children.values()).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    for (const child of sortedChildren) {
      bodyEl.appendChild(this.renderGitTreeNode(child, title, 0, isStaged, repoPath));
    }

    titleEl.addEventListener("click", () => {
      if (this.gitSectionsCollapsed.has(title)) {
        this.gitSectionsCollapsed.delete(title);
        sectionEl.classList.remove("collapsed");
      } else {
        this.gitSectionsCollapsed.add(title);
        sectionEl.classList.add("collapsed");
      }
    });

    sectionEl.appendChild(titleEl);
    sectionEl.appendChild(bodyEl);
    return sectionEl;
  }

  async refreshGitAndExplorer() {
    await this.fetchGitStatusData();
    await this.loadGitStatus();
    if (this.activeRightPanel === "explorer") {
      this.loadExplorer(true);
    }
  }

  async stageFile(file) {
    const ws = this.getActiveWorkspace();
    if (!ws || !file) return;
    try {
      const res = await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ws.path, file })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || "Failed to stage file");
        return;
      }
      await this.refreshGitAndExplorer();
    } catch (err) {
      alert("Stage error: " + String(err));
    }
  }

  async stageAll() {
    const ws = this.getActiveWorkspace();
    if (!ws) return;
    try {
      const res = await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ws.path, all: true })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || "Failed to stage all");
        return;
      }
      await this.refreshGitAndExplorer();
    } catch (err) {
      alert("Stage all error: " + String(err));
    }
  }

  async unstageFile(file) {
    const ws = this.getActiveWorkspace();
    if (!ws || !file) return;
    try {
      const res = await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ws.path, file })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || "Failed to unstage file");
        return;
      }
      await this.refreshGitAndExplorer();
    } catch (err) {
      alert("Unstage error: " + String(err));
    }
  }

  async unstageAll() {
    const ws = this.getActiveWorkspace();
    if (!ws) return;
    try {
      const res = await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ws.path, all: true })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || "Failed to unstage all");
        return;
      }
      await this.refreshGitAndExplorer();
    } catch (err) {
      alert("Unstage all error: " + String(err));
    }
  }

  async discardFile(file) {
    const ws = this.getActiveWorkspace();
    if (!ws || !file) return;
    const ok = confirm(`Are you sure you want to discard changes in '${file}'? This cannot be undone.`);
    if (!ok) return;

    try {
      const res = await fetch("/api/git/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ws.path, file })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || "Failed to discard changes");
        return;
      }
      await this.refreshGitAndExplorer();
    } catch (err) {
      alert("Discard error: " + String(err));
    }
  }

  async discardAll() {
    const ws = this.getActiveWorkspace();
    if (!ws) return;
    const ok = confirm("Are you sure you want to discard all changes in working tree? This cannot be undone.");
    if (!ok) return;

    try {
      const res = await fetch("/api/git/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ws.path, all: true })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || "Failed to discard all changes");
        return;
      }
      await this.refreshGitAndExplorer();
    } catch (err) {
      alert("Discard all error: " + String(err));
    }
  }

  async loadGitCommits() {
    const listEl = document.getElementById("rs-git-commits-list");
    const countEl = document.getElementById("rs-commits-count");
    if (!listEl) return;

    const ws = this.getActiveWorkspace();
    if (!ws) {
      listEl.innerHTML = `<div class="rs-empty">No workspace selected</div>`;
      if (countEl) countEl.textContent = "0";
      return;
    }

    try {
      const res = await fetch(`/api/git/log?path=${encodeURIComponent(ws.path)}`);
      const data = await res.json();
      const commits = data.commits || [];

      if (countEl) countEl.textContent = String(commits.length);

      if (commits.length === 0) {
        listEl.innerHTML = `<div class="rs-empty">No commits yet</div>`;
        return;
      }

      listEl.innerHTML = "";
      commits.forEach((c) => {
        const item = document.createElement("div");
        item.className = "rs-commit-item";
        item.title = `${c.hash}\n${c.author} - ${c.relativeDate}\n\n${c.message}`;

        item.innerHTML = `
          <div class="rs-commit-item-msg">${this.escapeHtml(c.message)}</div>
          <div class="rs-commit-item-meta">
            <span class="rs-commit-hash">#${this.escapeHtml(c.shortHash)}</span>
            <span class="rs-commit-time">${this.escapeHtml(c.relativeDate)}</span>
            <span class="rs-commit-author">${this.escapeHtml(c.author)}</span>
          </div>
        `;

        item.addEventListener("click", () => {
          this.openCommitTab(c);
        });

        listEl.appendChild(item);
      });
    } catch (err) {
      listEl.innerHTML = `<div class="rs-empty">Failed to load commits: ${this.escapeHtml(String(err))}</div>`;
      if (countEl) countEl.textContent = "0";
    }
  }

  openCommitTab(commit) {
    const ws = this.getActiveWorkspace();
    const shortHash = commit.shortHash || (commit.hash ? commit.hash.substring(0, 7) : "commit");
    const tabTitle = `⇄ #${shortHash}`;

    // Switch if already open
    const existing = this.tabs.find((t) => t.type === "diff" && t.commitHash === commit.hash);
    if (existing) {
      this.switchTab(existing.id);
      return;
    }

    this.createTab(ws, "diff", {
      title: tabTitle,
      commitHash: commit.hash,
      diffFile: `Commit ${shortHash}: ${commit.message}`
    });
  }

  async previewDiff(repoPath, file, staged) {
    const modal = document.getElementById("rs-preview-modal");
    const titleEl = document.getElementById("rs-preview-title");
    const sizeEl = document.getElementById("rs-preview-size");
    const codeEl = document.getElementById("rs-preview-code");
    if (!modal || !titleEl || !codeEl) return;

    titleEl.textContent = `Diff: ${file} ${staged ? "(Staged)" : ""}`;
    sizeEl.textContent = "diff";
    codeEl.innerHTML = "Computing diff...";
    modal.style.display = "flex";

    try {
      const url = `/api/git/diff?path=${encodeURIComponent(repoPath)}&file=${encodeURIComponent(file)}&staged=${staged}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.error) {
        codeEl.textContent = data.error || "Failed to get diff";
        return;
      }

      if (!data.diff || !data.diff.trim()) {
        codeEl.textContent = "(No diff or untracked new file)";
        return;
      }

      // Syntax-colored diff lines
      const lines = data.diff.split("\n");
      const colored = lines.map((l) => {
        const esc = this.escapeHtml(l);
        if (l.startsWith("+") && !l.startsWith("+++")) return `<span class="diff-add">${esc}</span>`;
        if (l.startsWith("-") && !l.startsWith("---")) return `<span class="diff-del">${esc}</span>`;
        if (l.startsWith("@@") || l.startsWith("diff ") || l.startsWith("index ")) return `<span class="diff-meta">${esc}</span>`;
        return esc;
      }).join("\n");

      codeEl.innerHTML = colored;
    } catch (err) {
      codeEl.textContent = "Error: " + String(err);
    }
  }

  async commitChanges() {
    const ws = this.getActiveWorkspace();
    if (!ws) {
      alert("Select a workspace first");
      return;
    }

    const input = document.getElementById("rs-commit-msg");
    const stageCheck = document.getElementById("rs-commit-stage-all");
    const msg = input?.value.trim();
    if (!msg) {
      alert("Please enter a commit message");
      return;
    }

    const stageAll = stageCheck ? stageCheck.checked : true;
    const btn = document.getElementById("rs-commit-btn");
    if (btn) btn.disabled = true;

    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: ws.path,
          message: msg,
          stageAll
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || "Git commit failed");
      } else {
        if (input) input.value = "";
        this.loadGitStatus();
      }
    } catch (err) {
      alert("Commit error: " + String(err));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  updateStatusbar() {
    const ws = this.getActiveWorkspace();
    const wsEl = document.getElementById("sb-ws-status");
    const gitEl = document.getElementById("sb-git-branch");

    if (wsEl) {
      wsEl.textContent = ws ? ws.name : "No workspace";
      wsEl.title = ws ? ws.path : "";
    }

    if (gitEl) {
      if (!ws) {
        gitEl.textContent = "Git: -";
      } else if (this.gitStatusData?.branch) {
        gitEl.textContent = `Git: ${this.gitStatusData.branch}`;
      } else {
        gitEl.textContent = "Git: -";
      }
    }
  }

  async loadSystemStatus() {
    const portEl = document.getElementById("sb-active-port");
    const ramEl = document.getElementById("sb-system-ram");
    const fallbackPort = window.location.port || "3456";

    try {
      const res = await fetch("/api/system-status");
      if (res.ok) {
        const data = await res.json();
        if (portEl) {
          portEl.textContent = `⚡ Port: ${data.port || fallbackPort}`;
        }
        if (ramEl) {
          ramEl.textContent = `🧠 RAM: ${data.processRssMb} MB | System: ${data.systemUsedGb} / ${data.systemTotalGb} GB (${data.systemPercent}%)`;
        }
        return;
      }
    } catch {}

    if (portEl) portEl.textContent = `⚡ Port: ${fallbackPort}`;
  }

  startSystemStatusLoop() {
    this.loadSystemStatus();
    setInterval(() => {
      this.loadSystemStatus();
    }, 4000);
  }

  // ==========================================================================
  // AI Chat Assistant Methods
  // ==========================================================================
  toggleAiPanel(forceState) {
    const panel = document.getElementById("ai-panel");
    if (!panel) return;
    if (typeof forceState === "boolean") {
      this.isAiPanelOpen = forceState;
    } else {
      this.isAiPanelOpen = !this.isAiPanelOpen;
    }
    if (this.isAiPanelOpen) {
      panel.classList.remove("collapsed");
    } else {
      panel.classList.add("collapsed");
    }
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      if (this.activeTabId) this.fitTerminal(this.activeTabId);
    }, 180);
  }

  setAiStatus(status, text) {
    const indicator = document.getElementById("ai-status-indicator");
    const statusTextEl = document.getElementById("ai-status-text");
    if (indicator) {
      indicator.className = `ai-status-indicator ${status || ""}`;
    }
    if (statusTextEl && text) {
      statusTextEl.textContent = text;
    }
  }

  clearAiChat() {
    if (this.isAiStreaming) {
      this.cancelAiStreaming();
    }
    this.aiMessages = [];
    const container = document.getElementById("ai-chat-messages");
    if (container) {
      container.innerHTML = `
        <div class="ai-welcome-message">
          <div class="ai-welcome-badge">⚡ Native ADE Assistant</div>
          <h3>How can I assist your workspace today?</h3>
          <p>I can run commands, inspect files, apply edits, and help debug errors in realtime.</p>
        </div>
      `;
    }
    this.setAiStatus("", "Ready");
  }

  addAiAttachment(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      this.aiAttachments.push({
        name: file.name || "pasted-image.png",
        dataUrl,
        mime: file.type
      });
      this.renderAiAttachmentBar();
    };
    reader.readAsDataURL(file);
  }

  removeAiAttachment(index) {
    this.aiAttachments.splice(index, 1);
    this.renderAiAttachmentBar();
  }

  renderAiAttachmentBar() {
    const bar = document.getElementById("ai-attachment-bar");
    if (!bar) return;
    if (this.aiAttachments.length === 0) {
      bar.style.display = "none";
      bar.innerHTML = "";
      return;
    }
    bar.style.display = "flex";
    bar.innerHTML = this.aiAttachments.map((att, idx) => `
      <div class="ai-attach-chip" data-idx="${idx}">
        <img class="ai-attach-thumb" src="${att.dataUrl}" alt="${this.escapeHtml(att.name)}" />
        <span class="ai-attach-name" title="${this.escapeHtml(att.name)}">${this.escapeHtml(att.name)}</span>
        <button type="button" class="ai-attach-remove" data-idx="${idx}" title="Remove image">&times;</button>
      </div>
    `).join("");

    bar.querySelectorAll(".ai-attach-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        this.removeAiAttachment(idx);
      });
    });
  }

  cancelAiStreaming() {
    if (this.aiAbortController) {
      this.aiAbortController.abort();
      this.aiAbortController = null;
    }
    this.setAiStreamingState(false);
    this.setAiStatus("", "Cancelled");
  }

  setAiStreamingState(isStreaming) {
    this.isAiStreaming = isStreaming;
    const stopBtn = document.getElementById("ai-stop-btn");
    const sendBtn = document.getElementById("ai-send-btn");
    const indicator = document.getElementById("ai-status-indicator");

    if (stopBtn) stopBtn.style.display = isStreaming ? "inline-flex" : "none";
    if (sendBtn) {
      sendBtn.disabled = isStreaming;
      sendBtn.style.opacity = isStreaming ? "0.6" : "1";
    }
    if (indicator) {
      if (isStreaming) {
        indicator.classList.add("busy");
      } else {
        indicator.classList.remove("busy");
      }
    }
  }

  scrollAiChatToBottom() {
    const container = document.getElementById("ai-chat-messages");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  formatToolIcon(toolName = "") {
    const t = toolName.toLowerCase();
    if (t.includes("bash") || t.includes("sh") || t.includes("command")) return "⚡";
    if (t.includes("read") || t.includes("cat") || t.includes("view")) return "📖";
    if (t.includes("edit") || t.includes("write") || t.includes("patch")) return "✏️";
    if (t.includes("search") || t.includes("find") || t.includes("grep")) return "🔍";
    return "🔧";
  }

  renderToolCallBlock(toolCall) {
    const icon = this.formatToolIcon(toolCall.name);
    const title = `${icon} ${toolCall.name}: ${toolCall.args || ""}`;
    const statusClass = toolCall.status || "running";
    const statusLabel = toolCall.status === "success" ? "Done" : toolCall.status === "error" ? "Failed" : "Running...";

    return `
      <div class="ai-tool-call ${statusClass} ${toolCall.open ? "open" : ""}" id="tool-call-${toolCall.id}">
        <div class="ai-tool-header">
          <span class="ai-tool-title">${this.escapeHtml(title)}</span>
          <span class="ai-tool-status">${statusLabel}</span>
        </div>
        <div class="ai-tool-body">${this.escapeHtml(toolCall.output || toolCall.args || "(no output)")}</div>
      </div>
    `;
  }

  async sendAiPrompt() {
    const textarea = document.getElementById("ai-prompt-input");
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text && this.aiAttachments.length === 0) return;
    if (this.isAiStreaming) return;

    const modelSelect = document.getElementById("ai-model-select");
    const model = modelSelect ? modelSelect.value : "anthropic/claude-3-7-sonnet";
    const attachments = [...this.aiAttachments];
    const ws = this.getActiveWorkspace();

    // Clear input
    textarea.value = "";
    textarea.style.height = "auto";
    this.aiAttachments = [];
    this.renderAiAttachmentBar();

    // Remove welcome placeholder if first message
    const container = document.getElementById("ai-chat-messages");
    const welcome = container?.querySelector(".ai-welcome-message");
    if (welcome) welcome.remove();

    // Append User Message
    const userMsgRow = document.createElement("div");
    userMsgRow.className = "ai-msg ai-msg-user";
    let userImagesHtml = "";
    if (attachments.length > 0) {
      userImagesHtml = `<div class="ai-bubble-images">` +
        attachments.map((att) => `<img class="ai-bubble-image-thumb" src="${att.dataUrl}" alt="${this.escapeHtml(att.name)}" />`).join("") +
        `</div>`;
    }
    userMsgRow.innerHTML = `
      <div class="ai-msg-header">You</div>
      <div class="ai-msg-bubble">
        ${userImagesHtml}
        <div>${this.escapeHtml(text).replace(/\n/g, "<br/>")}</div>
      </div>
    `;
    container.appendChild(userMsgRow);

    // Prepare Assistant Message Placeholder
    const assistantMsgRow = document.createElement("div");
    assistantMsgRow.className = "ai-msg ai-msg-assistant";
    const assistantId = `ai-msg-bot-${Date.now()}`;
    assistantMsgRow.id = assistantId;
    assistantMsgRow.innerHTML = `
      <div class="ai-msg-header">AI Assistant (${this.escapeHtml(model.split("/").pop())})</div>
      <div class="ai-msg-bubble">
        <div class="ai-msg-tools-area"></div>
        <div class="ai-msg-content"><span class="ai-streaming-cursor"></span></div>
      </div>
    `;
    container.appendChild(assistantMsgRow);
    this.scrollAiChatToBottom();

    // Start SSE Stream
    this.setAiStreamingState(true);
    this.setAiStatus("busy", "Thinking...");
    this.aiAbortController = new AbortController();

    const toolsArea = assistantMsgRow.querySelector(".ai-msg-tools-area");
    const contentArea = assistantMsgRow.querySelector(".ai-msg-content");
    let accumulatedText = "";
    const activeToolCalls = new Map(); // id -> tool object

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: this.aiAbortController.signal,
        body: JSON.stringify({
          prompt: text,
          model,
          workspacePath: ws ? ws.path : null,
          images: attachments.map((a) => ({ name: a.name, dataUrl: a.dataUrl, mime: a.mime }))
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.replace(/^data:\s*/, "");
          if (jsonStr === "[DONE]") {
            break;
          }
          try {
            const event = JSON.parse(jsonStr);

            // Handle token chunk
            if (event.type === "chunk" || event.type === "token" || event.text || event.delta) {
              const piece = event.text || event.delta || (event.chunk ? event.chunk : "");
              accumulatedText += piece;
              contentArea.innerHTML = this.renderMarkdownHtml(accumulatedText) + `<span class="ai-streaming-cursor"></span>`;
              this.setAiStatus("busy", "Streaming response...");
              this.scrollAiChatToBottom();
            }

            // Handle tool calling events
            if (event.type === "tool_start" || event.type === "tool_call") {
              const toolId = event.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const toolObj = {
                id: toolId,
                name: event.name || event.tool || "tool",
                args: typeof event.args === "string" ? event.args : JSON.stringify(event.args || {}),
                status: "running",
                output: "",
                open: true
              };
              activeToolCalls.set(toolId, toolObj);
              this.setAiStatus("busy", `Running ${toolObj.name}...`);
              this.renderActiveTools(toolsArea, activeToolCalls);
              this.scrollAiChatToBottom();
            }

            if (event.type === "tool_result" || event.type === "tool_end") {
              const toolId = event.id || Array.from(activeToolCalls.keys()).pop();
              if (toolId && activeToolCalls.has(toolId)) {
                const toolObj = activeToolCalls.get(toolId);
                toolObj.status = event.isError || event.error ? "error" : "success";
                toolObj.output = event.result || event.output || event.error || "(completed)";
                activeToolCalls.set(toolId, toolObj);
                this.renderActiveTools(toolsArea, activeToolCalls);
                this.scrollAiChatToBottom();
              }
            }
          } catch {
            // raw text line fallback
            if (jsonStr) {
              accumulatedText += jsonStr;
              contentArea.innerHTML = this.renderMarkdownHtml(accumulatedText) + `<span class="ai-streaming-cursor"></span>`;
              this.scrollAiChatToBottom();
            }
          }
        }
      }

      // Finalize display (remove streaming cursor)
      contentArea.innerHTML = this.renderMarkdownHtml(accumulatedText || "*No response text.*");
      this.setAiStatus("", "Ready");
    } catch (err) {
      if (err.name === "AbortError") {
        contentArea.innerHTML = this.renderMarkdownHtml(accumulatedText) + ` <em style="color:#94a3b8;">(Stopped)</em>`;
        this.setAiStatus("", "Stopped");
      } else {
        contentArea.innerHTML = this.renderMarkdownHtml(accumulatedText) + `<div style="color:#f87171; margin-top:6px;">⚠️ Error: ${this.escapeHtml(err.message)}</div>`;
        this.setAiStatus("error", "Error");
      }
    } finally {
      this.setAiStreamingState(false);
      this.aiAbortController = null;
      this.scrollAiChatToBottom();
    }
  }

  renderActiveTools(toolsArea, activeToolCalls) {
    if (!toolsArea) return;
    toolsArea.innerHTML = Array.from(activeToolCalls.values()).map((t) => this.renderToolCallBlock(t)).join("");
    // Attach collapse toggles
    toolsArea.querySelectorAll(".ai-tool-header").forEach((header) => {
      header.addEventListener("click", () => {
        const parent = header.closest(".ai-tool-call");
        if (parent) parent.classList.toggle("open");
      });
    });
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
      window.dispatchEvent(new Event("resize"));
      if (app.activeTabId) app.fitTerminal(app.activeTabId);
    }, 180);
  });

  // Folder Pick button
  document.getElementById("add-ws-btn")?.addEventListener("click", () => {
    app.pickFolder();
  });

  // New Tab button (Instant 1-click create Terminal) & Dropdown Menu
  const newTabBtn = document.getElementById("new-tab-btn");
  const newTabMoreBtn = document.getElementById("new-tab-more-btn");
  const newTabMenu = document.getElementById("new-tab-menu");

  // Single click '+' -> Immediately spawn new Terminal tab
  newTabBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (newTabMenu) newTabMenu.classList.remove("open");
    app.createTab(null, "terminal");
  });

  // Click down arrow '▾' or right-click '+' -> Open dropdown menu
  newTabMoreBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    newTabMenu?.classList.toggle("open");
  });
  newTabBtn?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    newTabMenu?.classList.toggle("open");
  });

  newTabMenu?.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = item.getAttribute("data-action");
      newTabMenu?.classList.remove("open");

      if (action === "new-terminal") {
        app.createTab(null, "terminal");
      } else if (action === "new-browser") {
        app.createTab(null, "browser", { url: "http://localhost:3000" });
      } else if (action === "new-markdown") {
        app.createTab(null, "markdown", { isEditMode: true });
      } else if (action === "new-editor") {
        app.createTab(null, "editor");
      }
    });
  });

  window.addEventListener("click", (e) => {
    if (newTabMenu && newTabMenu.classList.contains("open")) {
      if (!newTabMenu.contains(e.target) && e.target !== newTabMoreBtn && e.target !== newTabBtn) {
        newTabMenu.classList.remove("open");
      }
    }
  });

  // AI Assistant Panel Toggles
  document.getElementById("toggle-ai-btn")?.addEventListener("click", () => {
    app.toggleAiPanel();
  });
  document.getElementById("ai-close-btn")?.addEventListener("click", () => {
    app.toggleAiPanel(false);
  });
  document.getElementById("ai-clear-chat-btn")?.addEventListener("click", () => {
    app.clearAiChat();
  });

  // AI Prompt Send & Auto-resize Textarea
  const aiPromptInput = document.getElementById("ai-prompt-input");
  aiPromptInput?.addEventListener("input", () => {
    aiPromptInput.style.height = "auto";
    aiPromptInput.style.height = `${Math.min(aiPromptInput.scrollHeight, 160)}px`;
  });

  aiPromptInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      app.sendAiPrompt();
    }
  });

  document.getElementById("ai-send-btn")?.addEventListener("click", () => {
    app.sendAiPrompt();
  });

  document.getElementById("ai-stop-btn")?.addEventListener("click", () => {
    app.cancelAiStreaming();
  });

  // File input attach
  const aiFileInput = document.getElementById("ai-file-input");
  aiFileInput?.addEventListener("change", (e) => {
    const files = e.target.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        app.addAiAttachment(files[i]);
      }
    }
    aiFileInput.value = "";
  });

  // Paste image handler inside textarea
  aiPromptInput?.addEventListener("paste", (e) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData || !clipboardData.items) return;

    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          app.addAiAttachment(file);
        }
      }
    }
  });

  // Right Sidebar Toggle (top-right header button & sidebar close button)
  document.getElementById("toggle-right-sidebar-btn")?.addEventListener("click", () => {
    app.toggleRightSidebar();
  });
  document.getElementById("rs-close-btn")?.addEventListener("click", () => {
    app.toggleRightSidebar(false);
  });

  // Switch between Explorer & Git tabs
  document.getElementById("rs-tab-explorer")?.addEventListener("click", () => {
    app.switchRightPanel("explorer");
  });
  document.getElementById("rs-tab-git")?.addEventListener("click", () => {
    app.switchRightPanel("git");
  });

  // Refresh buttons
  document.getElementById("rs-explorer-refresh")?.addEventListener("click", () => {
    app.loadExplorer(true);
  });
  document.getElementById("rs-git-refresh")?.addEventListener("click", () => {
    app.loadGitStatus();
  });

  // Git Commit actions
  document.getElementById("rs-commit-btn")?.addEventListener("click", () => {
    app.commitChanges();
  });
  document.getElementById("rs-commit-msg")?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      app.commitChanges();
    }
  });

  // File Preview Modal close
  const previewModal = document.getElementById("rs-preview-modal");
  document.getElementById("rs-preview-close")?.addEventListener("click", () => {
    if (previewModal) previewModal.style.display = "none";
  });
  previewModal?.querySelector(".rs-modal-overlay")?.addEventListener("click", () => {
    previewModal.style.display = "none";
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && previewModal && previewModal.style.display !== "none") {
      previewModal.style.display = "none";
    }
  });

  // Commits section accordion toggle
  const commitsTitle = document.getElementById("rs-commits-title");
  const commitsSection = document.getElementById("rs-git-commits-section");
  commitsTitle?.addEventListener("click", () => {
    commitsSection?.classList.toggle("collapsed");
  });

  // Global window resize
  window.addEventListener("resize", () => {
    if (app.activeTabId) {
      app.fitTerminal(app.activeTabId);
    }
  });

  // Global Context Menu handler & state hook
  window.customContextMenu = {
    target: null,
    handler: null,
    open(e, customHandler) {
      if (typeof customHandler === "function") {
        customHandler(e);
      }
    },
  };

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.customContextMenu.target = e.target;
    // ponytail: basic hook placeholder, full custom menu rendering added when UI components ready
    window.customContextMenu.open(e, window.customContextMenu.handler);
  });

  // Prevent disruptive browser default shortcuts
  const BLOCKED_MOD_KEYS = new Set(["r", "p", "s", "f", "g", "u", "o", "d", "h", "j", "t", "n", "w", "[", "]"]);

  window.addEventListener("keydown", (e) => {
    const key = e.key;
    const lowerKey = key.toLowerCase();
    const isMod = e.ctrlKey || e.metaKey;

    // F1 - F12 keys
    if (/^f([1-9]|1[0-2])$/i.test(key)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Backspace outside editable elements
    if (key === "Backspace") {
      const target = e.target;
      const isEditable = target && (
        target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.closest?.(".xterm")
      );
      if (!isEditable) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Alt + Left / Right navigation
    if (e.altKey && !isMod && (key === "ArrowLeft" || key === "ArrowRight")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (!isMod) return;

    // Ctrl/Cmd + Shift + I / J / C (DevTools) or Ctrl/Cmd + Shift + R (Hard reload)
    if (e.shiftKey && (lowerKey === "i" || lowerKey === "j" || lowerKey === "c" || lowerKey === "r")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Block standard browser single/combo hotkeys without breaking editing (c, v, x, a, z)
    if (!e.shiftKey && BLOCKED_MOD_KEYS.has(lowerKey)) {
      e.preventDefault();
      e.stopPropagation();

      window.dispatchEvent(new CustomEvent("app:shortcut", {
        detail: { key: lowerKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }
      }));
    }
  }, { capture: true });

  // Start WS and fetch workspaces
  app.initWebSocket();
  app.loadWorkspaces();
  app.startSystemStatusLoop();
});
