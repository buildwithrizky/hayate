import assert from "node:assert";

// Test grouping logic for Agent Kanban Board
function groupAgentsForKanban(tabs) {
  const working = [];
  const permission = [];
  const idle = [];

  const terminalTabs = tabs.filter((t) => t.type === "terminal");

  terminalTabs.forEach((t) => {
    const st = t.agentState || "idle";
    if (st === "working") {
      working.push(t);
    } else if (st === "permission" || t.needsAttention) {
      permission.push(t);
    } else {
      idle.push(t);
    }
  });

  return { working, permission, idle };
}

const mockTabs = [
  { id: "t1", type: "terminal", agentState: "working", agentName: "Claude Code", title: "Term 1" },
  { id: "t2", type: "terminal", agentState: "permission", agentName: "Codex", needsAttention: true, title: "Term 2" },
  { id: "t3", type: "terminal", agentState: "done", agentName: "Gemini CLI", title: "Term 3" },
  { id: "t4", type: "terminal", title: "Term 4" }, // plain shell
  { id: "t5", type: "browser", title: "Browser" } // non-terminal tab ignored
];

const grouped = groupAgentsForKanban(mockTabs);

assert.strictEqual(grouped.working.length, 1);
assert.strictEqual(grouped.working[0].id, "t1");
assert.strictEqual(grouped.working[0].agentName, "Claude Code");

assert.strictEqual(grouped.permission.length, 1);
assert.strictEqual(grouped.permission[0].id, "t2");
assert.strictEqual(grouped.permission[0].agentName, "Codex");

assert.strictEqual(grouped.idle.length, 2);
assert.strictEqual(grouped.idle[0].id, "t3");
assert.strictEqual(grouped.idle[1].id, "t4");

console.log("Agent Kanban grouping tests passed!");
