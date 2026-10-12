import { tauriInvoke } from "./api.js";

export async function loadGitignore(state) {
  const ws = state.getActiveWorkspace();
  if (!ws) {
    state.gitignoreRules = [];
    return;
  }
  try {
    const data = await tauriInvoke("get_file_content", { path: ws.path + "/.gitignore" });
    if (data && data.content) {
      state.gitignoreRules = data.content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      return;
    }
  } catch {}
  state.gitignoreRules = [];
}

export function matchGitignore(state, relPath, isDir = false) {
  if (!state.gitignoreRules || !state.gitignoreRules.length) return false;
  const cleanRel = relPath.replace(/^\/+/, "");
  const parts = cleanRel.split("/");
  const basename = parts[parts.length - 1];

  for (const rule of state.gitignoreRules) {
    let r = rule.trim();
    if (!r) continue;
    const isDirOnly = r.endsWith("/");
    if (isDirOnly) {
      r = r.slice(0, -1);
      // ponytail: directory-only check; upgrade to full gitignore pathspec when nested gitignore needed
      if (!isDir) {
        const insideDir = r.startsWith("/")
          ? cleanRel.startsWith(r.slice(1) + "/")
          : cleanRel.startsWith(r + "/") || parts.slice(0, -1).includes(r);
        if (insideDir) return true;
        continue;
      }
    }

    if (r === cleanRel || r === basename) return true;

    if (r.startsWith("/")) {
      const rootPattern = r.slice(1);
      if (cleanRel === rootPattern || cleanRel.startsWith(rootPattern + "/")) return true;
      continue;
    }

    if (cleanRel === r || cleanRel.startsWith(r + "/") || parts.includes(r)) return true;

    if (r.includes("*")) {
      const rx = new RegExp("^" + r.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*") + "$");
      if (rx.test(basename) || rx.test(cleanRel)) return true;
    }
  }
  return false;
}

export function isPathIgnored(state, targetPath, isDir = false) {
  const ws = state.getActiveWorkspace();
  if (!ws) return false;

  let relPath = targetPath;
  if (targetPath.startsWith(ws.path)) {
    relPath = targetPath.slice(ws.path.length).replace(/^\/+/, "");
  }
  const norm = relPath.replace(/\/+$/, "");
  if (!norm) return false;

  if (matchGitignore(state, norm, isDir)) return true;

  if (state.gitStatusData?.ignored && Array.isArray(state.gitStatusData.ignored)) {
    return state.gitStatusData.ignored.some((ign) => {
      const ignNorm = ign.replace(/\/+$/, "");
      return norm === ignNorm || norm.startsWith(ignNorm + "/");
    });
  }

  return false;
}
