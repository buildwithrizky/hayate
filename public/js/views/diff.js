import { monaco } from "../../vendor/monaco/monaco.js";
import { getMonacoLanguage } from "./editor.js";
import { tauriInvoke } from "../api.js";
import { escapeHtml } from "../state.js";

// Tab ID -> Monaco DiffEditor instance
const diffEditorInstances = new Map();

export function getDiffEditorInstance(tabId) {
  return diffEditorInstances.get(tabId);
}

export function disposeDiffInstance(tabId) {
  const instance = diffEditorInstances.get(tabId);
  if (!instance) return;
  const model = instance.getModel();
  if (model) {
    model.original?.dispose();
    model.modified?.dispose();
  }
  instance.dispose();
  diffEditorInstances.delete(tabId);
}

async function fetchOriginalContent(tab) {
  if (tab.gitStatusCode === "U") return "";
  if (tab.isStaged) {
    try {
      return await tauriInvoke("git_show_file", {
        repoPath: tab.repoPath,
        spec: `:${tab.diffFile}`
      });
    } catch {
      return "";
    }
  }
  if (tab.commitHash) {
    try {
      return await tauriInvoke("git_show_file", {
        repoPath: tab.repoPath,
        spec: `${tab.commitHash}~1:${tab.diffFile}`
      });
    } catch {
      return "";
    }
  }
  // Working tree
  try {
    return await tauriInvoke("git_show_file", {
      repoPath: tab.repoPath,
      spec: `HEAD:${tab.diffFile}`
    });
  } catch {
    return "";
  }
}

async function fetchModifiedContent(tab) {
  if (tab.gitStatusCode === "D") return "";
  if (tab.commitHash) {
    try {
      return await tauriInvoke("git_show_file", {
        repoPath: tab.repoPath,
        spec: `${tab.commitHash}:${tab.diffFile}`
      });
    } catch {
      return "";
    }
  }
  if (!tab.filePath) return "";
  try {
    const data = await tauriInvoke("get_file_content", { path: tab.filePath });
    return data?.content || "";
  } catch {
    return "";
  }
}

async function saveModifiedContent(state, tab, content) {
  if (!tab.filePath) return;
  try {
    await tauriInvoke("save_file_content", {
      path: tab.filePath,
      content
    });
    tab.isDirty = false;
    tab.content = content;
    tab.savedContent = content;
    const container = state.viewContainers.get(tab.id);
    const statusEl = container?.querySelector(".wb-save-status");
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.className = "wb-save-status";
    }
    state.renderTabs?.();
  } catch (err) {
    alert(`Failed to save: ${err}`);
  }
}

export async function loadDiffForTab(state, tab) {
  const container = state.viewContainers.get(tab.id);
  if (!container) return;
  const editorHost = container.querySelector(".wb-monaco-diff-host");
  if (!editorHost) return;

  const isReadOnly = Boolean(tab.commitHash || tab.isStaged || tab.gitStatusCode === "D");
  const lang = getMonacoLanguage(tab.filePath || tab.diffFile || "");

  try {
    const [originalContent, modifiedContent] = await Promise.all([
      fetchOriginalContent(tab),
      fetchModifiedContent(tab)
    ]);

    // Cleanup previous instance if re-loading
    disposeDiffInstance(tab.id);

    const diffEditor = monaco.editor.createDiffEditor(editorHost, {
      renderSideBySide: false,
      theme: "vs-dark",
      automaticLayout: true,
      readOnly: isReadOnly,
      originalEditable: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2
    });

    const originalUri = monaco.Uri.parse(`diff://original/${tab.id}/${tab.diffFile || "orig"}`);
    const modifiedUri = monaco.Uri.parse(`diff://modified/${tab.id}/${tab.diffFile || "mod"}`);

    const originalModel = monaco.editor.createModel(originalContent, lang, originalUri);
    const modifiedModel = monaco.editor.createModel(modifiedContent, lang, modifiedUri);

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel
    });

    diffEditorInstances.set(tab.id, diffEditor);

    const modifiedEditor = diffEditor.getModifiedEditor();
    const statusEl = container.querySelector(".wb-save-status");

    if (!isReadOnly) {
      tab.savedContent = modifiedContent;
      tab.content = modifiedContent;

      modifiedModel.onDidChangeContent(() => {
        const val = modifiedModel.getValue();
        const wasDirty = tab.isDirty;
        tab.content = val;
        tab.isDirty = val !== tab.savedContent;
        if (statusEl) {
          statusEl.textContent = tab.isDirty ? "● Unsaved" : "";
          statusEl.className = `wb-save-status ${tab.isDirty ? "unsaved" : ""}`;
        }
        if (wasDirty !== tab.isDirty) {
          state.renderTabs?.();
        }
      });

      modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveModifiedContent(state, tab, modifiedModel.getValue());
      });
    }
  } catch (err) {
    editorHost.innerHTML = `<div class="wb-diff-clean">Failed to load diff: ${escapeHtml(String(err))}</div>`;
  }
}

const ICON_CODE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
const ICON_CLOSE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

export function mountDiffInstance(state, tab) {
  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `view-container-${tab.id}`;
  container.className = "terminal-instance wb-view hidden";

  const isDeleted = tab.gitStatusCode === "D";

  container.innerHTML = `
    <div class="wb-diff-bar">
      <div class="wb-bar-meta">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="wb-bar-icon"><path d="M16 3h5v5"/><path d="m21 3-7 7"/><path d="M8 21H3v-5"/><path d="m3 21 7-7"/></svg>
        <span class="wb-bar-path" title="${escapeHtml(tab.filePath || tab.diffFile || "")}">${escapeHtml(tab.diffFile || tab.filePath || "")}</span>
        <span class="wb-save-status ${tab.isDirty ? "unsaved" : ""}">${tab.isDirty ? "● Unsaved" : ""}</span>
      </div>
      <div class="wb-bar-actions">
        ${!isDeleted && tab.filePath ? `<button class="btn btn-icon btn-xs btn-open-editor" title="Open in Editor">${ICON_CODE}</button>` : ""}
        <button class="btn btn-icon btn-xs btn-close" title="Close tab">${ICON_CLOSE}</button>
      </div>
    </div>
    <div class="wb-monaco-diff-host"></div>
  `;
  host.appendChild(container);

  const closeBtn = container.querySelector(".btn-close");
  const openEditorBtn = container.querySelector(".btn-open-editor");
  if (closeBtn) closeBtn.onclick = () => state.closeTab(tab.id);
  if (openEditorBtn) {
    openEditorBtn.onclick = () => {
      if (tab.filePath) state.openFileInWorkbench(tab.filePath);
    };
  }

  state.viewContainers.set(tab.id, container);
  loadDiffForTab(state, tab);
}
