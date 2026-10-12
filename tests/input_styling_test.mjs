import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Input styling and non-full-white focus ring standard", () => {
  const tokens = fs.readFileSync("public/css/tokens.css", "utf8");
  
  // Ensure border-focus is subtle translucent white, not solid pure white (#ffffff)
  assert.ok(!tokens.includes("--border-focus: var(--accent-blue);"), "border-focus must not be stark solid accent-blue");
  assert.ok(tokens.includes("--border-focus: rgba(255, 255, 255, 0.36);"), "border-focus must use subtle translucent white token");
  assert.ok(tokens.includes("--shadow-focus-ring:"), "shadow-focus-ring token must exist");

  // Verify inputs use proper focus ring and padding
  const searchCss = fs.readFileSync("public/css/search.css", "utf8");
  assert.ok(searchCss.includes("padding: var(--space-sm) var(--space-xl);"), "search input has comfortable padding");
  assert.ok(searchCss.includes("box-shadow: var(--shadow-focus-ring);"), "search box has subtle focus ring");

  const gitCss = fs.readFileSync("public/css/git.css", "utf8");
  assert.ok(gitCss.includes("padding: var(--space-md) var(--space-xl);"), "commit input has comfortable padding");
  assert.ok(gitCss.includes("box-shadow: var(--shadow-focus-ring);"), "commit input has subtle focus ring");

  const gitWidgetsCss = fs.readFileSync("public/css/git-widgets.css", "utf8");
  assert.ok(gitWidgetsCss.includes("padding: var(--space-sm) var(--space-xl);"), "branch search input has comfortable padding");
  assert.ok(gitWidgetsCss.includes("box-shadow: var(--shadow-focus-ring);"), "branch search input has subtle focus ring");
});
