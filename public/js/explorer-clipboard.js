import { copyPath, movePath } from "./api.js";

let clipboard = null; // { mode: 'cut' | 'copy', paths: string[] }

export function getExplorerClipboard() {
  return clipboard;
}

export function setExplorerClipboard(mode, paths) {
  if (!paths || !paths.length) return;
  clipboard = { mode, paths: [...paths] };
  updateClipboardVisuals();
}

export function clearExplorerClipboard() {
  clipboard = null;
  updateClipboardVisuals();
}

export function updateClipboardVisuals() {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".rs-file-item.is-cut").forEach((el) => {
    el.classList.remove("is-cut");
  });

  if (clipboard && clipboard.mode === "cut") {
    clipboard.paths.forEach((p) => {
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(p) : p.replace(/(["\\])/g, "\\$1");
      const el = document.querySelector(`.rs-file-item[data-path="${escaped}"]`);
      if (el) el.classList.add("is-cut");
    });
  }
}

export async function executePaste(state, targetDir) {
  if (!clipboard || !clipboard.paths.length) return;
  const sep = targetDir.includes("\\") && !targetDir.includes("/") ? "\\" : "/";
  const { mode, paths } = clipboard;

  for (const src of paths) {
    const parts = src.split(/[/\\]+/).filter(Boolean);
    const name = parts[parts.length - 1];
    let dst = `${targetDir.replace(/[/\\]+$/, "")}${sep}${name}`;

    // Avoid pasting into same directory with same name for copy
    if (src === dst) {
      if (mode === "copy") {
        const dotIdx = name.lastIndexOf(".");
        let base = name;
        let ext = "";
        if (dotIdx > 0) {
          base = name.slice(0, dotIdx);
          ext = name.slice(dotIdx);
        }
        dst = `${targetDir.replace(/[/\\]+$/, "")}${sep}${base} copy${ext}`;
      } else {
        continue;
      }
    }

    try {
      if (mode === "cut") {
        await movePath(src, dst);
        state.tabs.forEach((tab) => {
          if (tab.filePath === src) {
            tab.filePath = dst;
            tab.title = dst.split(/[/\\]+/).filter(Boolean).pop();
          }
        });
      } else {
        await copyPath(src, dst);
      }
    } catch (err) {
      console.error(`Failed to ${mode} from ${src} to ${dst}:`, err);
    }
  }

  if (mode === "cut") {
    clearExplorerClipboard();
  }
  await state.loadExplorer(true);
}
