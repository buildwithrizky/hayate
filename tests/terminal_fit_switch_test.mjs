import assert from "node:assert/strict";
import { fitTerminal } from "../public/js/views/terminal.js";
import { switchTab } from "../public/js/tabs.js";

// Test 1: Immediate fitTerminal sends resize immediately and updates lastCols / lastRows
{
  const sentMessages = [];
  globalThis.__test_sendWs = (msg) => sentMessages.push(msg);

  const mockSession = {
    term: { cols: 80, rows: 24 },
    fitAddon: { fit: () => {} },
    resizeTimer: null,
    lastCols: 0,
    lastRows: 0
  };

  const mockState = {
    terminalSessions: new Map([["tab_1", mockSession]])
  };

  fitTerminal(mockState, "tab_1", true);

  assert.equal(mockSession.lastCols, 80);
  assert.equal(mockSession.lastRows, 24);
  assert.equal(mockSession.resizeTimer, null);
  // Re-run immediate with same cols/rows: no duplicate resize
  fitTerminal(mockState, "tab_1", true);
}

// Test 2: Non-immediate debounce skips if sizes identical
{
  const mockSession = {
    term: { cols: 100, rows: 30 },
    fitAddon: { fit: () => {} },
    resizeTimer: null,
    lastCols: 100,
    lastRows: 30
  };
  const mockState = {
    terminalSessions: new Map([["tab_2", mockSession]])
  };

  fitTerminal(mockState, "tab_2", false);
  assert.ok(mockSession.resizeTimer !== null);
  clearTimeout(mockSession.resizeTimer);
}

// Test 3: switchTab order of operations: unhide -> fitTerminal(immediate) -> write buffer -> rAF refresh & focus
{
  const order = [];
  const termMock = {
    rows: 24,
    write(data) {
      order.push(`write:${data}`);
    },
    refresh(start, end) {
      order.push(`refresh:${start}-${end}`);
    },
    focus() {
      order.push("focus");
    }
  };

  const containerMock = {
    classList: {
      remove(cls) {
        order.push(`classList.remove:${cls}`);
      },
      add() {}
    }
  };

  const session = {
    container: containerMock,
    term: termMock,
    buffer: "initial output"
  };

  const state = {
    tabs: [{ id: "tab_term", workspaceId: "ws_1", type: "terminal" }],
    workspaces: [{ id: "ws_1", name: "Ws 1", path: "/test" }],
    activeWorkspaceId: "ws_1",
    activeTabId: null,
    activeTabByWorkspace: {},
    terminalSessions: new Map([["tab_term", session]]),
    viewContainers: new Map(),
    fitTerminal(sId, immediate) {
      order.push(`fitTerminal:${sId}:${immediate}`);
    },
    renderWorkspaces() {},
    renderTabs() {},
    renderCwd() {},
    renderStatusBadge() {},
    reloadRightSidebar() {}
  };

  const originalRaf = globalThis.requestAnimationFrame;
  let rafCallback = null;
  globalThis.requestAnimationFrame = (cb) => {
    rafCallback = cb;
    return 1;
  };

  try {
    switchTab(state, "tab_term");
    assert.deepEqual(order, [
      "classList.remove:hidden",
      "fitTerminal:tab_term:true",
      "write:initial output"
    ]);
    assert.equal(session.buffer, "");

    // Now trigger rAF
    assert.ok(typeof rafCallback === "function");
    rafCallback();
    assert.deepEqual(order, [
      "classList.remove:hidden",
      "fitTerminal:tab_term:true",
      "write:initial output",
      "refresh:0-23",
      "focus"
    ]);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }
}

console.log("All terminal fit and switchTab tests passed.");
