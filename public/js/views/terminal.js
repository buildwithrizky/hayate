import { tauriInvoke, sendWs } from "../api.js";
import { escapeHtml } from "../state.js";

// Terminal Theme Configuration - 100% Sokudo.dev
export const TERM_THEME = {
  background: "#000000",
  foreground: "#f5f5f7",
  cursor: "#0091ff",
  cursorAccent: "#000000",
  selectionBackground: "rgba(0, 145, 255, 0.3)",
  black: "#121212",
  red: "#f43f5e",
  green: "#10b981",
  yellow: "#f59e0b",
  blue: "#0091ff",
  magenta: "#00d2ff",
  cyan: "#00d2ff",
  white: "#f5f5f7",
  brightBlack: "#5c5c66",
  brightRed: "#f43f5e",
  brightGreen: "#10b981",
  brightYellow: "#f59e0b",
  brightBlue: "#1a9eff",
  brightMagenta: "#00d2ff",
  brightCyan: "#00d2ff",
  brightWhite: "#ffffff"
};

export function fitTerminal(state, sessionId) {
  const session = state.terminalSessions.get(sessionId);
  if (!session) return;
  try {
    if (session.fitAddon) {
      session.fitAddon.fit();
    }
    const cols = session.term.cols;
    const rows = session.term.rows;
    if (cols > 0 && rows > 0) {
      sendWs({
        action: "resize",
        sessionId,
        cols,
        rows
      });
    }
  } catch {}
}

export function mountTerminalInstance(state, tab) {
  const host = document.getElementById("terminal-host");
  const container = document.createElement("div");
  container.id = `term-container-${tab.id}`;
  container.className = "terminal-instance hidden";
  host.appendChild(container);

  const TerminalClass = window.Terminal;
  if (!TerminalClass) {
    console.error("Terminal not loaded yet");
    return;
  }

  const term = new TerminalClass({
    theme: TERM_THEME,
    cursorBlink: true,
    fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', monospace",
    fontSize: 13,
    lineHeight: 1.25,
    convertEol: true,
    allowTransparency: true
  });

  const FitAddonClass = window.FitAddon?.FitAddon || window.FitAddon;
  const fitAddon = FitAddonClass ? new FitAddonClass() : null;
  if (fitAddon) {
    term.loadAddon(fitAddon);
  }
  term.open(container);

  term.attachCustomKeyEventHandler((e) => {
    if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      sendWs({
        action: "input",
        sessionId: tab.id,
        data: "\x1b[13;2u"
      });
      return false;
    }

    if (e.type === "keydown" && e.key === "Backspace" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      if (tab.lastAction === "paste_token" && tab.recentTokens && tab.recentTokens.length > 0) {
        const lastToken = tab.recentTokens.pop();
        tab.lastAction = null;
        sendWs({
          action: "input",
          sessionId: tab.id,
          data: "\x7f".repeat(lastToken.token.length + 1)
        });
        e.preventDefault();
        return false;
      }
    }
    return true;
  });

  // Keystroke forwarding
  term.onData((data) => {
    tab.lastAction = null;
    sendWs({
      action: "input",
      sessionId: tab.id,
      data
    });
  });

  // Helper: show/hide/click terminal image popover
  const showImagePopover = async (event, text) => {
    let popover = document.getElementById("terminal-image-popover");
    if (!popover) {
      popover = document.createElement("div");
      popover.id = "terminal-image-popover";
      popover.className = "terminal-image-popover";
      document.body.appendChild(popover);
    }

    let src = "";
    let caption = text;
    const matchedToken = tab.recentTokens?.find((t) => t.token === text);

    if (matchedToken) {
      src = matchedToken.previewUrl || "";
      if (!src && matchedToken.path) {
        try {
          src = await tauriInvoke("get_image_preview", { path: matchedToken.path });
        } catch {}
      }
    } else {
      try {
        src = await tauriInvoke("get_image_preview", { path: text });
      } catch {}
    }

    if (!src) return;

    popover.innerHTML = `
      <img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" />
      <div class="popover-caption">${escapeHtml(caption)}</div>
    `;
    popover.style.display = "block";

    const popoverWidth = 240;
    const popoverHeight = 190;
    let left = (event.clientX || 0) + 12;
    let top = (event.clientY || 0) + 12;

    if (left + popoverWidth > window.innerWidth) {
      left = Math.max(8, (event.clientX || 0) - popoverWidth - 12);
    }
    if (top + popoverHeight > window.innerHeight) {
      top = Math.max(8, (event.clientY || 0) - popoverHeight - 12);
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  };

  const hideImagePopover = () => {
    const popover = document.getElementById("terminal-image-popover");
    if (popover) {
      popover.style.display = "none";
    }
  };

  const activateImagePopover = async (event, text) => {
    const matchedToken = tab.recentTokens?.find((t) => t.token === text);
    let targetUrl = matchedToken?.previewUrl || "";
    if (!targetUrl) {
      const p = matchedToken?.path || text;
      try {
        targetUrl = await tauriInvoke("get_image_preview", { path: p });
      } catch {}
    }
    if (targetUrl) {
      window.open(targetUrl, "_blank");
    }
  };

  // Hover Thumbnail Preview (Link Provider)
  if (typeof term.registerLinkProvider === "function") {
    const IMAGE_REGEX_LIST = [
      /\[image\d+\.(?:png|jpe?g|webp|gif|svg)\]/gi,
      /\/api\/upload-image|\S+\.(?:png|jpe?g|webp|gif)/gi
    ];

    term.registerLinkProvider({
      provideLinks: (y, callback) => {
        const line = term.buffer.active.getLine(y - 1);
        if (!line) {
          callback(undefined);
          return;
        }

        const lineText = line.translateToString(true);
        const links = [];
        const matchedSpans = [];

        for (const regex of IMAGE_REGEX_LIST) {
          regex.lastIndex = 0;
          let match;
          while ((match = regex.exec(lineText)) !== null) {
            const text = match[0];
            const startX = match.index + 1;
            const endX = match.index + text.length;

            const overlaps = matchedSpans.some((span) => !(endX < span.startX || startX > span.endX));
            if (overlaps) continue;

            matchedSpans.push({ startX, endX });
            links.push({
              text,
              range: {
                start: { x: startX, y },
                end: { x: endX, y }
              },
              hover: (e, matchedText) => showImagePopover(e, matchedText),
              leave: () => hideImagePopover(),
              activate: (e, matchedText) => activateImagePopover(e, matchedText)
            });
          }
        }

        callback(links);
      }
    });
  }

  // Image paste forwarding
  const handlePaste = async (e) => {
    let file = null;
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type && item.type.startsWith("image/")) {
          file = item.getAsFile();
          break;
        }
      }
    }

    if (!file && e.clipboardData?.files) {
      for (const f of e.clipboardData.files) {
        if ((f.type && f.type.startsWith("image/")) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name)) {
          file = f;
          break;
        }
      }
    }

    if (!file) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    try {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const data = await tauriInvoke("upload_image", {
        sessionId: tab.id,
        fileName: file.name || "paste.png",
        base64Data
      });

      const token = data.token || "[image.png]";
      const previewUrl = data.previewUrl || "";

      tab.recentTokens = tab.recentTokens || [];
      tab.recentTokens.push({
        token,
        previewUrl,
        path: data.path || ""
      });
      tab.lastAction = "paste_token";

      sendWs({
        action: "input",
        sessionId: tab.id,
        data: token + " "
      });
      console.info("[Terminal Paste] Image uploaded:", data.path || token);
    } catch (err) {
      console.error("[Terminal Paste] Failed to upload image:", err);
    }
  };

  container.addEventListener("paste", handlePaste, { capture: true });
  if (term.textarea) {
    term.textarea.addEventListener("paste", handlePaste, { capture: true });
  }
  const windowPasteHandler = (e) => {
    if (state.activeTabId !== tab.id) return;
    const activeEl = document.activeElement;
    const isTargetInside = container.contains(e.target);
    const isFocusInside = activeEl && container.contains(activeEl);
    if (!isTargetInside && !isFocusInside) return;
    handlePaste(e);
  };
  window.addEventListener("paste", windowPasteHandler, { capture: true });

  const resizeObserver = new ResizeObserver(() => {
    if (state.activeTabId === tab.id) {
      fitTerminal(state, tab.id);
    }
  });
  resizeObserver.observe(container);

  state.terminalSessions.set(tab.id, {
    term,
    fitAddon,
    container,
    resizeObserver,
    windowPasteHandler
  });
}
