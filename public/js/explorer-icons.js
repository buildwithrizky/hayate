// SVG icons per file extension / special filename

const ICONS = {
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  folderOpen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polygon points="2 10 22 10 20 21 4 21"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
  markdown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="7 14 9 12 11 14"/><line x1="9" y1="12" x2="9" y2="18"/><polyline points="13 16 15 14 17 16"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
};

const FILE_MAP = {
  // exact names
  "package.json": { icon: ICONS.gear, color: "var(--text-dim)" },
  "package-lock.json": { icon: ICONS.lock, color: "var(--text-dim)" },
  "cargo.toml": { icon: ICONS.gear, color: "var(--text-dim)" },
  "cargo.lock": { icon: ICONS.lock, color: "var(--text-dim)" },
  "tsconfig.json": { icon: ICONS.gear, color: "var(--text-dim)" },
  "dockerfile": { icon: ICONS.terminal, color: "var(--text-dim)" },
  ".gitignore": { icon: ICONS.gear, color: "var(--text-dim)" },
  ".env": { icon: ICONS.lock, color: "var(--text-dim)" },
  "readme.md": { icon: ICONS.markdown, color: "var(--text-dim)" },
  "license": { icon: ICONS.file, color: "var(--text-dim)" },
};

const EXT_MAP = {
  js: { icon: ICONS.code, color: "var(--text-dim)" },
  mjs: { icon: ICONS.code, color: "var(--text-dim)" },
  cjs: { icon: ICONS.code, color: "var(--text-dim)" },
  jsx: { icon: ICONS.code, color: "var(--text-dim)" },
  ts: { icon: ICONS.code, color: "var(--text-dim)" },
  tsx: { icon: ICONS.code, color: "var(--text-dim)" },
  rs: { icon: ICONS.code, color: "var(--text-dim)" },
  json: { icon: ICONS.gear, color: "var(--text-dim)" },
  toml: { icon: ICONS.gear, color: "var(--text-dim)" },
  yaml: { icon: ICONS.gear, color: "var(--text-dim)" },
  yml: { icon: ICONS.gear, color: "var(--text-dim)" },
  html: { icon: ICONS.code, color: "var(--text-dim)" },
  css: { icon: ICONS.code, color: "var(--text-dim)" },
  scss: { icon: ICONS.code, color: "var(--text-dim)" },
  md: { icon: ICONS.markdown, color: "var(--text-dim)" },
  png: { icon: ICONS.image, color: "var(--text-dim)" },
  jpg: { icon: ICONS.image, color: "var(--text-dim)" },
  jpeg: { icon: ICONS.image, color: "var(--text-dim)" },
  svg: { icon: ICONS.image, color: "var(--text-dim)" },
  gif: { icon: ICONS.image, color: "var(--text-dim)" },
  webp: { icon: ICONS.image, color: "var(--text-dim)" },
  sh: { icon: ICONS.terminal, color: "var(--text-dim)" },
  bash: { icon: ICONS.terminal, color: "var(--text-dim)" },
  zsh: { icon: ICONS.terminal, color: "var(--text-dim)" },
  sql: { icon: ICONS.database, color: "var(--text-dim)" },
  py: { icon: ICONS.code, color: "var(--text-dim)" },
  go: { icon: ICONS.code, color: "var(--text-dim)" },
};

export function getFileIcon(name, isDirectory = false, isOpen = false) {
  if (isDirectory) {
    const icon = isOpen ? ICONS.folderOpen : ICONS.folder;
    return `<span class="rs-file-icon is-folder" style="color:var(--text-dim);">${icon}</span>`;
  }
  const lower = (name || "").toLowerCase();
  if (FILE_MAP[lower]) {
    const def = FILE_MAP[lower];
    return `<span class="rs-file-icon" style="color:${def.color};">${def.icon}</span>`;
  }
  const ext = lower.split(".").pop();
  if (ext && EXT_MAP[ext]) {
    const def = EXT_MAP[ext];
    return `<span class="rs-file-icon" style="color:${def.color};">${def.icon}</span>`;
  }
  return `<span class="rs-file-icon" style="color:var(--text-dim);">${ICONS.file}</span>`;
}
