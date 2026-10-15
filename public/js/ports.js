import { tauriInvoke } from "./api.js";
import { escapeHtml } from "./state.js";
import { showConfirmDialog, showMessageDialog } from "./dialog.js";

let scanInterval = null;
let cachedPorts = [];

export function initPortsMonitor(state) {
  const pillBtn = document.getElementById("ports-status-btn");
  const dropdown = document.getElementById("ports-dropdown");
  const refreshBtn = document.getElementById("ports-refresh-btn");

  if (!pillBtn || !dropdown) return;

  pillBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = dropdown.classList.contains("is-hidden");
    if (isHidden) {
      dropdown.classList.remove("is-hidden");
      refreshPorts(state);
    } else {
      dropdown.classList.add("is-hidden");
    }
  });

  refreshBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    refreshPorts(state);
  });

  document.addEventListener("pointerdown", (e) => {
    if (!dropdown.contains(e.target) && !pillBtn.contains(e.target)) {
      dropdown.classList.add("is-hidden");
    }
  });

  // Initial scan and background interval (every 10s)
  refreshPorts(state);
  if (scanInterval) clearInterval(scanInterval);
  scanInterval = setInterval(() => {
    refreshPorts(state, true);
  }, 10000);
}

export async function refreshPorts(state, silent = false) {
  const countLabel = document.getElementById("ports-count-label");
  const pillBtn = document.getElementById("ports-status-btn");
  const listEl = document.getElementById("ports-list");

  try {
    const ports = await tauriInvoke("list_active_ports");
    cachedPorts = ports || [];

    // Update pill indicator
    if (countLabel && pillBtn) {
      if (cachedPorts.length === 0) {
        countLabel.textContent = "Ports";
        pillBtn.classList.remove("has-ports");
      } else if (cachedPorts.length === 1) {
        countLabel.textContent = `:${cachedPorts[0].port}`;
        pillBtn.classList.add("has-ports");
      } else {
        countLabel.textContent = `${cachedPorts.length} Ports`;
        pillBtn.classList.add("has-ports");
      }
    }

    if (listEl) {
      renderPortsList(state, cachedPorts, listEl);
    }
  } catch (err) {
    if (!silent && listEl) {
      listEl.innerHTML = `<div class="rs-empty error">${escapeHtml(String(err))}</div>`;
    }
  }
}

function renderPortsList(state, ports, container) {
  if (!ports || ports.length === 0) {
    container.innerHTML = `<div class="rs-empty">No active listening ports</div>`;
    return;
  }

  container.innerHTML = "";
  ports.forEach((p) => {
    const item = document.createElement("div");
    item.className = "port-item";

    const procLabel = `${p.command} (${p.pid})`;
    item.innerHTML = `
      <div class="port-info">
        <span class="port-number">:${escapeHtml(String(p.port))}</span>
        <span class="port-proc" title="${escapeHtml(procLabel)}">${escapeHtml(procLabel)}</span>
      </div>
      <div class="port-actions">
        <button class="port-action-btn open-btn" title="Open in Hayate Browser">Open</button>
        <button class="port-action-btn copy-btn" title="Copy URL">Copy</button>
        <button class="port-action-btn kill kill-btn" title="Stop Process">&times;</button>
      </div>
    `;

    const url = `http://localhost:${p.port}`;

    item.querySelector(".open-btn")?.addEventListener("click", () => {
      const activeWs = state.getActiveWorkspace();
      state.createTab(activeWs, "browser", { url });
      document.getElementById("ports-dropdown")?.classList.add("is-hidden");
    });

    item.querySelector(".copy-btn")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {}
    });

    item.querySelector(".kill-btn")?.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog(
        "Stop Process",
        `Kill process ${p.command} (PID ${p.pid}) on port ${p.port}?`
      );
      if (confirmed) {
        try {
          await tauriInvoke("kill_port_process", { pid: p.pid });
          await refreshPorts(state);
        } catch (err) {
          showMessageDialog("Kill Failed", String(err));
        }
      }
    });

    container.appendChild(item);
  });
}
