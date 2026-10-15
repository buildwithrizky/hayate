import assert from "node:assert";
import {
  detectAgentFromTitle,
  detectAgentStatus,
  extractOscTitle,
  updateTabAgentStatus,
  getAgentBadgeHtml,
  AGENT_GLYPHS
} from "../public/js/agent-status.js";

// 1. Test agent detection from terminal title
const claude = detectAgentFromTitle("✳ Claude Code - ~/hayate");
assert.strictEqual(claude?.name, "Claude Code");
assert.strictEqual(claude?.kind, "claude");

const gemini = detectAgentFromTitle("✦ Gemini CLI");
assert.strictEqual(gemini?.name, "Gemini CLI");

const codex = detectAgentFromTitle("codex: running task");
assert.strictEqual(codex?.name, "Codex");

const none = detectAgentFromTitle("zsh - ~/hayate");
assert.strictEqual(none, null);

// 2. Test status detection
assert.strictEqual(detectAgentStatus("⠋ Thinking about solution..."), "working");
assert.strictEqual(detectAgentStatus("◐ Running build tool..."), "working");
assert.strictEqual(detectAgentStatus("✦ Generating response..."), "working");
assert.strictEqual(detectAgentStatus("Claude Code (needs permission)"), "permission");
assert.strictEqual(detectAgentStatus("✋ Gemini CLI: allow command?"), "permission");
assert.strictEqual(detectAgentStatus("✳ Claude Code"), "idle");
assert.strictEqual(detectAgentStatus("◇ Gemini CLI"), "idle");

// 3. Test OSC extraction
const oscSample = "some output\x1b]0;✳ Claude Code\x07trailing output";
assert.strictEqual(extractOscTitle(oscSample), "✳ Claude Code");

// 4. Test state update and badges
const state = {
  activeTabId: "tab_1",
  renderTabsCallCount: 0,
  renderTabs() {
    this.renderTabsCallCount++;
  },
  tabs: [
    { id: "tab_1", type: "terminal", title: "Term 1" },
    { id: "tab_2", type: "terminal", title: "Term 2" }
  ]
};

// Update active tab to working
updateTabAgentStatus(state, "tab_1", "⠋ Thinking...");
assert.strictEqual(state.tabs[0].agentState, "working");
assert.strictEqual(state.renderTabsCallCount, 1);
assert.match(getAgentBadgeHtml(state.tabs[0]), /agent-working-spinner/);

// Update background tab to permission -> needsAttention becomes true
updateTabAgentStatus(state, "tab_2", "Claude Code (needs permission)");
assert.strictEqual(state.tabs[1].agentState, "permission");
assert.strictEqual(state.tabs[1].needsAttention, true);
assert.match(getAgentBadgeHtml(state.tabs[1]), /agent-badge-permission/);
assert.match(getAgentBadgeHtml(state.tabs[1]), /agent-attention-pulse/);

console.log("All agent status tests passed!");
