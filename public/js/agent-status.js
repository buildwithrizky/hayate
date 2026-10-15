// Agent Status & Attention State Tracker for Hayate
// Sourced from Orca's architecture (1:1 agent detection & attention contract)

export const AGENT_GLYPHS = {
  CLAUDE_IDLE: "✳",      // ✳
  GEMINI_WORKING: "✦",   // ✦
  GEMINI_SILENT: "⏲",    // ⏲
  GEMINI_IDLE: "◇",      // ◇
  GEMINI_PERMISSION: "✋" // ✋
};

const BRAILLE_SPINNER_RE = /[⠀-⣿]/;
const QUARTER_CIRCLE_RE = /[◐-◓]/; // ◐ ◑ ◒ ◓
const STRONG_WORKING_RE = /(?<![\w./\\-])(working|thinking|running|processing|generating|searching)(?![\w-])/i;
const STRONG_WAITING_RE = /(?<![\w./\\-])(permission|waiting|approval|confirm|allow|needs attention|askuserquestion|\?|\[y\/n\])(?![\w-])/i;
const STRONG_IDLE_RE = /(?<![\w./\\-])(idle|ready|done|finished)(?![\w-])/i;

export function containsSpinner(text) {
  if (!text) return false;
  return BRAILLE_SPINNER_RE.test(text) || QUARTER_CIRCLE_RE.test(text);
}

export function detectAgentFromTitle(title) {
  if (!title) return null;
  const lower = title.toLowerCase();

  if (lower.includes("claude") || title.includes(AGENT_GLYPHS.CLAUDE_IDLE)) {
    return { name: "Claude Code", kind: "claude" };
  }
  if (lower.includes("codex")) {
    return { name: "Codex", kind: "codex" };
  }
  if (lower.includes("gemini") || title.includes(AGENT_GLYPHS.GEMINI_WORKING) || title.includes(AGENT_GLYPHS.GEMINI_IDLE)) {
    return { name: "Gemini CLI", kind: "gemini" };
  }
  if (lower.includes("opencode")) {
    return { name: "OpenCode", kind: "opencode" };
  }
  if (lower.includes("aider")) {
    return { name: "Aider", kind: "aider" };
  }
  if (lower.includes("goose")) {
    return { name: "Goose", kind: "goose" };
  }
  if (lower.includes("cursor") || lower.includes("agent")) {
    return { name: "Agent", kind: "agent" };
  }
  if (lower.includes("π") || lower.includes("pi")) {
    return { name: "Pi", kind: "pi" };
  }
  return null;
}

export function detectAgentStatus(title) {
  if (!title) return null;

  // 1. Explicit permission / waiting indicators
  if (title.includes(AGENT_GLYPHS.GEMINI_PERMISSION) || STRONG_WAITING_RE.test(title)) {
    return "permission";
  }

  // 2. Active spinner or working glyphs
  if (
    containsSpinner(title) ||
    title.includes(AGENT_GLYPHS.GEMINI_WORKING) ||
    title.includes(AGENT_GLYPHS.GEMINI_SILENT) ||
    STRONG_WORKING_RE.test(title)
  ) {
    return "working";
  }

  // 3. Explicit idle markers
  if (
    title.startsWith(AGENT_GLYPHS.CLAUDE_IDLE) ||
    title.includes(AGENT_GLYPHS.GEMINI_IDLE) ||
    STRONG_IDLE_RE.test(title)
  ) {
    return "idle";
  }

  return null;
}

export function extractOscTitle(chunk) {
  if (!chunk || !chunk.includes("\x1b]")) return null;
  let idx = chunk.lastIndexOf("\x1b]");
  if (idx === -1) return null;

  // Expect command: 0; or 1; or 2;
  const cmd = chunk.charCodeAt(idx + 2);
  if (cmd !== 0x30 && cmd !== 0x31 && cmd !== 0x32) return null;
  if (chunk.charCodeAt(idx + 3) !== 0x3b) return null; // ';'

  const start = idx + 4;
  for (let i = start; i < chunk.length; i++) {
    const code = chunk.charCodeAt(i);
    if (code === 0x07) { // BEL
      return chunk.slice(start, i);
    }
    if (code === 0x1b && chunk.charCodeAt(i + 1) === 0x5c) { // ESC \ (ST)
      return chunk.slice(start, i);
    }
  }
  return null;
}

let audioCtx = null;

export function playAgentSound(type = "attention") {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    gain.connect(audioCtx.destination);
    osc.connect(gain);

    if (type === "attention") {
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(440.0, now + 0.12);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === "done") {
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch {}
}

export function updateTabAgentStatus(state, tabId, rawTitle) {
  if (!state || !tabId || !rawTitle) return;
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab || tab.type !== "terminal") return;

  const agent = detectAgentFromTitle(rawTitle);
  const status = detectAgentStatus(rawTitle);

  const prevStatus = tab.agentState;
  const prevAgent = tab.agentName;

  if (agent) {
    tab.agentName = agent.name;
    tab.agentKind = agent.kind;
  }

  if (status) {
    tab.agentState = status;
    tab.agentStatusText = rawTitle.trim();
  } else if (!agent && !containsSpinner(rawTitle)) {
    // If returned to plain shell prompt without agent marker
    if (prevStatus === "working") {
      tab.agentState = "done";
    }
  }

  if (tab.agentState !== prevStatus || tab.agentName !== prevAgent) {
    // Attention pulse & sound when waiting for user input
    if (tab.agentState === "permission" && tabId !== state.activeTabId) {
      tab.needsAttention = true;
      playAgentSound("attention");
    } else if (tab.agentState === "done" && prevStatus === "working" && tabId !== state.activeTabId) {
      playAgentSound("done");
    } else if (tabId === state.activeTabId && tab.agentState !== "permission") {
      tab.needsAttention = false;
    }

    if (typeof state.renderTabs === "function") {
      state.renderTabs(state);
    }

    updateAgentsSidebarBadge(state);
    if (state.activeRightPanel === "agents") {
      state.renderAgentsSidebarPanel?.();
    }
    state.tabs.forEach((t) => {
      if (t.type === "kanban" && typeof t._kanbanRefresh === "function") {
        t._kanbanRefresh();
      }
    });
  }
}

export function updateAgentsSidebarBadge(state) {
  if (typeof document === "undefined") return;
  const badge = document.getElementById("rs-agents-badge");
  if (!badge || !state?.tabs) return;

  const count = state.tabs.filter(
    (t) => t.type === "terminal" && (t.agentState === "working" || t.agentState === "permission" || t.needsAttention)
  ).length;

  if (count > 0) {
    badge.textContent = String(count);
    badge.style.display = "var(--display-inline-flex)";
  } else {
    badge.style.display = "var(--display-none)";
  }
}

export function getAgentBadgeHtml(tab) {
  if (!tab || tab.type !== "terminal" || !tab.agentState) return "";

  const state = tab.agentState;
  const agentLabel = tab.agentName || "Agent";

  if (state === "working") {
    return `<span class="tab-agent-badge agent-badge-working" title="${agentLabel}: Working...">
      <span class="agent-working-spinner"></span>
    </span>`;
  }

  if (state === "permission") {
    return `<span class="tab-agent-badge agent-badge-permission ${tab.needsAttention ? 'agent-attention-pulse' : ''}" title="${agentLabel}: Needs attention / permission">
      <svg class="agent-q-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </span>`;
  }

  if (state === "done") {
    return `<span class="tab-agent-badge agent-badge-done" title="${agentLabel}: Done">
      <span class="agent-done-dot"></span>
    </span>`;
  }

  return "";
}
