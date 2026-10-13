import { initPty, initFsWatcher, sendWs, handleBackendMessage, spawnBackendShell } from "./api.js";
import {
  loadWorkspaces,
  pickFolder,
  addWorkspace,
  updateWorkspace,
  deleteWorkspace,
  selectWorkspace,
  renderWorkspaces,
  getActiveWorkspace
} from "./workspace.js";
import {
  createTab,
  switchTab,
  closeTab,
  renameTab,
  restartActiveTab,
  clearActiveTab,
  sendInputToActive,
  renderTabs,
  renderStatusBadge,
  renderCwd,
  pinTab,
  unpinTab,
  hibernateTab,
  wakeTab,
  reopenClosedTab
} from "./tabs.js";
import { mountTerminalInstance, fitTerminal } from "./views/terminal.js";
import { mountBrowserInstance } from "./views/browser.js";
import {
  mountEditorInstance,
  mountMarkdownInstance,
  disposeEditorInstance,
  getEditorInstance,
  loadFileForTab,
  saveTabContent,
  getPrismLanguage,
  highlightCode,
  renderMarkdownHtml
} from "./views/editor.js";
import {
  mountDiffInstance,
  loadDiffForTab,
  disposeDiffInstance,
  getDiffEditorInstance
} from "./views/diff.js";
import {
  mountImageInstance,
  disposeImageInstance
} from "./views/image.js";
import {
  loadGitignore,
  matchGitignore,
  isPathIgnored,
  getFileGitStatus,
  getFolderGitStatus,
  fetchDirectoryItems,
  loadExplorer,
  buildTreeNode,
  openFileInWorkbench,
  previewFile,
  triggerExplorerNew,
  collapseAllFolders
} from "./explorer.js";
import {
  fetchGitStatusData,
  loadGitStatus,
  expandGitItems,
  buildGitTree,
  renderGitTreeNode,
  renderGitSection,
  refreshGitAndExplorer,
  stageFile,
  stageAll,
  unstageFile,
  unstageAll,
  discardFile,
  discardAll,
  loadGitCommits,
  openCommitTab,
  previewDiff,
  commitChanges,
  openDiffTab
} from "./git/index.js";
import {
  toggleSidebar,
  toggleRightSidebar,
  switchRightPanel,
  reloadRightSidebar
} from "./layout.js";
import { getSearchController } from "./search.js";
import { ExplorerTreeFilter } from "./explorer-filter.js";

export function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, (tag) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[tag] || tag));
}

export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export class StateManager {
  constructor() {
    this.workspaces = [];
    this.activeWorkspaceId = null;
    this.tabs = [];
    this.activeTabId = null;
    this.activeTabByWorkspace = {};
    this.isSidebarOpen = true;
    this.isManualAdding = false;
    this.editingWorkspaceId = null;
    this.editingTabId = null;

    this.unlistenPty = null;

    // session id -> { term, fitAddon, container, resizeObserver, windowPasteHandler }
    this.terminalSessions = new Map();
    // tab id -> container element for non-terminal views (browser, markdown, editor, diff)
    this.viewContainers = new Map();
    this.closedTabsHistory = [];

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
    this.treeFilter = null;
  }

  escapeHtml(str) {
    return escapeHtml(str);
  }

  formatFileSize(bytes) {
    return formatFileSize(bytes);
  }

  // API
  initPty() {
    return initPty(this);
  }

  initFsWatcher() {
    return initFsWatcher(this);
  }

  sendWs(data) {
    return sendWs(data);
  }

  handleBackendMessage(msg) {
    return handleBackendMessage(this, msg);
  }

  spawnBackendShell(sessionId, repoPath) {
    return spawnBackendShell(this, sessionId, repoPath);
  }

  // Workspaces
  loadWorkspaces() {
    return loadWorkspaces(this);
  }

  pickFolder() {
    return pickFolder(this);
  }

  addWorkspace(name, path) {
    return addWorkspace(this, name, path);
  }

  updateWorkspace(id, name, path) {
    return updateWorkspace(this, id, name, path);
  }

  deleteWorkspace(id) {
    return deleteWorkspace(this, id);
  }

  selectWorkspace(ws) {
    return selectWorkspace(this, ws);
  }

  renderWorkspaces() {
    return renderWorkspaces(this);
  }

  getActiveWorkspace() {
    return getActiveWorkspace(this);
  }

  // Tabs
  createTab(workspace, type = "terminal", initOptions = {}) {
    return createTab(this, workspace, type, initOptions);
  }

  switchTab(tabId) {
    return switchTab(this, tabId);
  }

  async closeTab(tabId) {
    return closeTab(this, tabId);
  }

  renameTab(tabId) {
    return renameTab(this, tabId);
  }

  restartActiveTab() {
    return restartActiveTab(this);
  }

  clearActiveTab() {
    return clearActiveTab(this);
  }

  sendInputToActive(text) {
    return sendInputToActive(this, text);
  }

  renderTabs() {
    return renderTabs(this);
  }

  renderStatusBadge() {
    return renderStatusBadge(this);
  }

  renderCwd() {
    return renderCwd(this);
  }

  recordClosedTab(tab) {
    if (!tab) return;
    this.closedTabsHistory.push({
      type: tab.type,
      title: tab.title,
      workspaceId: tab.workspaceId,
      url: tab.url,
      filePath: tab.filePath,
      content: tab.content,
      cwd: tab.cwd,
      isEditMode: tab.isEditMode
    });
    if (this.closedTabsHistory.length > 50) {
      this.closedTabsHistory.shift();
    }
  }

  popClosedTab(workspaceId = null) {
    if (this.closedTabsHistory.length === 0) return null;
    if (!workspaceId) return this.closedTabsHistory.pop();
    for (let i = this.closedTabsHistory.length - 1; i >= 0; i--) {
      if (this.closedTabsHistory[i].workspaceId === workspaceId) {
        return this.closedTabsHistory.splice(i, 1)[0];
      }
    }
    return this.closedTabsHistory.pop();
  }

  pinTab(tabId) {
    return pinTab(this, tabId);
  }

  unpinTab(tabId) {
    return unpinTab(this, tabId);
  }

  hibernateTab(tabId) {
    return hibernateTab(this, tabId);
  }

  wakeTab(tabId) {
    return wakeTab(this, tabId);
  }

  reopenClosedTab() {
    return reopenClosedTab(this);
  }

  // Views - Terminal
  mountTerminalInstance(tab) {
    return mountTerminalInstance(this, tab);
  }

  fitTerminal(sessionId, immediate = false) {
    return fitTerminal(this, sessionId, immediate);
  }

  // Views - Browser
  mountBrowserInstance(tab) {
    return mountBrowserInstance(this, tab);
  }

  // Views - Editor & Markdown
  getPrismLanguage(filePath) {
    return getPrismLanguage(filePath);
  }

  highlightCode(code, lang) {
    return highlightCode(code, lang);
  }

  renderMarkdownHtml(mdText) {
    return renderMarkdownHtml(mdText);
  }

  mountMarkdownInstance(tab) {
    return mountMarkdownInstance(this, tab);
  }

  mountEditorInstance(tab) {
    return mountEditorInstance(this, tab);
  }

  disposeEditorInstance(tabId) {
    return disposeEditorInstance(tabId);
  }

  getEditorInstance(tabId) {
    return getEditorInstance(tabId);
  }

  loadFileForTab(tab) {
    return loadFileForTab(this, tab);
  }

  saveTabContent(tab) {
    return saveTabContent(this, tab);
  }

  // Views - Diff
  mountDiffInstance(tab) {
    return mountDiffInstance(this, tab);
  }

  loadDiffForTab(tab) {
    return loadDiffForTab(this, tab);
  }

  disposeDiffInstance(tabId) {
    return disposeDiffInstance(tabId);
  }

  getDiffEditorInstance(tabId) {
    return getDiffEditorInstance(tabId);
  }

  // Views - Image
  mountImageInstance(tab) {
    return mountImageInstance(this, tab);
  }

  disposeImageInstance(tabId) {
    return disposeImageInstance(tabId);
  }

  // Explorer
  loadGitignore() {
    return loadGitignore(this);
  }

  matchGitignore(relPath, isDir = false) {
    return matchGitignore(this, relPath, isDir);
  }

  isPathIgnored(targetPath, isDir = false) {
    return isPathIgnored(this, targetPath, isDir);
  }

  getFileGitStatus(filePath) {
    return getFileGitStatus(this, filePath);
  }

  getFolderGitStatus(folderPath) {
    return getFolderGitStatus(this, folderPath);
  }

  fetchDirectoryItems(dirPath) {
    return fetchDirectoryItems(this, dirPath);
  }

  loadExplorer(forceRefresh = false) {
    return loadExplorer(this, forceRefresh);
  }

  buildTreeNode(item, level) {
    return buildTreeNode(this, item, level);
  }

  openFileInWorkbench(filePath, revealLine = null) {
    return openFileInWorkbench(this, filePath, revealLine);
  }

  previewFile(filePath) {
    return previewFile(this, filePath);
  }

  triggerExplorerNew(isDir = false) {
    return triggerExplorerNew(this, isDir);
  }

  collapseAllFolders() {
    return collapseAllFolders(this);
  }

  // Git
  fetchGitStatusData() {
    return fetchGitStatusData(this);
  }

  loadGitStatus() {
    return loadGitStatus(this);
  }

  expandGitItems(repoPath, items) {
    return expandGitItems(this, repoPath, items);
  }

  buildGitTree(files) {
    return buildGitTree(files);
  }

  renderGitTreeNode(node, sectionKey, level, isStaged, repoPath) {
    return renderGitTreeNode(this, node, sectionKey, level, isStaged, repoPath);
  }

  renderGitSection(title, files, isStaged, repoPath) {
    return renderGitSection(this, title, files, isStaged, repoPath);
  }

  refreshGitAndExplorer() {
    return refreshGitAndExplorer(this);
  }

  stageFile(file) {
    return stageFile(this, file);
  }

  stageAll() {
    return stageAll(this);
  }

  unstageFile(file) {
    return unstageFile(this, file);
  }

  unstageAll() {
    return unstageAll(this);
  }

  discardFile(file) {
    return discardFile(this, file);
  }

  discardAll() {
    return discardAll(this);
  }

  loadGitCommits() {
    return loadGitCommits(this);
  }

  openCommitTab(commit) {
    return openCommitTab(this, commit);
  }

  previewDiff(repoPath, file, staged) {
    return previewDiff(this, repoPath, file, staged);
  }

  commitChanges(andPush = false) {
    return commitChanges(this, andPush);
  }

  openDiffTab(file, isStaged, statusCode = "M", commitHash = null) {
    return openDiffTab(this, file, isStaged, statusCode, commitHash);
  }

  // Layout
  toggleSidebar(forceState) {
    return toggleSidebar(this, forceState);
  }

  toggleRightSidebar(forceState) {
    return toggleRightSidebar(this, forceState);
  }

  switchRightPanel(panelName) {
    return switchRightPanel(this, panelName);
  }

  reloadRightSidebar() {
    return reloadRightSidebar(this);
  }

  // Search in Files & Tree Filter
  focusSearch() {
    const sc = getSearchController(this);
    sc?.focusInput();
  }

  openSearchWithScope(scope) {
    if (!this.isRightSidebarOpen) {
      this.toggleRightSidebar(true);
    }
    this.switchRightPanel("search");
    const sc = getSearchController(this);
    if (sc) {
      sc.setIncludeScope(scope);
      sc.focusInput();
    }
  }

  openTreeFilter() {
    if (!this.treeFilter) {
      const treeEl = document.getElementById("rs-files-tree");
      if (treeEl) {
        this.treeFilter = new ExplorerTreeFilter(treeEl, this);
      }
    }
    this.treeFilter?.open();
  }

  closeTreeFilter() {
    this.treeFilter?.close();
  }
}
