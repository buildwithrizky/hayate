import { searchInFiles } from "./api.js";
import { escapeHtml } from "./state.js";
import { openFileInWorkbench } from "./explorer.js";

export class SearchController {
  constructor(state) {
    this.state = state;
    this.caseSensitive = false;
    this.matchWholeWord = false;
    this.useRegex = false;
    this.currentQuery = "";
    this.includePattern = "";
    this.results = [];
    this.collapsedFiles = new Set();
    this.isSearching = false;
    this.debounceTimer = null;
    this.renderToken = 0;
  }

  init() {
    this.queryInput = document.getElementById("rs-search-query");
    this.includeInput = document.getElementById("rs-search-include");
    this.caseBtn = document.getElementById("rs-search-case");
    this.wordBtn = document.getElementById("rs-search-word");
    this.regexBtn = document.getElementById("rs-search-regex");
    this.resultsContainer = document.getElementById("rs-search-results");
    this.countBadge = document.getElementById("rs-search-count-badge");
    this.clearBtn = document.getElementById("rs-search-clear");
    this.refreshBtn = document.getElementById("rs-search-refresh");

    this.bindEvents();
  }

  bindEvents() {
    this.queryInput?.addEventListener("input", () => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.executeSearch(), 250);
    });

    this.queryInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(this.debounceTimer);
        this.executeSearch();
      }
    });

    this.includeInput?.addEventListener("input", () => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.executeSearch(), 300);
    });

    this.caseBtn?.addEventListener("click", () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseBtn.classList.toggle("active", this.caseSensitive);
      this.executeSearch();
    });

    this.wordBtn?.addEventListener("click", () => {
      this.matchWholeWord = !this.matchWholeWord;
      this.wordBtn.classList.toggle("active", this.matchWholeWord);
      this.executeSearch();
    });

    this.regexBtn?.addEventListener("click", () => {
      this.useRegex = !this.useRegex;
      this.regexBtn.classList.toggle("active", this.useRegex);
      this.executeSearch();
    });

    this.clearBtn?.addEventListener("click", () => {
      if (this.queryInput) this.queryInput.value = "";
      if (this.includeInput) this.includeInput.value = "";
      this.results = [];
      this.renderResults();
    });

    this.refreshBtn?.addEventListener("click", () => this.executeSearch());
  }

  focusInput() {
    this.queryInput?.focus();
    this.queryInput?.select();
  }

  setIncludeScope(scopePath) {
    if (this.includeInput) {
      this.includeInput.value = scopePath;
    }
  }

  async executeSearch() {
    const ws = this.state.getActiveWorkspace();
    const query = this.queryInput ? this.queryInput.value.trim() : "";
    this.currentQuery = query;

    if (!ws || !query) {
      this.results = [];
      this.renderResults();
      return;
    }

    const include = this.includeInput ? this.includeInput.value.trim() : "";
    this.isSearching = true;
    this.renderLoading();

    try {
      const items = await searchInFiles({
        rootPath: ws.path,
        query,
        caseSensitive: this.caseSensitive,
        matchWholeWord: this.matchWholeWord,
        useRegex: this.useRegex,
        includePattern: include || null,
        maxResults: 2000
      });
      this.results = Array.isArray(items) ? items : [];
    } catch (err) {
      console.error("Search failed:", err);
      this.results = [];
      if (this.resultsContainer) {
        this.resultsContainer.innerHTML = `<div class="rs-search-msg error">${escapeHtml(String(err))}</div>`;
      }
      return;
    } finally {
      this.isSearching = false;
    }

    this.renderResults();
  }

  renderLoading() {
    if (this.resultsContainer) {
      this.resultsContainer.innerHTML = `<div class="rs-search-msg">Searching...</div>`;
    }
  }

  renderResults() {
    if (!this.resultsContainer) return;

    if (!this.currentQuery) {
      this.resultsContainer.innerHTML = `<div class="rs-search-msg">Type a query to search across files</div>`;
      if (this.countBadge) {
        this.countBadge.textContent = "0";
        this.countBadge.style.display = "var(--display-none)";
      }
      return;
    }

    if (this.countBadge) {
      this.countBadge.textContent = String(this.results.length);
      this.countBadge.style.display = "var(--display-inline-flex)";
    }

    if (!this.results.length) {
      this.resultsContainer.innerHTML = `<div class="rs-search-msg">No results found</div>`;
      if (this.countBadge) this.countBadge.textContent = "0";
      return;
    }

    if (this.countBadge) {
      this.countBadge.textContent = String(this.results.length);
    }

    const currentToken = ++this.renderToken;
    this.resultsContainer.innerHTML = "";

    // Group items by file path
    const fileGroups = new Map();
    for (const item of this.results) {
      if (!fileGroups.has(item.path)) {
        fileGroups.set(item.path, {
          path: item.path,
          relative_path: item.relative_path,
          matches: []
        });
      }
      fileGroups.get(item.path).matches.push(item);
    }

    const groups = Array.from(fileGroups.values());
    const BATCH_SIZE = 40;
    let index = 0;

    // ponytail: chunked rendering with requestAnimationFrame prevents UI freeze; upgrade to virtual list if >10k items
    const renderChunk = () => {
      if (this.renderToken !== currentToken) return;

      const fragment = document.createDocumentFragment();
      const end = Math.min(index + BATCH_SIZE, groups.length);

      for (let i = index; i < end; i++) {
        fragment.appendChild(this.createGroupElement(groups[i]));
      }

      this.resultsContainer.appendChild(fragment);
      index = end;

      if (index < groups.length) {
        requestAnimationFrame(renderChunk);
      }
    };

    renderChunk();
  }

  createGroupElement(group) {
    const isCollapsed = this.collapsedFiles.has(group.path);
    const groupEl = document.createElement("div");
    groupEl.className = `rs-search-file-group ${isCollapsed ? "collapsed" : ""}`;

    const headerEl = document.createElement("div");
    headerEl.className = "rs-search-file-header";
    headerEl.title = group.path;

    const chevronIcon = `<svg class="rs-search-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    const fileName = group.relative_path.split("/").pop() || group.relative_path;
    const fileDir = group.relative_path.includes("/") ? group.relative_path.substring(0, group.relative_path.lastIndexOf("/")) : "";

    headerEl.innerHTML = `
      <span class="rs-search-toggle">${chevronIcon}</span>
      <span class="rs-search-filename">${escapeHtml(fileName)}</span>
      <span class="rs-search-filedir">${escapeHtml(fileDir)}</span>
      <span class="rs-badge">${group.matches.length}</span>
    `;

    headerEl.addEventListener("click", () => {
      if (this.collapsedFiles.has(group.path)) {
        this.collapsedFiles.delete(group.path);
        groupEl.classList.remove("collapsed");
      } else {
        this.collapsedFiles.add(group.path);
        groupEl.classList.add("collapsed");
      }
    });

    const listEl = document.createElement("div");
    listEl.className = "rs-search-match-list";

    group.matches.forEach((m) => {
      const itemEl = document.createElement("div");
      itemEl.className = "rs-search-match-item";
      if (m.is_file_match) {
        itemEl.innerHTML = `
          <span class="rs-search-lineno rs-file-match-tag">file</span>
          <span class="rs-search-snippet">${this.highlightSnippet(m.line_content, m.match_start, m.match_end)}</span>
        `;
        itemEl.addEventListener("click", () => {
          openFileInWorkbench(this.state, m.path, 1);
        });
      } else {
        itemEl.innerHTML = `
          <span class="rs-search-lineno">${m.line_number}</span>
          <span class="rs-search-snippet">${this.highlightSnippet(m.line_content, m.match_start, m.match_end)}</span>
        `;
        itemEl.addEventListener("click", () => {
          openFileInWorkbench(this.state, m.path, m.line_number);
        });
      }

      listEl.appendChild(itemEl);
    });

    groupEl.appendChild(headerEl);
    groupEl.appendChild(listEl);
    return groupEl;
  }

  highlightSnippet(content, start, end) {
    const raw = content || "";
    const safeStart = Math.min(start, raw.len ? raw.len : raw.length);
    const safeEnd = Math.min(Math.max(end, safeStart), raw.length);

    const before = escapeHtml(raw.slice(0, safeStart));
    const matched = escapeHtml(raw.slice(safeStart, safeEnd));
    const after = escapeHtml(raw.slice(safeEnd));

    return `${before}<mark class="rs-search-hl">${matched}</mark>${after}`;
  }
}

let searchInstance = null;
export function getSearchController(state) {
  if (!searchInstance && state) {
    searchInstance = new SearchController(state);
    searchInstance.init();
  }
  return searchInstance;
}
