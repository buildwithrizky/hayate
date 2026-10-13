import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { StateManager } from "../public/js/state.js";
import {
  createTab,
  switchTab,
  closeTab,
  pinTab,
  unpinTab,
  hibernateTab,
  wakeTab,
  renderTabs
} from "../public/js/tabs.js";
import {
  mountBrowserInstance,
  hibernateBrowserInstance,
  restoreBrowserInstance
} from "../public/js/views/browser.js";
import { showTabContextMenu, closeTabContextMenu } from "../public/js/tab-menu.js";

// Minimal DOM mock helper
function createMockElement(tag = "div") {
  const classes = new Set();
  const children = [];
  const listeners = new Map();
  const attrs = new Map();
  let rawClassName = "";

  return {
    tagName: tag.toUpperCase(),
    children,
    get className() { return rawClassName; },
    set className(val) {
      rawClassName = val || "";
      rawClassName.split(" ").filter(Boolean).forEach((c) => classes.add(c));
    },
    classList: {
      add: (...list) => list.forEach((c) => c.split(" ").filter(Boolean).forEach((p) => classes.add(p))),
      remove: (...list) => list.forEach((c) => c.split(" ").filter(Boolean).forEach((p) => classes.delete(p))),
      contains: (c) => classes.has(c) || Boolean(rawClassName && rawClassName.split(" ").includes(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c);
          else classes.add(c);
        } else if (force) classes.add(c);
        else classes.delete(c);
      }
    },
    style: {},
    textContent: "",
    value: "",
    title: "",
    disabled: false,
    contentWindow: { location: { href: "" } },
    addEventListener: (evt, cb) => {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(cb);
    },
    removeEventListener: () => {},
    appendChild: (child) => { children.push(child); return child; },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) || null,
    removeAttribute: (k) => attrs.delete(k),
    remove: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 40, width: 800, height: 600 }),
    querySelector: function (sel) {
      if (sel === ".wb-browser-frame") return children.find((c) => c.classList?.contains("wb-browser-frame")) || createMockElement("iframe");
      if (sel === ".wb-browser-start-screen") return children.find((c) => c.classList?.contains("wb-browser-start-screen")) || createMockElement();
      if (sel === ".wb-browser-start-form") return children.find((c) => c.classList?.contains("wb-browser-start-form")) || createMockElement("form");
      if (sel === ".wb-browser-start-input") return children.find((c) => c.classList?.contains("wb-browser-start-input")) || createMockElement("input");
      if (sel === ".wb-browser-sleep-screen") return children.find((c) => c.classList?.contains("wb-browser-sleep-screen")) || null;
      if (sel === ".wb-browser-wake-btn") return createMockElement("button");
      if (sel === ".wb-browser-url") return createMockElement("input");
      if (sel === ".wb-browser-protocol-slot" || sel === ".wb-browser-progress" || sel === ".wb-browser-viewport") return createMockElement();
      if (sel.startsWith(".btn-")) return createMockElement("button");
      return createMockElement();
    },
    querySelectorAll: (sel) => []
  };
}

globalThis.window = {
  __TAURI__: { core: { invoke: async () => {} } },
  addEventListener: () => {},
  removeEventListener: () => {},
  getComputedStyle: () => ({ display: "none" })
};

const hostEl = createMockElement("div");
const tabsContainer = createMockElement("div");
globalThis.document = {
  getElementById: (id) => {
    if (id === "terminal-host") return hostEl;
    if (id === "tabs-container") return tabsContainer;
    return createMockElement();
  },
  createElement: (tag) => createMockElement(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createMockElement("body")
};

test("Browser lifecycle: empty url, auto-title, start screen & pinning", async () => {
  const state = new StateManager();
  state.workspaces = [{ id: "ws_1", name: "Hayate", path: "/hayate" }];
  state.activeWorkspaceId = "ws_1";

  // Default empty url & start screen
  const tab = await createTab(state, state.workspaces[0], "browser", { url: "" });
  assert.equal(tab.title, "Browser");
  assert.equal(tab.url, "");
  assert.equal(state.tabs.length, 1);
  assert.equal(state.activeTabId, tab.id);

  // Pinning & close protection
  state.pinTab(tab.id);
  assert.equal(tab.isPinned, true);
  await closeTab(state, tab.id);
  assert.equal(state.tabs.length, 1, "Pinned tab must not close");

  // Unpin & close into history
  state.unpinTab(tab.id);
  assert.equal(tab.isPinned, false);
  await closeTab(state, tab.id);
  assert.equal(state.tabs.length, 0);
  assert.equal(state.closedTabsHistory.length, 1);
  assert.equal(state.closedTabsHistory[0].title, "Browser");
});

test("Hibernation, wake restore, and reopen closed tab", async () => {
  const state = new StateManager();
  state.workspaces = [{ id: "ws_1", name: "Hayate", path: "/hayate" }];
  state.activeWorkspaceId = "ws_1";

  // Reopen closed tab from history
  state.recordClosedTab({ type: "browser", title: "Docs", workspaceId: "ws_1", url: "https://example.com" });
  const reopened = await state.reopenClosedTab();
  assert.ok(reopened);
  assert.equal(reopened.title, "Docs");
  assert.equal(reopened.url, "https://example.com");
  assert.equal(state.closedTabsHistory.length, 0);

  // Hibernation (discard) and wake
  assert.equal(reopened.isHibernated, false);
  state.hibernateTab(reopened.id);
  assert.equal(reopened.isHibernated, true);
  state.wakeTab(reopened.id);
  assert.equal(reopened.isHibernated, false);

  // Auto-hibernation keeps max 1 inactive awake
  const t2 = await createTab(state, state.workspaces[0], "browser", { url: "https://site2.com" });
  const t3 = await createTab(state, state.workspaces[0], "browser", { url: "https://site3.com" });
  assert.equal(t3.isHibernated, false, "active browser awake");
  const hibernatedCount = [reopened, t2].filter((t) => t.isHibernated).length;
  assert.equal(hibernatedCount, 1, "extra inactive browser auto-hibernated");
});

test("Toolbar tokens & styling: rounded-full, ghost dark icons, no white button, no colorful badge", () => {
  const tokensCss = fs.readFileSync("public/css/tokens.css", "utf8");
  const browserCss = fs.readFileSync("public/css/browser.css", "utf8");
  const browserJs = fs.readFileSync("public/js/views/browser.js", "utf8");

  assert.ok(tokensCss.includes("--radius-full: 9999px;"), "radius-full token must be 9999px");
  assert.ok(browserCss.includes("border-radius: var(--radius-full);"), "address bar uses radius-full");
  assert.ok(!browserJs.includes("btn-primary btn-go"), "no btn-primary on go button");
  assert.ok(!browserJs.includes(">Go<"), "btn-go has no text label");
  assert.ok(browserJs.includes('class="btn btn-icon btn-xs btn-go"'), "btn-go is uniform btn-icon");
  assert.ok(!browserJs.includes("&larr;") && !browserJs.includes("&rarr;") && !browserJs.includes("&#x21bb;"), "no html arrow entities");

  const barBtnMatch = browserCss.match(/\.wb-browser-bar\s+\.btn[^{]*\{([^}]+)\}/);
  assert.ok(barBtnMatch, "toolbar button block exists");
  assert.ok(!barBtnMatch[1].includes("white") && !barBtnMatch[1].includes("#ffffff"), "no white button background");
  assert.ok(!browserCss.includes("var(--accent-emerald-badge)") && !browserCss.includes("var(--accent-amber-badge)"), "no colorful badges");
});

test("Tab context menu commands include Pin, Hibernate, and Close", () => {
  const menuJs = fs.readFileSync("public/js/tab-menu.js", "utf8");
  assert.ok(menuJs.includes("Pin Tab") && menuJs.includes("Unpin Tab"), "tab menu handles pin/unpin");
  assert.ok(menuJs.includes("Wake Tab") && menuJs.includes("Sleep Tab (Hibernate)"), "tab menu handles hibernate/wake");
  assert.ok(menuJs.includes("Close Tab"), "tab menu handles close-tab");
});
