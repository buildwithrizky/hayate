import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const tokensCss = readFileSync("public/css/tokens.css", "utf8");
const explorerCss = readFileSync("public/css/explorer.css", "utf8");
const explorerJs = readFileSync("public/js/explorer.js", "utf8");

// 1. Token existence
assert.ok(tokensCss.includes("--transform-none: none;"), "Token --transform-none harus ada");
assert.ok(tokensCss.includes("--transform-rotate-neg90: rotate(-90deg);"), "Token --transform-rotate-neg90 harus ada");

// 2. Explorer CSS check
assert.ok(explorerCss.includes("var(--transform-rotate-neg90)"), "Explorer CSS harus memakai --transform-rotate-neg90");
assert.ok(explorerCss.includes("var(--transform-none)"), "Explorer CSS harus memakai --transform-none");
assert.ok(explorerCss.includes("var(--text-muted)"), "Explorer chevron default harus --text-muted");
assert.ok(explorerCss.includes("var(--text-pure)"), "Explorer chevron open harus --text-pure");

// Zero hardcoded check in .rs-chevron block
const chevronMatch = explorerCss.match(/\.rs-chevron\s*\{([^}]+)\}/);
assert.ok(chevronMatch, ".rs-chevron rule harus ada");
const rules = chevronMatch[1].split(";").map(r => r.trim()).filter(Boolean);
for (const rule of rules) {
  const [prop, val] = rule.split(":").map(s => s.trim());
  assert.ok(val.startsWith("var("), `Nilai properti ${prop}: ${val} harus memakai var()`);
}

// 3. Explorer JS check
assert.ok(explorerJs.includes("rs-chevron-icon"), "JS harus merender SVG rs-chevron-icon");
assert.ok(explorerJs.includes("rs-chevron-spacer"), "JS harus memakai rs-chevron-spacer");
assert.ok(!explorerJs.includes('style="opacity:0;"'), "Tidak boleh ada hardcoded inline style opacity");

console.log("All explorer chevron checks passed.");
