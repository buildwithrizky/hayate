import assert from "node:assert";

// Split state transition logic test
function simulateSplit(state, tabId) {
  const tab = state.tabs.find((t) => t.id === tabId && t.type === "terminal");
  if (!tab) return false;

  if (tab.isSplit && tab.splitId) {
    // Toggle focus
    tab.activePaneId = tab.activePaneId === tab.id ? tab.splitId : tab.id;
    return true;
  }

  const splitId = `${tab.id}_split`;
  state.terminalSessions.set(splitId, { id: splitId, term: {} });
  tab.isSplit = true;
  tab.splitId = splitId;
  tab.activePaneId = splitId;
  return true;
}

function simulateCloseSplit(state, tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab || !tab.isSplit || !tab.splitId) return false;

  state.terminalSessions.delete(tab.splitId);
  tab.isSplit = false;
  tab.splitId = null;
  tab.activePaneId = tab.id;
  return true;
}

const state = {
  tabs: [
    { id: "tab_main", type: "terminal", title: "Term 1", isSplit: false, splitId: null, activePaneId: "tab_main" }
  ],
  terminalSessions: new Map([
    ["tab_main", { id: "tab_main", term: {} }]
  ])
};

// 1. Split terminal
assert.strictEqual(simulateSplit(state, "tab_main"), true);
assert.strictEqual(state.tabs[0].isSplit, true);
assert.strictEqual(state.tabs[0].splitId, "tab_main_split");
assert.strictEqual(state.tabs[0].activePaneId, "tab_main_split");
assert.strictEqual(state.terminalSessions.has("tab_main_split"), true);

// 2. Toggle focus between split panes
simulateSplit(state, "tab_main");
assert.strictEqual(state.tabs[0].activePaneId, "tab_main");
simulateSplit(state, "tab_main");
assert.strictEqual(state.tabs[0].activePaneId, "tab_main_split");

// 3. Close split pane
assert.strictEqual(simulateCloseSplit(state, "tab_main"), true);
assert.strictEqual(state.tabs[0].isSplit, false);
assert.strictEqual(state.tabs[0].splitId, null);
assert.strictEqual(state.tabs[0].activePaneId, "tab_main");
assert.strictEqual(state.terminalSessions.has("tab_main_split"), false);

console.log("Terminal split tests passed!");
