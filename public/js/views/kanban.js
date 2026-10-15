import { escapeHtml } from "../state.js";
import { sendWs } from "../api.js";

export function mountKanbanInstance(state, tab) {
  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `view-container-${tab.id}`;
  container.className = "view-instance kanban-view-container hidden";

  container.innerHTML = `
    <div class="kanban-header">
      <div class="kanban-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="5" height="18" rx="1"/>
          <rect x="10" y="3" width="5" height="12" rx="1"/>
          <rect x="17" y="3" width="5" height="15" rx="1"/>
        </svg>
        <span>Parallel Agent Board</span>
      </div>
      <button class="btn btn-xs kanban-refresh-btn">Refresh</button>
    </div>
    <div class="kanban-columns">
      <div class="kanban-column" data-col="working">
        <div class="kanban-col-header">
          <span>IN PROGRESS</span>
          <span class="kanban-col-count count-working">0</span>
        </div>
        <div class="kanban-col-body col-working"></div>
      </div>
      <div class="kanban-column" data-col="permission">
        <div class="kanban-col-header">
          <span>NEEDS ATTENTION</span>
          <span class="kanban-col-count count-permission">0</span>
        </div>
        <div class="kanban-col-body col-permission"></div>
      </div>
      <div class="kanban-column" data-col="idle">
        <div class="kanban-col-header">
          <span>IDLE / COMPLETED</span>
          <span class="kanban-col-count count-idle">0</span>
        </div>
        <div class="kanban-col-body col-idle"></div>
      </div>
    </div>
  `;

  host.appendChild(container);
  state.viewContainers.set(tab.id, container);

  const refreshBoard = () => renderKanbanBoard(state, container);
  container.querySelector(".kanban-refresh-btn")?.addEventListener("click", refreshBoard);
  refreshBoard();

  tab._kanbanRefresh = refreshBoard;
}

export function renderKanbanBoard(state, container) {
  if (!container) return;

  const colWorking = container.querySelector(".col-working");
  const colPermission = container.querySelector(".col-permission");
  const colIdle = container.querySelector(".col-idle");

  const countWorking = container.querySelector(".count-working");
  const countPermission = container.querySelector(".count-permission");
  const countIdle = container.querySelector(".count-idle");

  if (!colWorking || !colPermission || !colIdle) return;

  colWorking.innerHTML = "";
  colPermission.innerHTML = "";
  colIdle.innerHTML = "";

  const terminalTabs = state.tabs.filter((t) => t.type === "terminal");

  let cWork = 0;
  let cPerm = 0;
  let cIdle = 0;

  terminalTabs.forEach((t) => {
    const card = createAgentCard(state, t);
    const st = t.agentState || "idle";

    if (st === "working") {
      colWorking.appendChild(card);
      cWork++;
    } else if (st === "permission" || t.needsAttention) {
      colPermission.appendChild(card);
      cPerm++;
    } else {
      colIdle.appendChild(card);
      cIdle++;
    }
  });

  if (countWorking) countWorking.textContent = String(cWork);
  if (countPermission) countPermission.textContent = String(cPerm);
  if (countIdle) countIdle.textContent = String(cIdle);

  if (cWork === 0) colWorking.innerHTML = `<div class="rs-empty">No active agents</div>`;
  if (cPerm === 0) colPermission.innerHTML = `<div class="rs-empty">No pending questions</div>`;
  if (cIdle === 0) colIdle.innerHTML = `<div class="rs-empty">No idle terminals</div>`;
}

export function renderAgentsSidebarPanel(state) {
  const panel = document.getElementById("rs-agents-list");
  if (!panel) return;

  const terminalTabs = state.tabs.filter((t) => t.type === "terminal");
  panel.innerHTML = "";

  if (terminalTabs.length === 0) {
    panel.innerHTML = `
      <div class="rs-empty">
        No agent terminals open.
      </div>
    `;
    return;
  }

  terminalTabs.forEach((t) => {
    const card = createAgentCard(state, t);
    panel.appendChild(card);
  });
}

function createAgentCard(state, tab) {
  const card = document.createElement("div");
  const st = tab.agentState || "idle";
  card.className = `agent-card state-${st}`;

  const agentName = tab.agentName || "Terminal";
  const ws = state.workspaces.find((w) => w.id === tab.workspaceId);
  const wsName = ws ? ws.name : "Workspace";
  const statusSnippet = tab.agentStatusText || (st === "working" ? "Processing..." : "Ready");

  card.innerHTML = `
    <div class="agent-card-header">
      <div class="agent-card-title">
        <span>${escapeHtml(agentName)}</span>
      </div>
      <span class="agent-card-ws" title="${escapeHtml(tab.title)}">${escapeHtml(wsName)} / ${escapeHtml(tab.title)}</span>
    </div>
    <div class="agent-card-status">${escapeHtml(statusSnippet)}</div>
    <div class="agent-card-actions">
      <button class="agent-card-btn focus-btn">Focus</button>
      <button class="agent-card-btn stop-btn" title="Send Ctrl+C">Interrupt</button>
    </div>
  `;

  card.addEventListener("click", () => {
    state.switchTab(tab.id);
  });

  card.querySelector(".focus-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.switchTab(tab.id);
  });

  card.querySelector(".stop-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    sendWs({ action: "input", sessionId: tab.id, data: "\x03" });
  });

  return card;
}
