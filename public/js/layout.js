import { tauriInvoke } from "./api.js";

export function toggleSidebar(state, forceState) {
  const sb = document.getElementById("sidebar");
  if (!sb) return;
  if (typeof forceState === "boolean") {
    state.isSidebarOpen = forceState;
    sb.classList.toggle("collapsed", !forceState);
  } else {
    sb.classList.toggle("collapsed");
    state.isSidebarOpen = !sb.classList.contains("collapsed");
  }
  const sbResizer = document.getElementById("sidebar-resizer");
  if (sbResizer) {
    sbResizer.classList.toggle("is-hidden", sb.classList.contains("collapsed"));
  }
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
    if (state.activeTabId) state.fitTerminal(state.activeTabId);
  }, 180);
}

export function toggleRightSidebar(state, forceState) {
  const rs = document.getElementById("right-sidebar");
  if (!rs) return;

  if (typeof forceState === "boolean") {
    state.isRightSidebarOpen = forceState;
  } else {
    state.isRightSidebarOpen = !state.isRightSidebarOpen;
  }
  if (state.isRightSidebarOpen) {
    rs.classList.remove("collapsed");
  } else {
    rs.classList.add("collapsed");
  }
  const rsResizer = document.getElementById("right-sidebar-resizer");
  if (rsResizer) {
    rsResizer.classList.toggle("is-hidden", !state.isRightSidebarOpen);
  }
  // Trigger window resize and terminal fit after layout transition
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
    if (state.activeTabId) state.fitTerminal(state.activeTabId);
  }, 200);
}

export function switchRightPanel(state, panelName) {
  state.activeRightPanel = panelName;
  const tabExplorer = document.getElementById("rs-tab-explorer");
  const tabGit = document.getElementById("rs-tab-git");
  const panelExplorer = document.getElementById("rs-panel-explorer");
  const panelGit = document.getElementById("rs-panel-git");

  if (panelName === "explorer") {
    tabExplorer?.classList.add("active");
    tabGit?.classList.remove("active");
    panelExplorer?.classList.add("active");
    panelGit?.classList.remove("active");
    state.loadExplorer();
  } else {
    tabExplorer?.classList.remove("active");
    tabGit?.classList.add("active");
    panelExplorer?.classList.remove("active");
    panelGit?.classList.add("active");
    state.loadGitStatus();
  }
}

export function reloadRightSidebar(state) {
  const ws = state.getActiveWorkspace();
  const wsNameEl = document.getElementById("rs-ws-name");
  if (wsNameEl) {
    wsNameEl.textContent = ws ? ws.name : "-";
    wsNameEl.title = ws ? ws.path : "";
  }
  // Refresh git status so status badges stay in sync
  state.fetchGitStatusData().then(() => {
    updateStatusbar(state);
    if (state.activeRightPanel === "explorer") {
      state.loadExplorer();
    } else {
      state.loadGitStatus();
    }
  });
}

export function updateStatusbar(state) {
  const ws = state.getActiveWorkspace();
  const wsEl = document.getElementById("sb-ws-status");
  const gitEl = document.getElementById("sb-git-branch");

  if (wsEl) {
    wsEl.textContent = ws ? ws.name : "No workspace";
    wsEl.title = ws ? ws.path : "";
  }

  if (gitEl) {
    if (!ws) {
      gitEl.textContent = "Git: -";
    } else if (state.gitStatusData?.branch) {
      gitEl.textContent = `Git: ${state.gitStatusData.branch}`;
    } else {
      gitEl.textContent = "Git: -";
    }
  }
}

export async function loadSystemStatus(state) {
  const portEl = document.getElementById("sb-active-port");
  const ramEl = document.getElementById("sb-system-ram");

  try {
    const data = await tauriInvoke("get_system_status");
    if (data) {
      if (portEl) {
        portEl.textContent = `⚡ Tauri IPC`;
      }
      if (ramEl) {
        ramEl.textContent = `🧠 RAM: ${data.processRssMb} MB | System: ${data.systemUsedGb} / ${data.systemTotalGb} GB (${data.systemPercent}%)`;
      }
      return;
    }
  } catch {}

  if (portEl) portEl.textContent = `⚡ Tauri IPC`;
}

export function startSystemStatusLoop(state) {
  loadSystemStatus(state);
  setInterval(() => {
    loadSystemStatus(state);
  }, 4000);
}

export function setupSidebarResizers(app) {
  const STORAGE_KEY_LEFT = "hayate_sidebar_left_width";
  const STORAGE_KEY_RIGHT = "hayate_sidebar_right_width";
  const DEFAULT_LEFT_WIDTH = 260;
  const DEFAULT_RIGHT_WIDTH = 320;
  const MIN_LEFT = 180;
  const MIN_RIGHT = 240;

  const leftSidebar = document.getElementById("sidebar");
  const rightSidebar = document.getElementById("right-sidebar");
  const leftResizer = document.getElementById("sidebar-resizer");
  const rightResizer = document.getElementById("right-sidebar-resizer");

  // Restore saved widths from localStorage
  const savedLeft = localStorage.getItem(STORAGE_KEY_LEFT);
  if (savedLeft && leftSidebar) {
    const w = parseInt(savedLeft, 10);
    if (!isNaN(w) && w >= MIN_LEFT && w <= 700) {
      leftSidebar.style.width = `${w}px`;
    }
  }

  const savedRight = localStorage.getItem(STORAGE_KEY_RIGHT);
  if (savedRight && rightSidebar) {
    const w = parseInt(savedRight, 10);
    if (!isNaN(w) && w >= MIN_RIGHT && w <= 900) {
      rightSidebar.style.width = `${w}px`;
    }
  }

  const syncVisibility = () => {
    if (leftResizer && leftSidebar) {
      leftResizer.classList.toggle("is-hidden", leftSidebar.classList.contains("collapsed"));
    }
    if (rightResizer && rightSidebar) {
      rightResizer.classList.toggle("is-hidden", rightSidebar.classList.contains("collapsed"));
    }
  };

  syncVisibility();

  const attachResizer = (resizer, isLeft) => {
    if (!resizer) return;

    let startX = 0;
    let startWidth = 0;
    let isDragging = false;
    let rafId = null;

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      const targetSidebar = isLeft ? leftSidebar : rightSidebar;
      if (!targetSidebar || targetSidebar.classList.contains("collapsed")) return;

      isDragging = true;
      startX = e.clientX;
      startWidth = targetSidebar.getBoundingClientRect().width;

      resizer.setPointerCapture?.(e.pointerId);
      resizer.classList.add("is-dragging");
      document.body.classList.add("is-resizing");
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const targetSidebar = isLeft ? leftSidebar : rightSidebar;
      if (!targetSidebar) return;

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const delta = isLeft ? (e.clientX - startX) : (startX - e.clientX);
        const newRawWidth = startWidth + delta;
        const maxAllowed = isLeft
          ? Math.max(MIN_LEFT, Math.min(600, window.innerWidth - 300))
          : Math.max(MIN_RIGHT, Math.min(800, window.innerWidth - 300));
        const minAllowed = isLeft ? MIN_LEFT : MIN_RIGHT;

        const clamped = Math.max(minAllowed, Math.min(maxAllowed, newRawWidth));
        targetSidebar.style.width = `${clamped}px`;

        if (app?.activeTabId) {
          app.fitTerminal(app.activeTabId);
        }
      });
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;

      if (rafId) cancelAnimationFrame(rafId);
      resizer.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing");

      try {
        resizer.releasePointerCapture?.(e.pointerId);
      } catch (_) {}

      const targetSidebar = isLeft ? leftSidebar : rightSidebar;
      if (targetSidebar) {
        const currentWidth = Math.round(targetSidebar.getBoundingClientRect().width);
        localStorage.setItem(isLeft ? STORAGE_KEY_LEFT : STORAGE_KEY_RIGHT, currentWidth.toString());
      }

      window.dispatchEvent(new Event("resize"));
      if (app?.activeTabId) {
        app.fitTerminal(app.activeTabId);
      }
    };

    const onDblClick = () => {
      const targetSidebar = isLeft ? leftSidebar : rightSidebar;
      if (!targetSidebar) return;
      const defaultW = isLeft ? DEFAULT_LEFT_WIDTH : DEFAULT_RIGHT_WIDTH;
      targetSidebar.style.width = `${defaultW}px`;
      localStorage.setItem(isLeft ? STORAGE_KEY_LEFT : STORAGE_KEY_RIGHT, defaultW.toString());
      window.dispatchEvent(new Event("resize"));
      if (app?.activeTabId) {
        app.fitTerminal(app.activeTabId);
      }
    };

    resizer.addEventListener("pointerdown", onPointerDown);
    resizer.addEventListener("pointermove", onPointerMove);
    resizer.addEventListener("pointerup", onPointerUp);
    resizer.addEventListener("pointercancel", onPointerUp);
    resizer.addEventListener("dblclick", onDblClick);
  };

  attachResizer(leftResizer, true);
  attachResizer(rightResizer, false);
}
