import { escapeHtml } from "../state.js";
import { tauriInvoke, tauriListen } from "../api.js";

export function isTauri() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.__TAURI_INTERNALS__ ||
      (window.__TAURI__?.core?.invoke &&
        typeof window.__TAURI__?.core?.invoke === "function" &&
        !window.__TAURI_MOCK__ &&
        window.__TAURI_IS_BROWSER_MOCK__ !== true &&
        window.__TAURI_INTERNALS__ !== undefined)
  );
}

let browserListenersRegistered = false;
export function initBrowserTauriListeners(state) {
  if (browserListenersRegistered || !isTauri()) return;
  browserListenersRegistered = true;

  tauriListen("browser-title", (event) => {
    const payload = event?.payload;
    if (!payload?.tab_id) return;
    const tab = state.tabs.find((t) => t.id === payload.tab_id);
    if (!tab) return;
    if (payload.title && payload.title.trim()) {
      tab.title = payload.title.trim();
      state.renderTabs?.();
    }
  }).catch(() => {});

  tauriListen("browser-loaded", (event) => {
    const payload = event?.payload;
    if (!payload?.tab_id) return;
    const tab = state.tabs.find((t) => t.id === payload.tab_id);
    if (!tab) return;
    if (payload.url && payload.url !== "about:blank") {
      tab.url = payload.url;
      const container = state.viewContainers?.get(tab.id);
      if (container) {
        const input = container.querySelector(".wb-browser-url");
        if (input && document.activeElement !== input) input.value = payload.url;
        const protoSlot = container.querySelector(".wb-browser-protocol-slot");
        if (protoSlot) protoSlot.innerHTML = getProtocolBadge(payload.url);
        const progressBar = container.querySelector(".wb-browser-progress");
        const btnReload = container.querySelector(".btn-reload");
        progressBar?.classList.remove("loading");
        btnReload?.classList.remove("is-reloading");
      }
      state.renderTabs?.();
    }
  }).catch(() => {});
}

function getProtocolBadge(rawUrl) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    const isLocal =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname.endsWith(".local");

    if (isLocal) {
      return `<span class="wb-browser-badge dev" title="Local Development Server">DEV</span>`;
    }
    if (parsed.protocol === "https:") {
      return `<span class="wb-browser-badge secure" title="Secure HTTPS Connection">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </span>`;
    }
    return `<span class="wb-browser-badge insecure" title="Insecure HTTP">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
    </span>`;
  } catch {
    return `<span class="wb-browser-badge insecure">HTTP</span>`;
  }
}

export function getViewportBounds(container) {
  const host = document.getElementById("terminal-host");
  const hostRect = host ? host.getBoundingClientRect() : null;
  const bar = container?.querySelector(".wb-browser-bar");
  const barHeight = (bar?.offsetHeight || 36) + 2;
  const left = hostRect ? Math.round(hostRect.left) : 0;
  const top = hostRect ? Math.round(hostRect.top + barHeight) : barHeight;
  const width = hostRect ? Math.max(1, Math.round(hostRect.width)) : 800;
  const height = hostRect ? Math.max(1, Math.round(hostRect.height - barHeight)) : 600;
  return { x: left, y: top, width, height };
}

// ponytail: sync overlay via boolean querySelector check, upgrade when dynamic floating window z-order manager added.
export function syncBrowserOverlayVisibility(state) {
  if (!isTauri() || !state) return;
  const activeTab = state.tabs?.find((t) => t.id === state.activeTabId);
  if (!activeTab || activeTab.type !== "browser" || !activeTab.url || activeTab.isHibernated) {
    return;
  }

  const quickOpenModal = document.getElementById("quick-open-modal");
  const isQuickOpenVisible = Boolean(
    quickOpenModal &&
      quickOpenModal.style.display !== "none" &&
      !quickOpenModal.classList.contains("hidden") &&
      window.getComputedStyle(quickOpenModal).display === "flex"
  );

  const hasOverlay =
    Boolean(document.querySelector("#new-tab-menu.open")) ||
    Boolean(document.querySelector(".rs-context-menu")) ||
    Boolean(document.querySelector(".rs-dialog-backdrop, .rs-dialog-window")) ||
    isQuickOpenVisible;

  tauriInvoke("browser_set_visible", {
    tabId: activeTab.id,
    visible: !hasOverlay
  }).catch(() => {});
}

export function updateBrowserBounds(state) {
  if (!isTauri() || !state) return;
  const activeTab = state.tabs?.find((t) => t.id === state.activeTabId);
  if (!activeTab || activeTab.type !== "browser" || !activeTab.url || activeTab.isHibernated) {
    return;
  }
  const container = state.viewContainers?.get(activeTab.id);
  const bounds = getViewportBounds(container);
  tauriInvoke("browser_set_bounds", { tabId: activeTab.id, bounds }).catch(() => {});
}

export function initBrowserOverlaySync(state) {
  if (!isTauri() || !state || state._browserOverlaySyncInit) return;
  state._browserOverlaySyncInit = true;

  const handleSync = () => {
    syncBrowserOverlayVisibility(state);
  };

  const observer = new MutationObserver(handleSync);
  if (typeof document !== "undefined" && document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });
  }

  window.addEventListener("click", () => {
    setTimeout(handleSync, 0);
  });

  window.addEventListener("resize", () => {
    updateBrowserBounds(state);
    handleSync();
  });
}

// ponytail: naive about:blank iframe unload on sleep, upgrade when full webview session state serialization needed.
export function hibernateBrowserInstance(state, tab) {
  tab.isHibernated = true;
  const container = state.viewContainers.get(tab.id);
  if (!container) return;

  if (isTauri()) {
    tauriInvoke("browser_set_visible", { tabId: tab.id, visible: false }).catch(() => {});
  }

  const iframe = container.querySelector(".wb-browser-frame");
  if (iframe) {
    iframe.src = "about:blank";
  }

  let sleepOverlay = container.querySelector(".wb-browser-sleep-screen");
  if (!sleepOverlay) {
    sleepOverlay = document.createElement("div");
    sleepOverlay.className = "wb-browser-sleep-screen";
    sleepOverlay.innerHTML = `
      <div class="wb-browser-sleep-card">
        <div class="wb-browser-sleep-icon">💤</div>
        <div class="wb-browser-sleep-title">Tab Hibernated</div>
        <div class="wb-browser-sleep-desc">Memory and CPU unloaded to save system battery.</div>
        <button class="btn btn-sm btn-primary wb-browser-wake-btn">Wake Tab</button>
      </div>
    `;
    sleepOverlay.querySelector(".wb-browser-wake-btn").onclick = () => {
      restoreBrowserInstance(state, tab);
      if (state.activeTabId !== tab.id && typeof state.switchTab === "function") {
        state.switchTab(tab.id);
      }
    };
    const viewport = container.querySelector(".wb-browser-viewport") || container;
    viewport.appendChild(sleepOverlay);
  }
  sleepOverlay.style.display = "";
  sleepOverlay.classList.remove("hidden");
  state.renderTabs();
}

export function restoreBrowserInstance(state, tab) {
  tab.isHibernated = false;
  const container = state.viewContainers.get(tab.id);
  if (!container) return;

  const sleepOverlay = container.querySelector(".wb-browser-sleep-screen");
  if (sleepOverlay) {
    sleepOverlay.classList.add("hidden");
    sleepOverlay.style.display = "none";
  }

  const startScreen = container.querySelector(".wb-browser-start-screen");
  const iframe = container.querySelector(".wb-browser-frame");
  const progressBar = container.querySelector(".wb-browser-progress");
  const btnReload = container.querySelector(".btn-reload");

  if (!tab.url) {
    if (startScreen) {
      startScreen.classList.remove("hidden");
      startScreen.style.display = "";
    }
    if (iframe) {
      iframe.classList.add("hidden");
      iframe.style.display = "none";
    }
    if (isTauri()) {
      tauriInvoke("browser_set_visible", { tabId: tab.id, visible: false }).catch(() => {});
    }
  } else {
    if (startScreen) {
      startScreen.classList.add("hidden");
      startScreen.style.display = "none";
    }
    if (iframe) {
      if (isTauri()) {
        iframe.classList.add("hidden");
        iframe.style.display = "none";
      } else {
        iframe.classList.remove("hidden");
        iframe.style.display = "";
      }
      if (iframe.src !== tab.url) {
        if (progressBar) progressBar.classList.add("loading");
        if (btnReload) btnReload.classList.add("is-reloading");
        iframe.src = tab.url;
      }
    }
    if (isTauri()) {
      const bounds = getViewportBounds(container);
      tauriInvoke("browser_set_bounds", { tabId: tab.id, bounds }).catch(() => {});
      tauriInvoke("browser_set_visible", { tabId: tab.id, visible: true }).catch(() => {});
    }
  }
  state.renderTabs();
}

export function mountBrowserInstance(state, tab) {
  initBrowserTauriListeners(state);
  initBrowserOverlaySync(state);

  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `view-container-${tab.id}`;
  container.className = "terminal-instance wb-view hidden";
  container.innerHTML = `
    <div class="wb-browser-bar">
      <button class="btn btn-icon btn-xs btn-back" title="Back">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <button class="btn btn-icon btn-xs btn-forward" title="Forward">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </button>
      <button class="btn btn-icon btn-xs btn-reload" title="Reload (Cmd+R / Ctrl+R)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>
      <div class="wb-browser-url-wrapper">
        <span class="wb-browser-protocol-slot">${getProtocolBadge(tab.url || "")}</span>
        <input class="wb-browser-url" type="text" value="${tab.url ? escapeHtml(tab.url) : ""}" placeholder="Search or enter URL..." spellcheck="false" />
        <button class="btn btn-icon btn-xs btn-copy-url" title="Copy URL">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
      <button class="btn btn-icon btn-xs btn-go" title="Go">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </button>
      <button class="btn btn-icon btn-xs btn-sleep" title="Sleep Tab (Hibernate) to Save Battery">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <button class="btn btn-icon btn-xs btn-external" title="Open in New Window">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
    </div>
    <div class="wb-browser-progress"></div>
    <div class="wb-browser-viewport">
      <div class="wb-browser-start-screen${tab.url ? " hidden" : ""}"${tab.url ? ' style="display: none;"' : ""}>
        <div class="wb-browser-start-card">
          <div class="wb-browser-start-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
            </svg>
          </div>
          <div class="wb-browser-start-title">Hayate Browser</div>
          <form class="wb-browser-start-form">
            <input class="wb-browser-start-input" type="text" placeholder="Search or enter web address..." spellcheck="false" />
          </form>
          <div class="wb-browser-start-pills">
            <button class="wb-browser-speed-dial" data-url="http://localhost:3000">Localhost :3000</button>
            <button class="wb-browser-speed-dial" data-url="http://localhost:5173">Localhost :5173</button>
            <button class="wb-browser-speed-dial" data-url="https://github.com">GitHub</button>
            <button class="wb-browser-speed-dial" data-url="https://google.com">Google</button>
          </div>
        </div>
      </div>
      <iframe class="wb-browser-frame${!tab.url ? " hidden" : ""}"${!tab.url ? ' style="display: none;"' : ""} src="${tab.isHibernated ? "about:blank" : escapeHtml(tab.url)}" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>
    </div>
  `;
  host.appendChild(container);

  const startScreen = container.querySelector(".wb-browser-start-screen");
  const startForm = container.querySelector(".wb-browser-start-form");
  const startInput = container.querySelector(".wb-browser-start-input");
  const iframe = container.querySelector(".wb-browser-frame");
  const urlInput = container.querySelector(".wb-browser-url");
  const protoSlot = container.querySelector(".wb-browser-protocol-slot");
  const progressBar = container.querySelector(".wb-browser-progress");
  const btnBack = container.querySelector(".btn-back");
  const btnForward = container.querySelector(".btn-forward");
  const btnReload = container.querySelector(".btn-reload");
  const btnCopy = container.querySelector(".btn-copy-url");
  const btnGo = container.querySelector(".btn-go");
  const btnSleep = container.querySelector(".btn-sleep");
  const btnExternal = container.querySelector(".btn-external");
  const viewport = container.querySelector(".wb-browser-viewport");

  const startLoading = () => {
    progressBar?.classList.add("loading");
    btnReload?.classList.add("is-reloading");
  };

  const stopLoading = () => {
    progressBar?.classList.remove("loading");
    btnReload?.classList.remove("is-reloading");
  };

  if (iframe) {
    iframe.addEventListener("load", () => {
      stopLoading();
      try {
        const frameUrl = iframe.contentWindow?.location?.href;
        if (frameUrl && frameUrl !== "about:blank" && frameUrl !== tab.url) {
          tab.url = frameUrl;
          urlInput.value = frameUrl;
          if (protoSlot) protoSlot.innerHTML = getProtocolBadge(frameUrl);
        }
      } catch {}
    });
  }

  // ponytail: throttle bounds updates via rAF to avoid spamming IPC on rapid drag resize
  let resizeRaf = null;
  if (typeof ResizeObserver === "function" && viewport && isTauri()) {
    const ro = new ResizeObserver(() => {
      if (tab.isHibernated || !tab.url || state.activeTabId !== tab.id) return;
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        const bounds = getViewportBounds(container);
        tauriInvoke("browser_set_bounds", { tabId: tab.id, bounds }).catch(() => {});
      });
    });
    ro.observe(viewport);
    container._browserRo = ro;
  }

  const navigateTo = (newUrl) => {
    let target = newUrl.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) {
      if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(target)) {
        target = "http://" + target;
      } else {
        target = "https://" + target;
      }
    }
    tab.url = target;
    urlInput.value = target;
    if (protoSlot) protoSlot.innerHTML = getProtocolBadge(target);
    try {
      const u = new URL(target);
      tab.title = u.host || target;
    } catch {
      tab.title = target;
    }

    if (startScreen) {
      startScreen.classList.add("hidden");
      startScreen.style.display = "none";
    }

    startLoading();
    if (tab.isHibernated) {
      restoreBrowserInstance(state, tab);
    }

    if (isTauri()) {
      const bounds = getViewportBounds(container);
      tauriInvoke("browser_create", {
        tabId: tab.id,
        url: target,
        bounds
      })
        .then(() => tauriInvoke("browser_set_visible", { tabId: tab.id, visible: true }))
        .catch((err) => console.error("browser_create error:", err));
    } else if (iframe) {
      iframe.classList.remove("hidden");
      iframe.style.display = "";
      iframe.src = target;
    }

    state.renderTabs();
  };

  if (startForm) {
    startForm.onsubmit = (e) => {
      e.preventDefault();
      if (startInput?.value) navigateTo(startInput.value);
    };
  }
  container.querySelectorAll(".wb-browser-speed-dial").forEach((btn) => {
    btn.onclick = () => {
      const u = btn.dataset.url;
      if (u) navigateTo(u);
    };
  });

  btnGo.onclick = () => navigateTo(urlInput.value);
  urlInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigateTo(urlInput.value);
    }
  };
  btnReload.onclick = () => {
    startLoading();
    if (tab.isHibernated) {
      restoreBrowserInstance(state, tab);
    } else if (isTauri() && tab.url) {
      tauriInvoke("browser_reload", { tabId: tab.id }).catch(() => {});
    } else if (iframe) {
      iframe.src = tab.url;
    }
  };
  btnBack.onclick = () => {
    if (isTauri() && tab.url) {
      tauriInvoke("browser_go_back", { tabId: tab.id }).catch(() => {});
    } else {
      try { iframe?.contentWindow?.history?.back(); } catch {}
    }
  };
  btnForward.onclick = () => {
    if (isTauri() && tab.url) {
      tauriInvoke("browser_go_forward", { tabId: tab.id }).catch(() => {});
    } else {
      try { iframe?.contentWindow?.history?.forward(); } catch {}
    }
  };
  btnCopy.onclick = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tab.url);
      }
      btnCopy.classList.add("copied");
      setTimeout(() => btnCopy.classList.remove("copied"), 1200);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };
  btnSleep.onclick = () => {
    if (tab.isHibernated) {
      restoreBrowserInstance(state, tab);
    } else {
      hibernateBrowserInstance(state, tab);
    }
  };
  btnExternal.onclick = () => {
    if (tab.url) window.open(tab.url, "_blank", "noopener,noreferrer");
  };

  state.viewContainers.set(tab.id, container);

  if (tab.isHibernated) {
    hibernateBrowserInstance(state, tab);
  } else if (tab.url && isTauri()) {
    const bounds = getViewportBounds(container);
    tauriInvoke("browser_create", {
      tabId: tab.id,
      url: tab.url,
      bounds
    }).catch(() => {});
  }
}
