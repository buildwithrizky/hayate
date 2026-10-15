import { sendWs } from "../api.js";
import { TERM_THEME, fitTerminal } from "./terminal.js";
import { updateTabAgentStatus } from "../agent-status.js";

export function splitActiveTerminal(state) {
  const tab = state.tabs.find((t) => t.id === state.activeTabId && t.type === "terminal");
  if (!tab) return;

  const mainSession = state.terminalSessions.get(tab.id);
  if (!mainSession) return;

  // If already split, toggle focus to other pane
  if (tab.isSplit && tab.splitId) {
    const nextFocusId = tab.activePaneId === tab.id ? tab.splitId : tab.id;
    focusPane(state, tab, nextFocusId);
    return;
  }

  const container = mainSession.container;
  if (!container) return;

  // Setup DOM structure for split
  container.classList.add("is-split");

  const paneLeft = document.createElement("div");
  paneLeft.className = "terminal-pane is-focused";
  paneLeft.id = `pane-${tab.id}`;

  const resizer = document.createElement("div");
  resizer.className = "resize-handle terminal-split-resizer";

  const splitId = `${tab.id}_split`;
  const paneRight = document.createElement("div");
  paneRight.className = "terminal-pane";
  paneRight.id = `pane-${splitId}`;

  // Move existing term elements into paneLeft
  while (container.firstChild) {
    paneLeft.appendChild(container.firstChild);
  }

  container.appendChild(paneLeft);
  container.appendChild(resizer);
  container.appendChild(paneRight);

  // Initialize split xterm instance
  const TerminalClass = window.Terminal;
  if (!TerminalClass) return;

  const term = new TerminalClass({
    theme: TERM_THEME,
    cursorBlink: false,
    fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Cascadia Code', 'Fira Code', 'Symbols Nerd Font Mono', monospace",
    fontSize: 13,
    lineHeight: 1.25,
    convertEol: false,
    allowTransparency: false,
    macOptionIsMeta: true
  });

  const FitAddonClass = window.FitAddon?.FitAddon || window.FitAddon;
  const fitAddon = FitAddonClass ? new FitAddonClass() : null;
  if (fitAddon) term.loadAddon(fitAddon);

  term.open(paneRight);

  term.onData((data) => {
    sendWs({ action: "input", sessionId: splitId, data });
  });

  term.onTitleChange((title) => {
    updateTabAgentStatus(state, tab.id, title);
  });

  const splitSession = {
    term,
    fitAddon,
    container: paneRight,
    tabId: splitId,
    state,
    lastCols: 0,
    lastRows: 0,
    resizeTimer: null,
    writeBuffer: "",
    flushRafId: null
  };

  state.terminalSessions.set(splitId, splitSession);
  tab.isSplit = true;
  tab.splitId = splitId;
  tab.activePaneId = splitId;

  // Spawn shell in same directory
  const cwd = tab.cwd || tab.repoPath;
  state.spawnBackendShell(splitId, cwd);

  // Focus listeners
  paneLeft.addEventListener("pointerdown", () => focusPane(state, tab, tab.id));
  paneRight.addEventListener("pointerdown", () => focusPane(state, tab, splitId));

  // Resizer drag logic
  setupSplitResizer(resizer, paneLeft, paneRight, state, tab);

  // Initial fit
  requestAnimationFrame(() => {
    fitTerminal(state, tab.id, true);
    fitTerminal(state, splitId, true);
    term.focus();
  });
}

export function focusPane(state, tab, paneId) {
  tab.activePaneId = paneId;
  const container = document.getElementById(`term-container-${tab.id}`);
  if (!container) return;

  container.querySelectorAll(".terminal-pane").forEach((p) => {
    p.classList.toggle("is-focused", p.id === `pane-${paneId}`);
  });

  const session = state.terminalSessions.get(paneId);
  session?.term?.focus();
}

export function closeSplitPane(state, tab) {
  if (!tab || !tab.isSplit || !tab.splitId) return;

  const splitId = tab.splitId;
  const splitSession = state.terminalSessions.get(splitId);
  if (splitSession) {
    try {
      splitSession.term?.dispose();
    } catch {}
    state.terminalSessions.delete(splitId);
  }

  const container = document.getElementById(`term-container-${tab.id}`);
  const paneLeft = document.getElementById(`pane-${tab.id}`);
  const paneRight = document.getElementById(`pane-${splitId}`);

  if (container && paneLeft) {
    // Move elements back to root container
    while (paneLeft.firstChild) {
      container.appendChild(paneLeft.firstChild);
    }
    paneLeft.remove();
    paneRight?.remove();
    container.querySelector(".terminal-split-resizer")?.remove();
    container.classList.remove("is-split");
  }

  tab.isSplit = false;
  tab.splitId = null;
  tab.activePaneId = tab.id;

  fitTerminal(state, tab.id, true);
  state.terminalSessions.get(tab.id)?.term?.focus();
}

function setupSplitResizer(resizer, paneLeft, paneRight, state, tab) {
  let isDragging = false;
  let startX = 0;
  let leftStartWidth = 0;

  const onPointerDown = (e) => {
    isDragging = true;
    startX = e.clientX;
    leftStartWidth = paneLeft.getBoundingClientRect().width;
    resizer.classList.add("is-dragging");
    document.body.classList.add("is-resizing");

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    const newWidth = Math.max(120, leftStartWidth + deltaX);
    paneLeft.style.flex = "none";
    paneLeft.style.width = `${newWidth}px`;
    fitTerminal(state, tab.id);
    if (tab.splitId) fitTerminal(state, tab.splitId);
  };

  const onPointerUp = () => {
    if (!isDragging) return;
    isDragging = false;
    resizer.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing");

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);

    fitTerminal(state, tab.id, true);
    if (tab.splitId) fitTerminal(state, tab.splitId, true);
  };

  resizer.addEventListener("pointerdown", onPointerDown);
}
