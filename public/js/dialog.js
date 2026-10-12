// In-app modal dialog replacing window.prompt, window.confirm, and window.alert for Tauri/WKWebView

export function showPromptDialog(options = {}) {
  const opts = typeof options === "string" ? { title: options, message: arguments[1] || "" } : options;
  const { title = "Enter value", message = "", defaultValue = "", confirmLabel = "Confirm", cancelLabel = "Cancel" } = opts;

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

export function showConfirmDialog(options = {}) {
  const opts = typeof options === "string" ? { message: options } : options;
  const { title = "Confirm", message = "Are you sure?", confirmLabel = "Confirm", cancelLabel = "Cancel", isDanger = false } = opts;

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

export function showMessageDialog(title = "Message", message = "") {
  let dialogTitle = title;
  let dialogMessage = message;
  if (typeof title === "object") {
    dialogTitle = title.title || "Message";
    dialogMessage = title.message || "";
  }

  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "rs-modal";

    const overlay = document.createElement("div");
    overlay.className = "rs-modal-overlay";

    const win = document.createElement("div");
    win.className = "rs-dialog-window";

    if (dialogTitle) {
      const titleEl = document.createElement("div");
      titleEl.className = "rs-dialog-title";
      titleEl.textContent = dialogTitle;
      win.appendChild(titleEl);
    }

    if (dialogMessage) {
      const msgEl = document.createElement("div");
      msgEl.className = "rs-dialog-message";
      msgEl.textContent = dialogMessage;
      win.appendChild(msgEl);
    }

    const actions = document.createElement("div");
    actions.className = "rs-dialog-actions";

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn btn-xs btn-primary";
    okBtn.textContent = "OK";

    actions.appendChild(okBtn);
    win.appendChild(actions);

    modal.appendChild(overlay);
    modal.appendChild(win);
    document.body.appendChild(modal);

    const cleanup = () => {
      window.removeEventListener("keydown", onKeyDown, true);
      modal.remove();
      resolve();
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    okBtn.addEventListener("click", cleanup);
    overlay.addEventListener("click", cleanup);

    okBtn.focus();
  });
}
