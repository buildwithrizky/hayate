import assert from "node:assert/strict";
import { selectWorkspace } from "../public/js/workspace.js";
import { switchTab, closeTab } from "../public/js/tabs.js";

function createMockElement(initialStyle = {}) {
  const classes = new Set();
  const children = new Map();
  return {
    classList: {
      add: (cls) => classes.add(cls),
      remove: (cls) => classes.delete(cls),
      contains: (cls) => classes.has(cls),
      toggle: (cls) => (classes.has(cls) ? classes.delete(cls) : classes.add(cls))
    },
    style: { ...initialStyle },
    textContent: "",
    title: "",
    innerHTML: "",
    appendChild: () => {},
    remove: () => {},
    querySelector: (sel) => {
      if (!children.has(sel)) children.set(sel, createMockElement());
      return children.get(sel);
    },
    querySelectorAll: () => []
  };
}

globalThis.window = {
  __TAURI__: {
    core: { invoke: async () => {} }
  }
};

// Setup mock DOM globals needed for render functions
const emptyNoticeEl = createMockElement({ display: "var(--display-none)" });
const tabsContainerEl = createMockElement();
const cwdPathEl = createMockElement();
const statusBadgeEl = createMockElement();

globalThis.document = {
  getElementById: (id) => {
    if (id === "terminal-empty-notice") return emptyNoticeEl;
    if (id === "tabs-container") return tabsContainerEl;
    if (id === "cwd-path") return cwdPathEl;
    if (id === "session-status-badge") return statusBadgeEl;
    if (id === "workspace-list") return createMockElement();
    if (id === "ws-count-badge") return createMockElement();
    return null;
  },
  createElement: () => createMockElement()
};

// Test State
const termContainer = createMockElement();
const editorContainer = createMockElement();

const state = {
  workspaces: [
    { id: "ws_1", name: "Repo 1", path: "/path/to/repo1" },
    { id: "ws_2", name: "Repo 2", path: "/path/to/repo2" }
  ],
  activeWorkspaceId: "ws_1",
  activeTabId: "tab_1",
  activeTabByWorkspace: {
    ws_1: "tab_1"
  },
  tabs: [
    { id: "tab_1", workspaceId: "ws_1", type: "terminal", title: "Term 1", repoPath: "/path/to/repo1" },
    { id: "tab_2", workspaceId: "ws_1", type: "editor", title: "Index.js", repoPath: "/path/to/repo1" }
  ],
  terminalSessions: new Map([
    ["tab_1", { container: termContainer, term: { focus: () => {}, dispose: () => {} } }]
  ]),
  viewContainers: new Map([
    ["tab_2", editorContainer]
  ]),
  switchTab(tabId) {
    return switchTab(this, tabId);
  },
  renderWorkspaces() {},
  renderTabs() {},
  renderCwd() {},
  renderStatusBadge() {},
  reloadRightSidebar() {}
};

// 1. Initial active state in ws_1
switchTab(state, "tab_1");
assert.equal(state.activeTabId, "tab_1");
assert.equal(termContainer.classList.contains("hidden"), false, "tab_1 container must not be hidden");
assert.equal(editorContainer.classList.contains("hidden"), true, "tab_2 container must be hidden");

// 2. Switch to empty workspace ws_2
selectWorkspace(state, state.workspaces[1]);

assert.equal(state.activeWorkspaceId, "ws_2", "active workspace must be ws_2");
assert.equal(state.activeTabId, null, "activeTabId must be null for empty workspace");
assert.equal(termContainer.classList.contains("hidden"), true, "tab_1 container must be hidden when switching to empty ws");
assert.equal(editorContainer.classList.contains("hidden"), true, "tab_2 container must be hidden when switching to empty ws");
assert.equal(emptyNoticeEl.style.display, "var(--display-flex)", "empty notice must be displayed");
assert.equal(statusBadgeEl.textContent, "NO TAB", "status badge must say NO TAB");

// 3. Switch back to ws_1
selectWorkspace(state, state.workspaces[0]);

assert.equal(state.activeWorkspaceId, "ws_1");
assert.equal(state.activeTabId, "tab_1", "remembered tab_1 must be active");
assert.equal(termContainer.classList.contains("hidden"), false, "tab_1 must be visible again");
assert.equal(emptyNoticeEl.style.display, "var(--display-none)", "empty notice must be hidden");

// 4. Close all tabs in ws_1
closeTab(state, "tab_2");
closeTab(state, "tab_1");

assert.equal(state.activeTabId, null, "activeTabId must be null after closing all tabs");
assert.equal(state.terminalSessions.has("tab_1"), false, "session must be removed");
assert.equal(emptyNoticeEl.style.display, "var(--display-flex)", "empty notice must be displayed");
assert.equal(statusBadgeEl.textContent, "NO TAB");

console.log("All empty workspace tab switching assertions passed.");
