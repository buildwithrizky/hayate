// In-app modal dialog replacing window.prompt and window.confirm for Tauri/WKWebView

export function showPromptDialog({ title = "Enter value", message = "", defaultValue = "", confirmLabel = "Confirm", cancelLabel = "Cancel" } = {}) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "rs-modal";

    const overlay = document.createElement("div");
    overlay.className = "rs-modal-overlay";

    const win = document.createElement("div");
    win.className = "rs-dialog-window";

    if (title) {
      const titleEl = document.createElement("div");
      titleEl.className = "rs-dialog-title";
      titleEl.textContent = title;
      win.appendChild(titleEl);
    }

    if (message) {
      const msgEl = document.createElement("div");
      msgEl.className = "rs-dialog-message";
      msgEl.textContent = message;
      win.appendChild(msgEl);
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "rs-dialog-input";
    input.value = defaultValue;
    input.spellcheck = false;
    win.appendChild(input);

    const actions = document.createElement("div");
    actions.className = "rs-dialog-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-xs";
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn-xs btn-primary";
    confirmBtn.textContent = confirmLabel;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    win.appendChild(actions);

    modal.appendChild(overlay);
    modal.appendChild(win);
    document.body.appendChild(modal);

    const cleanup = (val) => {
      window.removeEventListener("keydown", onKeyDown, true);
      modal.remove();
      resolve(val);
    };

    const submit = () => {
      cleanup(input.value);
    };

    const cancel = () => {
      cleanup(null);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        submit();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    cancelBtn.addEventListener("click", cancel);
    confirmBtn.addEventListener("click", submit);
    overlay.addEventListener("click", cancel);

    input.focus();
    input.select();
  });
}

export function showConfirmDialog({ title = "Confirm", message = "Are you sure?", confirmLabel = "Confirm", cancelLabel = "Cancel", isDanger = false } = {}) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "rs-modal";

    const overlay = document.createElement("div");
    overlay.className = "rs-modal-overlay";

    const win = document.createElement("div");
    win.className = "rs-dialog-window";

    if (title) {
      const titleEl = document.createElement("div");
      titleEl.className = "rs-dialog-title";
      titleEl.textContent = title;
      win.appendChild(titleEl);
    }

    if (message) {
      const msgEl = document.createElement("div");
      msgEl.className = "rs-dialog-message";
      msgEl.textContent = message;
      win.appendChild(msgEl);
    }

    const actions = document.createElement("div");
    actions.className = "rs-dialog-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-xs";
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = `btn btn-xs ${isDanger ? "btn-danger" : "btn-primary"}`;
    confirmBtn.textContent = confirmLabel;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    win.appendChild(actions);

    modal.appendChild(overlay);
    modal.appendChild(win);
    document.body.appendChild(modal);

    const cleanup = (val) => {
      window.removeEventListener("keydown", onKeyDown, true);
      modal.remove();
      resolve(val);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cleanup(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        cleanup(true);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    cancelBtn.addEventListener("click", () => cleanup(false));
    confirmBtn.addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", () => cleanup(false));

    confirmBtn.focus();
  });
}
