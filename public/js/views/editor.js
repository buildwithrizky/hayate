import { tauriInvoke } from "../api.js";
import { escapeHtml } from "../state.js";

// Language helper for PrismJS syntax highlighting
export function getPrismLanguage(filePath) {
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

export function highlightCode(code, lang) {
  if (typeof window !== "undefined" && window.Prism) {
    const grammar = window.Prism.languages[lang] || window.Prism.languages.javascript || window.Prism.languages.plain;
    if (grammar) {
      return window.Prism.highlight(code, grammar, lang);
    }
  }
  return escapeHtml(code);
}

// Pure lightweight Markdown renderer
export function renderMarkdownHtml(mdText) {
  if (!mdText) return "";
  let src = escapeHtml(mdText);

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
      if (idx === 1 && r.some((c) => /^:?-+:?$/.test(c.trim()))) {
        return; // Skip separator line
      }
      const tag = idx === 0 ? "th" : "td";
      tableHtml += "<tr>" + r.map((c) => `<${tag}>${c.trim()}</${tag}>`).join("") + "</tr>";
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

export function mountMarkdownInstance(state, tab) {
  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `view-container-${tab.id}`;
  container.className = "terminal-instance wb-view hidden";
  container.innerHTML = `
    <div class="wb-markdown-bar">
      <div class="wb-bar-meta">
        <span class="tab-type-tag is-markdown">M&darr;</span>
        <span class="wb-bar-path" title="${escapeHtml(tab.filePath || 'Scratchpad')}">${escapeHtml(tab.filePath ? tab.filePath.split('/').pop() : 'Scratchpad.md')}</span>
        <span class="wb-save-status ${tab.isDirty ? 'unsaved' : ''}">${tab.isDirty ? '● Unsaved' : ''}</span>
      </div>
      <div class="wb-bar-actions">
        <button class="btn btn-xs btn-mode-toggle">${tab.isEditMode ? 'View Markdown' : 'Edit Source'}</button>
        <button class="btn btn-xs btn-primary btn-save" title="Save file (Ctrl+S)">Save</button>
      </div>
    </div>
    <div class="wb-markdown-content wb-md-preview" style="${tab.isEditMode ? 'display:none;' : ''}">
      ${renderMarkdownHtml(tab.content || '*Empty markdown document*')}
    </div>
    <div class="wb-editor-body" style="${tab.isEditMode ? 'display:flex;' : 'display:none;'}">
      <div class="wb-line-numbers">1</div>
      <textarea class="wb-textarea" spellcheck="false" placeholder="Write markdown here...">${escapeHtml(tab.content || '')}</textarea>
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
    state.renderTabs();
  });

  textarea.addEventListener("scroll", () => {
    lineNums.scrollTop = textarea.scrollTop;
  });

  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveTabContent(state, tab);
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
      previewEl.innerHTML = renderMarkdownHtml(tab.content || "*Empty markdown document*");
    }
  };

  saveBtn.onclick = () => saveTabContent(state, tab);

  state.viewContainers.set(tab.id, container);
}

export function mountEditorInstance(state, tab) {
  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `view-container-${tab.id}`;
  container.className = "terminal-instance wb-view hidden";
  const lang = getPrismLanguage(tab.filePath);
  container.innerHTML = `
    <div class="wb-editor-bar">
      <div class="wb-bar-meta">
        <span class="tab-type-tag is-editor">&lt;/&gt;</span>
        <span class="wb-bar-path" title="${escapeHtml(tab.filePath || 'Scratch')}">${escapeHtml(tab.filePath ? tab.filePath.split('/').pop() : 'Scratchpad')}</span>
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
        <pre class="wb-highlight-layer"><code class="language-${lang}">${highlightCode(tab.content || '', lang)}</code></pre>
        <textarea class="wb-textarea" spellcheck="false" placeholder="Type code here...">${escapeHtml(tab.content || '')}</textarea>
      </div>
    </div>
  `;
  host.appendChild(container);

  const textarea = container.querySelector(".wb-textarea");
  const highlightCodeEl = container.querySelector(".wb-highlight-layer code");
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
    const currentLang = getPrismLanguage(tab.filePath);
    highlightCodeEl.className = `language-${currentLang}`;
    const codeVal = textarea.value;
    // Preserve trailing newline space so cursor matches
    const paddedVal = codeVal.endsWith("\n") ? codeVal + " " : codeVal;
    highlightCodeEl.innerHTML = highlightCode(paddedVal, currentLang);
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
    state.renderTabs();
  });

  // Indentation, auto-indent & save shortcut
  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveTabContent(state, tab);
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

      const container = state.viewContainers.get(tab.id);
      if (container) {
        const textarea = container.querySelector(".wb-textarea");
        if (textarea) {
          textarea.value = tab.content;
          textarea.dispatchEvent(new Event("input"));
        }
        const preview = container.querySelector(".wb-md-preview");
        if (preview) {
          preview.innerHTML = renderMarkdownHtml(tab.content || "*Empty markdown document*");
        }
      }
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
