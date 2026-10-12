import { tauriInvoke } from "../api.js";
import { escapeHtml, formatFileSize } from "../state.js";
import { getWorkspaceRelativePath } from "./editor.js";

const imageInstances = new Map();
const ICON_CLOSE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_IMAGE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="wb-bar-icon"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

export function disposeImageInstance(tabId) {
  imageInstances.delete(tabId);
}

export async function mountImageInstance(state, tab) {
  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `view-container-${tab.id}`;
  container.className = "terminal-instance wb-view hidden";
  const relPath = tab.filePath ? getWorkspaceRelativePath(state, tab.filePath) : tab.title;

  container.innerHTML = `
    <div class="wb-image-bar">
      <div class="wb-bar-meta">
        ${ICON_IMAGE}
        <span class="wb-bar-path" title="${escapeHtml(tab.filePath || '')}">${escapeHtml(relPath)}</span>
        <span class="wb-image-dimensions wb-image-meta-badge">...</span>
        <span class="wb-image-size wb-image-meta-badge"></span>
      </div>
      <div class="wb-bar-actions">
        <button class="btn btn-icon btn-xs btn-close" title="Close tab">${ICON_CLOSE}</button>
      </div>
    </div>
    <div class="wb-image-body">
      <div class="wb-image-container">
        <img class="wb-image-preview" alt="${escapeHtml(tab.title)}" />
        <div class="wb-image-error" style="display: none;"></div>
      </div>
    </div>
  `;

  host.appendChild(container);
  state.viewContainers.set(tab.id, container);
  imageInstances.set(tab.id, container);

  container.querySelector(".btn-close").onclick = () => state.closeTab(tab.id);

  const img = container.querySelector(".wb-image-preview");
  const dimBadge = container.querySelector(".wb-image-dimensions");
  const sizeBadge = container.querySelector(".wb-image-size");
  const errEl = container.querySelector(".wb-image-error");

  img.onload = () => {
    dimBadge.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
  };

  img.onerror = () => {
    img.style.display = "none";
    dimBadge.textContent = "Error";
    errEl.textContent = "Failed to load image preview";
    errEl.style.display = "block";
  };

  if (!tab.filePath) {
    img.onerror();
    return;
  }

  try {
    const [dataUrl, fileData] = await Promise.all([
      tauriInvoke("get_image_preview", { path: tab.filePath }),
      tauriInvoke("get_file_content", { path: tab.filePath }).catch(() => null)
    ]);
    if (fileData?.size) {
      sizeBadge.textContent = formatFileSize(fileData.size);
    }
    img.src = dataUrl;
  } catch (err) {
    img.style.display = "none";
    dimBadge.textContent = "Error";
    errEl.textContent = `Error: ${err}`;
    errEl.style.display = "block";
  }
}
