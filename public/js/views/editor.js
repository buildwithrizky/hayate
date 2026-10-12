if (typeof window !== "undefined") {
  window.MonacoEnvironment = {
    getWorkerUrl: () => "/vendor/monaco/editor.worker.js"
  };
}

import { monaco } from "../../vendor/monaco/monaco.js";
import { tauriInvoke } from "../api.js";
import { escapeHtml } from "../state.js";
import { renderMarkdownHtml } from "./markdown.js";

export { renderMarkdownHtml };

// Map tabId -> monaco.editor.IStandaloneCodeEditor
const editorInstances = new Map();

export function getMonacoLanguage(filePath) {
  if (!filePath) return "javascript";
  const name = filePath.split("/").pop().toLowerCase();
  if (name === "dockerfile" || name.endsWith(".dockerfile")) return "dockerfile";

  const ext = filePath.split(".").pop().toLowerCase();
  const map = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    json: "json",
    json5: "json",
    html: "html",
    htm: "html",
    svg: "html",
    css: "css",
    scss: "css",
    less: "css",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    rs: "rust",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    sql: "sql",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    ini: "ini",
    go: "go",
    cpp: "cpp",
    cc: "cpp",
    c: "cpp",
    h: "cpp",
    hpp: "cpp",
    dockerfile: "dockerfile"
  };
  return map[ext] || "plaintext";
}

// Backward compatibility Prism helper
export function getPrismLanguage(filePath) {
  return getMonacoLanguage(filePath);
}

export function highlightCode(code) {
  return escapeHtml(code);
}

export function getEditorInstance(tabId) {
  return editorInstances.get(tabId) || null;
}

export function disposeEditorInstance(tabId) {
  const editor = editorInstances.get(tabId);
  if (editor) {
    const model = editor.getModel();
    editor.dispose();
    if (model) {
      model.dispose();
    }
    editorInstances.delete(tabId);
  }
}

export function getWorkspaceRelativePath(state, filePath) {
  if (!filePath) return "";
  const ws = state?.getActiveWorkspace?.();
  const wsPath = ws?.path;
  if (wsPath) {
    if (filePath === wsPath) return filePath;
    const prefix = wsPath.endsWith("/") || wsPath.endsWith("\\") ? wsPath : `${wsPath}/`;
    if (filePath.startsWith(prefix)) return filePath.slice(prefix.length);
    const prefixWin = wsPath.replace(/\//g, "\\") + "\\";
    if (filePath.startsWith(prefixWin)) return filePath.slice(prefixWin.length);
  }
  return filePath;
}

const ICON_SAVE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
const ICON_CLOSE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_EYE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_CODE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';

export function mountMarkdownInstance(state, tab) {
  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `view-container-${tab.id}`;
  container.className = "terminal-instance wb-view hidden";
  container.innerHTML = `
    <div class="wb-markdown-bar">
      <div class="wb-bar-meta">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="wb-bar-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <span class="wb-bar-path" title="${escapeHtml(tab.filePath || 'Scratchpad')}">${escapeHtml(tab.filePath ? getWorkspaceRelativePath(state, tab.filePath) : 'Scratchpad.md')}</span>
        <span class="wb-save-status ${tab.isDirty ? 'unsaved' : ''}">${tab.isDirty ? '● Unsaved' : ''}</span>
      </div>
      <div class="wb-bar-actions">
        <button class="btn btn-icon btn-xs btn-mode-toggle" title="${tab.isEditMode ? 'View Markdown' : 'Edit Source'}">${tab.isEditMode ? ICON_EYE : ICON_CODE}</button>
        <button class="btn btn-icon btn-xs btn-save" title="Save file (Ctrl+S / Cmd+S)">${ICON_SAVE}</button>
        <button class="btn btn-icon btn-xs btn-close" title="Close tab">${ICON_CLOSE}</button>
      </div>
    </div>
    <div class="wb-markdown-content wb-md-preview" style="${tab.isEditMode ? 'display:none;' : ''}">
      ${renderMarkdownHtml(tab.content || '*Empty markdown document*')}
    </div>
    <div class="wb-monaco-host wb-md-editor-host" style="${tab.isEditMode ? 'display:block;' : 'display:none;'}"></div>
  `;
  host.appendChild(container);

  const previewEl = container.querySelector(".wb-markdown-content");
  const editorHost = container.querySelector(".wb-md-editor-host");
  const toggleBtn = container.querySelector(".btn-mode-toggle");
  const saveBtn = container.querySelector(".btn-save");
  const closeBtn = container.querySelector(".btn-close");
  const statusEl = container.querySelector(".wb-save-status");

  const editor = monaco.editor.create(editorHost, {
    value: tab.content || "",
    language: "markdown",
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    tabSize: 2,
    scrollBeyondLastLine: false
  });

  editorInstances.set(tab.id, editor);

  editor.onDidChangeModelContent(() => {
    const wasDirty = tab.isDirty;
    tab.content = editor.getValue();
    tab.isDirty = tab.content !== tab.savedContent;
    statusEl.textContent = tab.isDirty ? "● Unsaved" : "";
    statusEl.className = `wb-save-status ${tab.isDirty ? 'unsaved' : ''}`;
    if (wasDirty !== tab.isDirty) {
      state.renderTabs();
    }
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    saveTabContent(state, tab);
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
    editor.trigger("workbench", "editor.action.quickCommand");
  });

  toggleBtn.onclick = () => {
    tab.isEditMode = !tab.isEditMode;
    if (tab.isEditMode) {
      toggleBtn.title = "View Markdown";
      toggleBtn.innerHTML = ICON_EYE;
      previewEl.style.display = "none";
      editorHost.style.display = "block";
      if (editor.getValue() !== tab.content) {
        editor.setValue(tab.content || "");
      }
      editor.layout();
      editor.focus();
    } else {
      toggleBtn.title = "Edit Source";
      toggleBtn.innerHTML = ICON_CODE;
      editorHost.style.display = "none";
      previewEl.style.display = "block";
      previewEl.innerHTML = renderMarkdownHtml(tab.content || "*Empty markdown document*");
    }
  };

  saveBtn.onclick = () => saveTabContent(state, tab);
  if (closeBtn) closeBtn.onclick = () => state.closeTab(tab.id);

  state.viewContainers.set(tab.id, container);
}

export function mountEditorInstance(state, tab) {
  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `view-container-${tab.id}`;
  container.className = "terminal-instance wb-view hidden";
  const lang = getMonacoLanguage(tab.filePath);

  container.innerHTML = `
    <div class="wb-editor-bar">
      <div class="wb-bar-meta">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="wb-bar-icon"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        <span class="wb-bar-path" title="${escapeHtml(tab.filePath || 'Scratch')}">${escapeHtml(tab.filePath ? getWorkspaceRelativePath(state, tab.filePath) : 'Scratchpad')}</span>
        <span class="wb-save-status ${tab.isDirty ? 'unsaved' : ''}">${tab.isDirty ? '● Unsaved' : ''}</span>
      </div>
      <div class="wb-bar-actions">
        <button class="btn btn-icon btn-xs btn-save" title="Save file (Ctrl+S / Cmd+S)">${ICON_SAVE}</button>
        <button class="btn btn-icon btn-xs btn-close" title="Close tab">${ICON_CLOSE}</button>
      </div>
    </div>
    <div class="wb-monaco-host"></div>
  `;
  host.appendChild(container);

  const editorHost = container.querySelector(".wb-monaco-host");
  const saveBtn = container.querySelector(".btn-save");
  const closeBtn = container.querySelector(".btn-close");
  const statusEl = container.querySelector(".wb-save-status");

  const editor = monaco.editor.create(editorHost, {
    value: tab.content || "",
    language: lang,
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    tabSize: 2,
    scrollBeyondLastLine: false
  });

  editorInstances.set(tab.id, editor);

  editor.onDidChangeModelContent(() => {
    const wasDirty = tab.isDirty;
    tab.content = editor.getValue();
    tab.isDirty = tab.content !== tab.savedContent;
    statusEl.textContent = tab.isDirty ? "● Unsaved" : "";
    statusEl.className = `wb-save-status ${tab.isDirty ? 'unsaved' : ''}`;
    if (wasDirty !== tab.isDirty) {
      state.renderTabs();
    }
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    saveTabContent(state, tab);
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
    editor.trigger("workbench", "editor.action.quickCommand");
  });

  saveBtn.onclick = () => saveTabContent(state, tab);
  closeBtn.onclick = () => state.closeTab(tab.id);

  state.viewContainers.set(tab.id, container);
}

export async function loadFileForTab(state, tab) {
  if (!tab.filePath) return;
  try {
    const data = await tauriInvoke("get_file_content", { path: tab.filePath });
    if (data && data.content !== undefined) {
      tab.content = data.content;
      tab.savedContent = data.content;
      tab.isDirty = false;

      const editor = editorInstances.get(tab.id);
      if (editor) {
        if (editor.getValue() !== tab.content) {
          editor.setValue(tab.content);
        }
        const model = editor.getModel();
        if (model && tab.type !== "markdown") {
          const lang = getMonacoLanguage(tab.filePath);
          monaco.editor.setModelLanguage(model, lang);
        }
      }

      const container = state.viewContainers.get(tab.id);
      if (container) {
        const statusEl = container.querySelector(".wb-save-status");
        if (statusEl) {
          statusEl.textContent = "";
          statusEl.className = "wb-save-status";
        }
        const preview = container.querySelector(".wb-md-preview");
        if (preview) {
          preview.innerHTML = renderMarkdownHtml(tab.content || "*Empty markdown document*");
        }
      }
      state.renderTabs();
    }
  } catch (e) {
    console.error("Failed to load file content for tab", e);
  }
}

export async function saveTabContent(state, tab) {
  if (!tab.filePath) {
    const defaultName = tab.type === "markdown" ? "untitled.md" : "untitled.txt";
    const ws = state.getActiveWorkspace();
    const basePath = ws ? ws.path : "";
    const pathPrompt = prompt("Save file as full path:", basePath ? `${basePath}/${defaultName}` : defaultName);
    if (!pathPrompt) return;
    tab.filePath = pathPrompt.trim();
    tab.title = tab.filePath.split("/").pop();

    const editor = editorInstances.get(tab.id);
    if (editor && tab.type !== "markdown") {
      const model = editor.getModel();
      if (model) {
        monaco.editor.setModelLanguage(model, getMonacoLanguage(tab.filePath));
      }
    }
  }

  try {
    await tauriInvoke("save_file_content", {
      path: tab.filePath,
      content: tab.content
    });
    tab.savedContent = tab.content;
    tab.isDirty = false;

    const container = state.viewContainers.get(tab.id);
    if (container) {
      const statusEl = container.querySelector(".wb-save-status");
      if (statusEl) {
        statusEl.textContent = "Saved ✓";
        statusEl.className = "wb-save-status saved";
        setTimeout(() => {
          if (!tab.isDirty && statusEl) {
            statusEl.textContent = "";
          }
        }, 2000);
      }
      const titlePathEl = container.querySelector(".wb-bar-path");
      if (titlePathEl && tab.filePath) {
        titlePathEl.textContent = getWorkspaceRelativePath(state, tab.filePath);
        titlePathEl.title = tab.filePath;
      }
    }
    state.renderTabs();
    state.fetchGitStatusData().then(() => {
      if (state.activeRightPanel === "explorer") {
        state.loadExplorer();
      } else {
        state.loadGitStatus();
      }
    });
  } catch (err) {
    alert("Save error: " + String(err));
  }
}
