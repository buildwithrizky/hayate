import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Phase 2 Search & Filter Frontend modules exist and validate", async (t) => {
  // Check files existence
  const searchJs = path.join(rootDir, "public/js/search.js");
  const searchCss = path.join(rootDir, "public/css/search.css");
  const filterJs = path.join(rootDir, "public/js/explorer-filter.js");
  const indexHtml = path.join(rootDir, "public/index.html");

  assert.ok(fs.existsSync(searchJs), "public/js/search.js exists");
  assert.ok(fs.existsSync(searchCss), "public/css/search.css exists");
  assert.ok(fs.existsSync(filterJs), "public/js/explorer-filter.js exists");

  const htmlContent = fs.readFileSync(indexHtml, "utf-8");
  assert.ok(htmlContent.includes('id="rs-tab-search"'), "HTML contains #rs-tab-search");
  assert.ok(htmlContent.includes('id="rs-panel-search"'), "HTML contains #rs-panel-search");
  assert.ok(htmlContent.includes('id="rs-tree-filter-bar"'), "HTML contains #rs-tree-filter-bar");
  assert.ok(htmlContent.includes('id="rs-search-query"'), "HTML contains #rs-search-query");

  // Check CSS imports
  const indexCss = fs.readFileSync(path.join(rootDir, "public/css/index.css"), "utf-8");
  assert.ok(indexCss.includes("search.css"), "index.css imports search.css");

  // Check CSS token usage - no hardcoded hex or raw colors in search.css
  const searchCssContent = fs.readFileSync(searchCss, "utf-8");
  const hexMatch = searchCssContent.match(/#[0-9a-fA-F]{3,8}/);
  assert.equal(hexMatch, null, "search.css has zero hardcoded hex literals");

  // Check line count limits (max 500 lines)
  const filesToCheck = [
    "src-tauri/src/commands/search.rs",
    "public/js/search.js",
    "public/js/explorer-filter.js",
    "public/js/explorer.js",
    "public/css/search.css"
  ];

  for (const f of filesToCheck) {
    const lines = fs.readFileSync(path.join(rootDir, f), "utf-8").split("\n").length;
    assert.ok(lines <= 500, `${f} line count ${lines} <= 500`);
  }
});
