import assert from "node:assert";

// Porcelain parser test specification matching Rust parse_worktree_list
function parseWorktreeList(output) {
  const worktrees = [];
  const blocks = output.split("\n\n");
  let isFirst = true;

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    let path = "";
    let head = "";
    let branch = "";
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length).trim();
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        const raw = line.slice("branch ".length).trim();
        branch = raw.replace(/^refs\/heads\//, "");
      } else if (line === "bare") {
        isBare = true;
      }
    }

    if (path) {
      const isAgentScratch =
        path.includes(".claude/worktrees") || path.includes(".gsd-workspaces");
      worktrees.push({
        path,
        head,
        branch,
        is_bare: isBare,
        is_main: isFirst,
        is_agent_scratch: isAgentScratch
      });
      isFirst = false;
    }
  }

  return worktrees;
}

const sampleOutput = `worktree /Users/rizkymaulana/Projects/hayate
HEAD fff75f2b8744161bb74bb70efb07223e13d690a7
branch refs/heads/main

worktree /Users/rizkymaulana/Projects/hayate/.claude/worktrees/agent-task-1
HEAD 3d3741d402e1ec7373f1d3e8e1cb1ce0d2e8b2bf
branch refs/heads/agent-task-1

worktree /Users/rizkymaulana/Projects/hayate/worktree-feature
HEAD b44fb396556e87361a6873528b813b5ff2dc3763
branch refs/heads/feature/search-refactor
`;

const list = parseWorktreeList(sampleOutput);
assert.strictEqual(list.length, 3);

// Main worktree
assert.strictEqual(list[0].path, "/Users/rizkymaulana/Projects/hayate");
assert.strictEqual(list[0].branch, "main");
assert.strictEqual(list[0].is_main, true);
assert.strictEqual(list[0].is_agent_scratch, false);

// Agent scratch worktree (.claude/worktrees/...)
assert.strictEqual(list[1].path, "/Users/rizkymaulana/Projects/hayate/.claude/worktrees/agent-task-1");
assert.strictEqual(list[1].branch, "agent-task-1");
assert.strictEqual(list[1].is_main, false);
assert.strictEqual(list[1].is_agent_scratch, true);

// Feature worktree
assert.strictEqual(list[2].path, "/Users/rizkymaulana/Projects/hayate/worktree-feature");
assert.strictEqual(list[2].branch, "feature/search-refactor");
assert.strictEqual(list[2].is_main, false);
assert.strictEqual(list[2].is_agent_scratch, false);

console.log("Git worktree porcelain parser test passed!");
