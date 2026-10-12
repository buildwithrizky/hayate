import { tauriInvoke } from "../api.js";

export async function stageFile(state, file, refreshCallback) {
  const ws = state.getActiveWorkspace();
  if (!ws || !file) return;
  try {
    await tauriInvoke("git_stage", { path: ws.path, file, all: false });
    if (refreshCallback) await refreshCallback();
  } catch (err) {
    alert("Stage error: " + String(err));
  }
}

export async function stageAll(state, refreshCallback) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  try {
    await tauriInvoke("git_stage", { path: ws.path, file: null, all: true });
    if (refreshCallback) await refreshCallback();
  } catch (err) {
    alert("Stage all error: " + String(err));
  }
}

export async function unstageFile(state, file, refreshCallback) {
  const ws = state.getActiveWorkspace();
  if (!ws || !file) return;
  try {
    await tauriInvoke("git_unstage", { path: ws.path, file, all: false });
    if (refreshCallback) await refreshCallback();
  } catch (err) {
    alert("Unstage error: " + String(err));
  }
}

export async function unstageAll(state, refreshCallback) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  try {
    await tauriInvoke("git_unstage", { path: ws.path, file: null, all: true });
    if (refreshCallback) await refreshCallback();
  } catch (err) {
    alert("Unstage all error: " + String(err));
  }
}

export async function discardFile(state, file, refreshCallback) {
  const ws = state.getActiveWorkspace();
  if (!ws || !file) return;
  const ok = confirm(`Are you sure you want to discard changes in '${file}'? This cannot be undone.`);
  if (!ok) return;

  try {
    await tauriInvoke("git_discard", { path: ws.path, file, all: false });
    if (refreshCallback) await refreshCallback();
  } catch (err) {
    alert("Discard error: " + String(err));
  }
}

export async function discardAll(state, refreshCallback) {
  const ws = state.getActiveWorkspace();
  if (!ws) return;
  const ok = confirm("Are you sure you want to discard all changes in working tree? This cannot be undone.");
  if (!ok) return;

  try {
    await tauriInvoke("git_discard", { path: ws.path, file: null, all: true });
    if (refreshCallback) await refreshCallback();
  } catch (err) {
    alert("Discard all error: " + String(err));
  }
}
