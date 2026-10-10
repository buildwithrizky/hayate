export function openDiffTab(state, file, isStaged, statusCode = "M", commitHash = null) {
  if (!file) return;
  const ws = state.getActiveWorkspace();
  const repoPath = ws ? ws.path : "";
  const basename = file.split("/").pop();
  const fullFilePath = repoPath ? `${repoPath}/${file}` : file;

  const diffTitle = commitHash
    ? `⇄ ${basename} (${commitHash.substring(0, 7)})`
    : `⇄ ${basename} (${isStaged ? "Staged" : "Working Tree"})`;

  // Check if already open
  const existing = state.tabs.find((t) =>
    t.type === "diff" &&
    t.diffFile === file &&
    t.isStaged === Boolean(isStaged) &&
    t.commitHash === commitHash
  );

  if (existing) {
    state.switchTab(existing.id);
    return;
  }

  state.createTab(ws, "diff", {
    title: diffTitle,
    diffFile: file,
    filePath: fullFilePath,
    isStaged: Boolean(isStaged),
    gitStatusCode: statusCode || "M",
    commitHash
  });
}
