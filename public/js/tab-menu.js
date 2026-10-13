import { showConfirmDialog } from "./dialog.js";

let activeTabMenuEl = null;

export function closeTabContextMenu() {
  if (activeTabMenuEl) {
    activeTabMenuEl.remove();
    activeTabMenuEl = null;
  }
}

export function initTabMenuEvents() {
  window.addEventListener("click", (e) => {
    if (activeTabMenuEl && !activeTabMenuEl.contains(e.target)) {
      closeTabContextMenu();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeTabMenuEl) {
      closeTabContextMenu();
    }
  });
}

export function showTabContextMenu(state, event, tab) {
  event.preventDefault();
  event.stopPropagation();
  closeTabContextMenu();

  const menu = document.createElement("div");
  menu.className = "rs-context-menu tab-context-menu";

  const isPinned = Boolean(tab.isPinned);
  const isHibernated = Boolean(tab.isHibernated);
  const isBrowser = tab.type === "browser";

  const actions = [
    {
      label: isPinned ? "Unpin Tab" : "Pin Tab",
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V5a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v5.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"/></svg>`,
      action: () => {
        if (isPinned) state.unpinTab(tab.id);
        else state.pinTab(tab.id);
      }
    },
    {
      label: "Duplicate Tab",
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
      action: async () => {
        await state.createTab(null, tab.type, {
          title: tab.title,
          url: tab.url,
          filePath: tab.filePath,
          content: tab.content,
          cwd: tab.cwd,
          isEditMode: tab.isEditMode
        });
      }
    }
  ];

  if (isBrowser) {
    actions.push({
      label: isHibernated ? "Wake Tab" : "Sleep Tab (Hibernate)",
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
      action: () => {
        if (isHibernated) state.wakeTab(tab.id);
        else state.hibernateTab(tab.id);
      }
    });

    actions.push({
      label: "Reload Tab",
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
      action: () => {
        if (state.activeTabId === tab.id) {
          state.restartActiveTab();
        } else {
          state.wakeTab(tab.id);
          state.switchTab(tab.id);
        }
      }
    });
  }

  actions.push({ separator: true });

  actions.push({
    label: "Close Tab",
    disabled: isPinned,
    isDanger: true,
    action: () => state.closeTab(tab.id)
  });

  const wsTabs = state.tabs.filter((t) => t.workspaceId === tab.workspaceId);
  const otherUnpinned = wsTabs.filter((t) => t.id !== tab.id && !t.isPinned);
  actions.push({
    label: "Close Other Tabs",
    disabled: otherUnpinned.length === 0,
    action: async () => {
      for (const ot of otherUnpinned) {
        await state.closeTab(ot.id);
      }
    }
  });

  const tabIndex = wsTabs.findIndex((t) => t.id === tab.id);
  const rightUnpinned = wsTabs.slice(tabIndex + 1).filter((t) => !t.isPinned);
  actions.push({
    label: "Close Tabs to Right",
    disabled: rightUnpinned.length === 0,
    action: async () => {
      for (const rt of rightUnpinned) {
        await state.closeTab(rt.id);
      }
    }
  });

  for (const act of actions) {
    if (act.separator) {
      const sep = document.createElement("div");
      sep.className = "rs-context-menu-separator";
      menu.appendChild(sep);
      continue;
    }
    const itemEl = document.createElement("button");
    itemEl.type = "button";
    itemEl.className = `rs-context-menu-item ${act.isDanger ? "is-danger" : ""} ${act.disabled ? "is-disabled" : ""}`;
    if (act.disabled) {
      itemEl.disabled = true;
    }
    itemEl.innerHTML = `
      <span class="tab-menu-item-left">
        ${act.icon || ""}
        <span>${act.label}</span>
      </span>
    `;
    itemEl.onclick = async (e) => {
      e.stopPropagation();
      if (act.disabled) return;
      closeTabContextMenu();
      await act.action();
    };
    menu.appendChild(itemEl);
  }

  document.body.appendChild(menu);
  activeTabMenuEl = menu;

  const { clientX: x, clientY: y } = event;
  const menuRect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - menuRect.width - 6;
  const maxY = window.innerHeight - menuRect.height - 6;

  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top = `${Math.min(y, maxY)}px`;
}
