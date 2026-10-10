import { escapeHtml } from "../state.js";

export function mountBrowserInstance(state, tab) {
  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `view-container-${tab.id}`;
  container.className = "terminal-instance wb-view hidden";
  container.innerHTML = `
    <div class="wb-browser-bar">
      <button class="btn btn-icon btn-xs btn-back" title="Back">&larr;</button>
      <button class="btn btn-icon btn-xs btn-forward" title="Forward">&rarr;</button>
      <button class="btn btn-icon btn-xs btn-reload" title="Reload">&#x21bb;</button>
      <input class="wb-browser-url" type="text" value="${escapeHtml(tab.url)}" placeholder="http://localhost:3000" />
      <button class="btn btn-xs btn-primary btn-go">Go</button>
      <button class="btn btn-icon btn-xs btn-external" title="Open in New Tab">&#x2197;</button>
    </div>
    <iframe class="wb-browser-frame" src="${escapeHtml(tab.url)}" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>
  `;
  host.appendChild(container);

  const iframe = container.querySelector(".wb-browser-frame");
  const urlInput = container.querySelector(".wb-browser-url");
  const btnBack = container.querySelector(".btn-back");
  const btnForward = container.querySelector(".btn-forward");
  const btnReload = container.querySelector(".btn-reload");
  const btnGo = container.querySelector(".btn-go");
  const btnExternal = container.querySelector(".btn-external");

  const navigateTo = (newUrl) => {
    let target = newUrl.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) {
      target = "http://" + target;
    }
    tab.url = target;
    urlInput.value = target;
    try {
      const u = new URL(target);
      tab.title = u.host || target;
    } catch {
      tab.title = target;
    }
    iframe.src = target;
    state.renderTabs();
  };

  btnGo.onclick = () => navigateTo(urlInput.value);
  urlInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigateTo(urlInput.value);
    }
  };
  btnReload.onclick = () => {
    iframe.src = tab.url;
  };
  btnBack.onclick = () => {
    try { iframe.contentWindow?.history?.back(); } catch {}
  };
  btnForward.onclick = () => {
    try { iframe.contentWindow?.history?.forward(); } catch {}
  };
  btnExternal.onclick = () => {
    if (tab.url) window.open(tab.url, "_blank", "noopener,noreferrer");
  };

  state.viewContainers.set(tab.id, container);
}
