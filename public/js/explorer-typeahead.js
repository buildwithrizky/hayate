export class ExplorerTypeahead {
  constructor(treeEl, navInstance) {
    this.treeEl = treeEl;
    this.nav = navInstance;
    this.buffer = "";
    this.timer = null;
  }

  handleKeyDown(e) {
    // Ignore special keys, control/meta modifiers, function keys
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return false;

    clearTimeout(this.timer);
    this.buffer += e.key.toLowerCase();
    this.timer = setTimeout(() => {
      this.buffer = "";
    }, 600);

    const rows = this.nav.getVisibleRows();
    if (!rows.length) return false;

    const matchedRow = rows.find((row) => {
      const nameEl = row.querySelector(".rs-file-name");
      const name = (nameEl ? nameEl.textContent : "").trim().toLowerCase();
      return name.startsWith(this.buffer);
    });

    if (matchedRow) {
      const p = matchedRow.getAttribute("data-path");
      this.nav.focusPath(p);
      return true;
    }

    return false;
  }
}
