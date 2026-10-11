import assert from "node:assert/strict";
import { isPathIgnored, matchGitignore } from "../public/js/explorer.js";

const state = {
  getActiveWorkspace: () => ({ path: "/repo" }),
  gitignoreRules: ["target/", "src-tauri/target/", ".DS_Store", "*.log"],
  gitStatusData: {
    ignored: ["src-tauri/target/", ".DS_Store"]
  }
};

// Parent directory must not be ignored when only child directory is ignored
assert.equal(isPathIgnored(state, "/repo/src-tauri", true), false);
assert.equal(isPathIgnored(state, "/repo/src-tauri/src", true), false);
assert.equal(isPathIgnored(state, "/repo/src-tauri/Cargo.toml", false), false);

// Ignored target folder and files inside must be ignored
assert.equal(isPathIgnored(state, "/repo/src-tauri/target", true), true);
assert.equal(isPathIgnored(state, "/repo/src-tauri/target/debug", true), true);
assert.equal(isPathIgnored(state, "/repo/src-tauri/target/debug/app", false), true);

// Directory-only rule target/ should not match file named target
assert.equal(matchGitignore({ gitignoreRules: ["target/"] }, "src-tauri/target", false), false);
assert.equal(matchGitignore({ gitignoreRules: ["target/"] }, "src-tauri/target", true), true);

console.log("All gitignore assertions passed.");
