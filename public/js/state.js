import { initPty, sendWs, handleBackendMessage, spawnBackendShell } from "./api.js";
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
  restartActiveTab,
  clearActiveTab,
  sendInputToActive,
  renderTabs,
  renderStatusBadge,
  renderCwd
} from "./tabs.js";
import { mountTerminalInstance, fitTerminal } from "./views/terminal.js";
import { mountBrowserInstance } from "./views/browser.js";
import {
  mountEditorInstance,
  mountMarkdownInstance,
  loadFileForTab,
  saveTabContent,
  getPrismLanguage,
  highlightCode,
  renderMarkdownHtml
} from "./views/editor.js";
import { mountDiffInstance, loadDiffForTab, renderDiffTableHtml } from "./views/diff.js";
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
  previewFile
} from "./explorer.js";
import {
  fetchGitStatusData,
  loadGitStatus,
  expandGitItems,
  collectFilesRecursively,
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
  reloadRightSidebar,
  updateStatusbar,
  loadSystemStatus,
  startSystemStatusLoop
} from "./layout.js";

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

    this.unlistenPty = null;

    // session id -> { term, fitAddon, container, resizeObserver, windowPasteHandler }
    this.terminalSessions = new Map();
    // tab id -> container element for non-terminal views (browser, markdown, editor, diff)
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

  closeTab(tabId) {
    return closeTab(this, tabId);
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

  // Views - Terminal
  mountTerminalInstance(tab) {
    return mountTerminalInstance(this, tab);
  }

  fitTerminal(sessionId) {
    return fitTerminal(this, sessionId);
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

  renderDiffTableHtml(rawDiff) {
    return renderDiffTableHtml(rawDiff);
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

  openFileInWorkbench(filePath) {
    return openFileInWorkbench(this, filePath);
  }

  previewFile(filePath) {
    return previewFile(this, filePath);
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

  collectFilesRecursively(repoPath, relDir) {
    return collectFilesRecursively(this, repoPath, relDir);
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

  commitChanges() {
    return commitChanges(this);
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

  updateStatusbar() {
    return updateStatusbar(this);
  }

  loadSystemStatus() {
    return loadSystemStatus(this);
  }

  startSystemStatusLoop() {
    return startSystemStatusLoop(this);
  }
}
