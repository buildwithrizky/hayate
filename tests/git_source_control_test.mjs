import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Git Source Control modules and CSS line limits and styling", async () => {
  const jsFiles = [
    "public/js/git/actions-menu.js",
    "public/js/git/branch-picker.js",
    "public/js/git/commits.js",
    "public/js/git/diff.js",
    "public/js/git/index.js",
    "public/js/git/operations.js",
    "public/js/git/status.js"
  ];

  for (const f of jsFiles) {
    assert.ok(fs.existsSync(f), `${f} should exist`);
    const content = fs.readFileSync(f, "utf8");
    const lineCount = content.split("\n").length;
    assert.ok(lineCount <= 500, `${f} line count (${lineCount}) exceeds 500 lines`);
  }

  const cssFiles = [
    "public/css/git.css",
    "public/css/git-widgets.css"
  ];

  for (const f of cssFiles) {
    assert.ok(fs.existsSync(f), `${f} should exist`);
    const css = fs.readFileSync(f, "utf8");
    const lineCount = css.split("\n").length;
    assert.ok(lineCount <= 500, `${f} line count (${lineCount}) exceeds 500 lines`);

    const hardcodedRegex = /:\s*[^;\n]*?(#[0-9a-fA-F]{3,8}|rgba?\(|\b\d+px\b|\b\d+rem\b|\b\d+s\b|\b\d+ms\b)/;
    css.split("\n").forEach((line, idx) => {
      const lineCleaned = line.replace(/var\([^)]+\)/g, "");
      const match = lineCleaned.match(hardcodedRegex);
      assert.ok(!match, `${f}:${idx + 1} has hardcoded CSS: ${line.trim()}`);
    });
  }

  // Verify index.html contains Git controls
  const indexHtml = fs.readFileSync("public/index.html", "utf8");
  assert.ok(indexHtml.includes("rs-git-branch"), "index.html has branch pill");
  assert.ok(indexHtml.includes("rs-git-sync"), "index.html has sync button");
  assert.ok(indexHtml.includes("rs-git-more"), "index.html has git more actions button");
  assert.ok(indexHtml.includes("rs-commit-push-btn"), "index.html has commit & push button");
});
