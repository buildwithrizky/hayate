import assert from "node:assert/strict";
import {
  getExplorerClipboard,
  setExplorerClipboard,
  clearExplorerClipboard,
  executePaste
} from "../public/js/explorer-clipboard.js";
import { getCompactChain } from "../public/js/explorer-compact.js";
import { getFileIcon } from "../public/js/explorer-icons.js";

// Mock document for clipboard visuals
const classMap = new Map();
globalThis.document = {
  querySelectorAll: (selector) => {
    return [];
  },
  querySelector: (selector) => null
};

// --- Test 1: Explorer Clipboard (cut / copy / paste) ---
clearExplorerClipboard();
assert.equal(getExplorerClipboard(), null);

setExplorerClipboard("copy", ["/repo/src/a.js", "/repo/src/b.js"]);
let clip = getExplorerClipboard();
assert.equal(clip.mode, "copy");
assert.deepEqual(clip.paths, ["/repo/src/a.js", "/repo/src/b.js"]);

// Test paste cut vs copy logic
const moves = [];
const copies = [];
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        if (cmd === "move_path") moves.push(args);
        if (cmd === "copy_path") copies.push(args);
        return true;
      }
    }
  }
};

const fakeState = {
  tabs: [{ filePath: "/repo/src/cut.js", title: "cut.js" }],
  openFolders: new Set(),
  loadExplorer: async () => {}
};

// Copy paste
await executePaste(fakeState, "/repo/dist");
assert.equal(copies.length, 2);
assert.equal(copies[0].srcPath, "/repo/src/a.js");
assert.equal(copies[0].dstPath, "/repo/dist/a.js");
assert.equal(copies[1].srcPath, "/repo/src/b.js");
assert.equal(copies[1].dstPath, "/repo/dist/b.js");
assert.notEqual(getExplorerClipboard(), null, "Copy clipboard persists");

// Cut paste
setExplorerClipboard("cut", ["/repo/src/cut.js"]);
await executePaste(fakeState, "/repo/dist");
assert.equal(moves.length, 1);
assert.equal(moves[0].srcPath, "/repo/src/cut.js");
assert.equal(moves[0].dstPath, "/repo/dist/cut.js");
assert.equal(fakeState.tabs[0].filePath, "/repo/dist/cut.js");
assert.equal(getExplorerClipboard(), null, "Cut clipboard clears after paste");

// --- Test 2: Compact Folders logic ---
const mockState = {
  folderCache: new Map([
    // Chain: root -> child1 -> child2 (has multiple files)
    [
      "/ws/nested",
      [{ name: "sub1", path: "/ws/nested/sub1", isDirectory: true }]
    ],
    [
      "/ws/nested/sub1",
      [{ name: "sub2", path: "/ws/nested/sub1/sub2", isDirectory: true }]
    ],
    [
      "/ws/nested/sub1/sub2",
      [
        { name: "file1.txt", path: "/ws/nested/sub1/sub2/file1.txt", isDirectory: false },
        { name: "file2.txt", path: "/ws/nested/sub1/sub2/file2.txt", isDirectory: false }
      ]
    ]
  ])
};

const rootItem = { name: "nested", path: "/ws/nested", isDirectory: true };
const chain = await getCompactChain(mockState, rootItem);
assert.deepEqual(chain.displayParts, ["nested", "sub1", "sub2"]);
assert.equal(chain.finalItem.name, "sub2");
assert.equal(chain.itemsInChain.length, 3);

// Non-directory item returns itself
const fileItem = { name: "index.js", path: "/ws/index.js", isDirectory: false };
const fileChain = await getCompactChain(mockState, fileItem);
assert.deepEqual(fileChain.displayParts, ["index.js"]);
assert.equal(fileChain.finalItem, fileItem);

// --- Test 3: Icons Mapper ---
const folderIcon = getFileIcon("folder", true, false);
assert.match(folderIcon, /is-folder/);

const folderOpenIcon = getFileIcon("folder", true, true);
assert.match(folderOpenIcon, /polygon points=/);

const packageJsonIcon = getFileIcon("package.json", false);
assert.match(packageJsonIcon, /var\(--text-dim\)/);

const tsIcon = getFileIcon("main.ts", false);
assert.match(tsIcon, /var\(--text-dim\)/);

const defaultIcon = getFileIcon("unknown.customxyz", false);
assert.match(defaultIcon, /rs-file-icon/);

// --- Test 4: File Nesting ---
import { applyFileNesting } from "../public/js/explorer-nesting.js";

const rawFiles = [
  { name: "package.json", path: "/proj/package.json", isDirectory: false },
  { name: "package-lock.json", path: "/proj/package-lock.json", isDirectory: false },
  { name: "bun.lockb", path: "/proj/bun.lockb", isDirectory: false },
  { name: "Cargo.toml", path: "/proj/Cargo.toml", isDirectory: false },
  { name: "Cargo.lock", path: "/proj/Cargo.lock", isDirectory: false },
  { name: ".env", path: "/proj/.env", isDirectory: false },
  { name: ".env.local", path: "/proj/.env.local", isDirectory: false },
  { name: "main.ts", path: "/proj/main.ts", isDirectory: false },
  { name: "main.js", path: "/proj/main.js", isDirectory: false },
  { name: "main.d.ts", path: "/proj/main.d.ts", isDirectory: false },
  { name: "other.js", path: "/proj/other.js", isDirectory: false }
];

const nestedTree = applyFileNesting(rawFiles);
assert.equal(nestedTree.length, 5); // package.json, Cargo.toml, .env, main.ts, other.js

const pkgNode = nestedTree.find(n => n.name === "package.json");
assert.ok(pkgNode.nestedChildren);
assert.equal(pkgNode.nestedChildren.length, 2);
assert.deepEqual(pkgNode.nestedChildren.map(c => c.name), ["package-lock.json", "bun.lockb"]);

const cargoNode = nestedTree.find(n => n.name === "Cargo.toml");
assert.ok(cargoNode.nestedChildren);
assert.equal(cargoNode.nestedChildren.length, 1);
assert.equal(cargoNode.nestedChildren[0].name, "Cargo.lock");

const envNode = nestedTree.find(n => n.name === ".env");
assert.ok(envNode.nestedChildren);
assert.equal(envNode.nestedChildren.length, 1);
assert.equal(envNode.nestedChildren[0].name, ".env.local");

const tsNode = nestedTree.find(n => n.name === "main.ts");
assert.ok(tsNode.nestedChildren);
assert.equal(tsNode.nestedChildren.length, 2);
assert.deepEqual(tsNode.nestedChildren.map(c => c.name), ["main.js", "main.d.ts"]);

console.log("All explorer VS Code unit tests passed.");
