import { readdir, stat, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { homedir, totalmem, freemem } from "node:os";
import type { ServerWebSocket } from "bun";
import { spawnPty, type PtyInstance } from "./pty/index";

const PORT = Number(process.env.PORT || 3456);
const CONFIG_DIR = process.env.ADE_CONFIG_DIR || resolve(homedir(), ".ade");
const WORKSPACES_FILE = resolve(CONFIG_DIR, "workspaces.json");
const PUBLIC_DIR = resolve(import.meta.dir, "../public");

const bunBinDir = resolve(homedir(), ".bun/bin");
const extendedPath = [
  bunBinDir,
  "/opt/homebrew/bin",
  "/usr/local/bin",
  process.env.PATH || ""
].filter(Boolean).join(":");

interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

interface TerminalSession {
  sessionId: string;
  pty: PtyInstance;
  repoPath: string;
}

// Map of sessionId -> TerminalSession
const activeSessions = new Map<string, TerminalSession>();
// Map of ws -> Set<sessionId>
const wsSessions = new Map<ServerWebSocket<unknown>, Set<string>>();

async function getWorkspaces(): Promise<Workspace[]> {
  try {
    const raw = await readFile(WORKSPACES_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveWorkspaces(list: Workspace[]): Promise<void> {
  await writeFile(WORKSPACES_FILE, JSON.stringify(list, null, 2), "utf-8");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function cleanupAllSessions() {
  for (const [id, session] of activeSessions.entries()) {
    try {
      session.pty.kill();
    } catch {}
  }
  activeSessions.clear();
  wsSessions.clear();
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket Upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, { data: { id: crypto.randomUUID() } });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Workspaces: Native macOS Folder Picker
    if (url.pathname === "/api/pick-folder" && req.method === "POST") {
      try {
        const proc = Bun.spawn([
          "osascript",
          "-e",
          'POSIX path of (choose folder with prompt "Select Project Folder")'
        ], {
          stdout: "pipe",
          stderr: "pipe"
        });

        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          return Response.json({ canceled: true }, { status: 200 });
        }

        const rawOutput = await new Response(proc.stdout).text();
        const selectedPath = rawOutput.trim().replace(/\/+$/, "");

        if (!selectedPath) {
          return Response.json({ canceled: true }, { status: 200 });
        }

        const name = basename(selectedPath) || selectedPath;
        const list = await getWorkspaces();
        let workspace = list.find(w => w.path === selectedPath);

        if (!workspace) {
          workspace = {
            id: "ws_" + crypto.randomUUID().replace(/-/g, "").slice(0, 10),
            name,
            path: selectedPath,
            createdAt: Date.now()
          };
          list.push(workspace);
          await saveWorkspaces(list);
        }

        return Response.json(workspace, { status: 201 });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // Workspaces: List & Create
    if (url.pathname === "/api/workspaces") {
      if (req.method === "GET") {
        const list = await getWorkspaces();
        return Response.json(list);
      }

      if (req.method === "POST") {
        try {
          const body = await req.json() as { name?: string; path?: string };
          const name = body.name?.trim();
          const targetPath = body.path?.trim();

          if (!name || !targetPath) {
            return Response.json({ error: "name and path required" }, { status: 400 });
          }

          const resolvedPath = resolve(targetPath);
          const exists = await pathExists(resolvedPath);
          if (!exists) {
            return Response.json({ error: "Directory path does not exist" }, { status: 400 });
          }

          const list = await getWorkspaces();
          const workspace: Workspace = {
            id: "ws_" + crypto.randomUUID().replace(/-/g, "").slice(0, 10),
            name,
            path: resolvedPath,
            createdAt: Date.now()
          };
          list.push(workspace);
          await saveWorkspaces(list);
          return Response.json(workspace, { status: 201 });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 400 });
        }
      }
    }

    // Workspaces: Update & Delete
    if (url.pathname.startsWith("/api/workspaces/")) {
      const id = url.pathname.slice("/api/workspaces/".length);
      const list = await getWorkspaces();
      const idx = list.findIndex(w => w.id === id);

      if (idx === -1) {
        return Response.json({ error: "Workspace not found" }, { status: 404 });
      }

      if (req.method === "PUT") {
        try {
          const body = await req.json() as { name?: string; path?: string };
          const name = body.name?.trim();
          const targetPath = body.path?.trim();

          if (!name || !targetPath) {
            return Response.json({ error: "name and path required" }, { status: 400 });
          }

          const resolvedPath = resolve(targetPath);
          const exists = await pathExists(resolvedPath);
          if (!exists) {
            return Response.json({ error: "Directory path does not exist" }, { status: 400 });
          }

          list[idx].name = name;
          list[idx].path = resolvedPath;
          await saveWorkspaces(list);
          return Response.json(list[idx]);
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 400 });
        }
      }

      if (req.method === "DELETE") {
        const deleted = list.splice(idx, 1)[0];
        await saveWorkspaces(list);
        return Response.json({ ok: true, deleted });
      }
    }

    // Helper: Directory browse
    if (req.method === "GET" && url.pathname === "/api/browse") {
      const dirQuery = url.searchParams.get("dir") || homedir();
      const resolvedDir = resolve(dirQuery);
      try {
        const entries = await readdir(resolvedDir, { withFileTypes: true });
        const dirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith("."))
          .map(e => join(resolvedDir, e.name));
        return Response.json({ current: resolvedDir, dirs });
      } catch (err) {
        return Response.json({ error: String(err), dirs: [] }, { status: 400 });
      }
    }

    // Backward-compat for repos
    if (req.method === "GET" && url.pathname === "/api/repos") {
      const list = await getWorkspaces();
      return Response.json({ root: "", repos: list.map(w => w.path) });
    }

    // File Explorer: list files & directories
    if (req.method === "GET" && url.pathname === "/api/files") {
      const workspaceId = url.searchParams.get("workspaceId");
      let targetPath = url.searchParams.get("path");

      if (!targetPath && workspaceId) {
        const list = await getWorkspaces();
        const ws = list.find(w => w.id === workspaceId);
        if (ws) targetPath = ws.path;
      }

      if (!targetPath) {
        return Response.json({ error: "path or workspaceId required" }, { status: 400 });
      }

      const resolved = resolve(targetPath);
      try {
        const entries = await readdir(resolved, { withFileTypes: true });
        const items = await Promise.all(
          entries
            .filter(e => e.name !== ".git" && !e.name.startsWith(".DS_Store"))
            .map(async (entry) => {
              const fullPath = join(resolved, entry.name);
              const isDir = entry.isDirectory();
              let size = 0;
              let modifiedTime = 0;
              try {
                const s = await stat(fullPath);
                size = s.size;
                modifiedTime = s.mtimeMs;
              } catch {}
              return {
                name: entry.name,
                path: fullPath,
                isDirectory: isDir,
                size,
                modifiedTime
              };
            })
        );

        items.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });

        return Response.json({ path: resolved, items });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 400 });
      }
    }

    // File Explorer: quick view file content (limit 1MB)
    if (req.method === "GET" && url.pathname === "/api/file-content") {
      const filePath = url.searchParams.get("path");
      if (!filePath) {
        return Response.json({ error: "path required" }, { status: 400 });
      }

      const resolved = resolve(filePath);
      try {
        const s = await stat(resolved);
        if (s.isDirectory()) {
          return Response.json({ error: "Path is directory" }, { status: 400 });
        }
        const MAX_BYTES = 1024 * 1024; // 1MB
        if (s.size > MAX_BYTES) {
          return Response.json({
            error: "File too large (> 1MB)",
            size: s.size,
            truncated: true
          }, { status: 413 });
        }

        const content = await readFile(resolved, "utf-8");
        return Response.json({ path: resolved, content, size: s.size });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 400 });
      }
    }

    // File Explorer: save file content
    if ((req.method === "POST" || req.method === "PUT") && url.pathname === "/api/file-content") {
      try {
        const body = await req.json() as { path?: string; content?: string };
        const rawPath = body.path?.trim();
        if (!rawPath) {
          return Response.json({ error: "path required" }, { status: 400 });
        }
        if (typeof body.content !== "string") {
          return Response.json({ error: "content string required" }, { status: 400 });
        }

        const resolved = resolve(rawPath);
        // ponytail: direct writeFile, add atomic tempfile rename when concurrent writes happen
        await writeFile(resolved, body.content, "utf-8");
        return Response.json({
          ok: true,
          path: resolved,
          size: Buffer.byteLength(body.content)
        });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 400 });
      }
    }

    // Git: status
    if (req.method === "GET" && url.pathname === "/api/git/status") {
      const repoPath = url.searchParams.get("path");
      if (!repoPath) {
        return Response.json({ error: "path required" }, { status: 400 });
      }

      const cwd = resolve(repoPath);
      try {
        const proc = Bun.spawn(["git", "status", "--porcelain=v1", "--ignored=traditional", "-b"], {
          cwd,
          env: { ...process.env, PATH: extendedPath },
          stdout: "pipe",
          stderr: "pipe"
        });
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text()
        ]);
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
          return Response.json({ error: stderr.trim() || "git status failed" }, { status: 400 });
        }

        const lines = stdout.split("\n").filter(Boolean);
        let branch = "";
        let upstream = "";
        const staged: Array<{ file: string; status: string }> = [];
        const unstaged: Array<{ file: string; status: string }> = [];
        const untracked: string[] = [];
        const ignored: string[] = [];

        for (const line of lines) {
          if (line.startsWith("## ")) {
            const branchLine = line.slice(3).trim();
            // Format: branch...upstream [ahead X, behind Y] or Initial commit on branch / No commits yet on branch
            if (branchLine.includes("No commits yet on ") || branchLine.includes("Initial commit on ")) {
              branch = branchLine.replace(/^(No commits yet on |Initial commit on )/, "").trim();
            } else {
              const [bPart, uPart] = branchLine.split("...");
              branch = bPart || "";
              if (uPart) {
                upstream = uPart.split(" ")[0] || "";
              }
            }
            continue;
          }

          if (line.startsWith("!! ")) {
            ignored.push(line.slice(3).trim());
            continue;
          }

          const x = line[0];
          const y = line[1];
          const file = line.slice(3).trim();

          if (x === "?" && y === "?") {
            untracked.push(file);
          } else {
            if (x && x !== " " && x !== "?") {
              staged.push({ file, status: x });
            }
            if (y && y !== " " && y !== "?") {
              unstaged.push({ file, status: y });
            }
          }
        }

        return Response.json({
          branch,
          upstream,
          staged,
          unstaged,
          untracked,
          ignored,
          clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0
        });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // Git: diff
    if (req.method === "GET" && url.pathname === "/api/git/diff") {
      const repoPath = url.searchParams.get("path");
      const targetFile = url.searchParams.get("file");
      const stagedOnly = url.searchParams.get("staged") === "true";
      const commitHash = url.searchParams.get("commit");

      if (!repoPath) {
        return Response.json({ error: "path required" }, { status: 400 });
      }

      const cwd = resolve(repoPath);
      let args = ["git", "diff"];

      if (commitHash) {
        // Show commit changes: git show <hash> or git diff <hash>~1 <hash>
        args = ["git", "show", "--patch", commitHash];
      } else {
        if (stagedOnly) {
          args.push("--cached");
        } else {
          args.push("HEAD");
        }
        if (targetFile) {
          args.push("--", targetFile);
        }
      }

      try {
        let proc = Bun.spawn(args, {
          cwd,
          env: { ...process.env, PATH: extendedPath },
          stdout: "pipe",
          stderr: "pipe"
        });
        let [diff, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text()
        ]);
        let exitCode = await proc.exited;

        // Fallback for repo with no commits yet: git diff HEAD fails
        if (exitCode !== 0 && !stagedOnly) {
          const fallbackArgs = ["git", "diff"];
          if (targetFile) fallbackArgs.push("--", targetFile);
          proc = Bun.spawn(fallbackArgs, {
            cwd,
            env: { ...process.env, PATH: extendedPath },
            stdout: "pipe",
            stderr: "pipe"
          });
          [diff, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text()
          ]);
          exitCode = await proc.exited;
        }

        return Response.json({ diff, file: targetFile || null });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // Git: commit
    if (req.method === "POST" && url.pathname === "/api/git/commit") {
      try {
        const body = await req.json() as { path?: string; message?: string; stageAll?: boolean };
        const repoPath = body.path?.trim();
        const message = body.message?.trim();
        const stageAll = body.stageAll !== false;

        if (!repoPath || !message) {
          return Response.json({ error: "path and message required" }, { status: 400 });
        }

        const cwd = resolve(repoPath);

        if (stageAll) {
          const addProc = Bun.spawn(["git", "add", "-A"], {
            cwd,
            env: { ...process.env, PATH: extendedPath },
            stdout: "pipe",
            stderr: "pipe"
          });
          const addCode = await addProc.exited;
          if (addCode !== 0) {
            const err = await new Response(addProc.stderr).text();
            return Response.json({ error: `git add failed: ${err.trim()}` }, { status: 400 });
          }
        }

        const commitProc = Bun.spawn(["git", "commit", "-m", message], {
          cwd,
          env: { ...process.env, PATH: extendedPath },
          stdout: "pipe",
          stderr: "pipe"
        });
        const [stdout, stderr] = await Promise.all([
          new Response(commitProc.stdout).text(),
          new Response(commitProc.stderr).text()
        ]);
        const commitCode = await commitProc.exited;

        if (commitCode !== 0) {
          return Response.json({ error: stderr.trim() || stdout.trim() || "git commit failed" }, { status: 400 });
        }

        return Response.json({ ok: true, output: stdout.trim() });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // Git: log
    if (req.method === "GET" && url.pathname === "/api/git/log") {
      const repoPath = url.searchParams.get("path");
      if (!repoPath) {
        return Response.json({ error: "path required" }, { status: 400 });
      }

      const cwd = resolve(repoPath);
      try {
        const proc = Bun.spawn(["git", "log", "-n", "25", "--pretty=format:%H|%h|%an|%ar|%s"], {
          cwd,
          env: { ...process.env, PATH: extendedPath },
          stdout: "pipe",
          stderr: "pipe"
        });
        const stdout = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;

        if (exitCode !== 0 || !stdout.trim()) {
          return Response.json({ commits: [] });
        }

        const commits = stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [hash = "", shortHash = "", author = "", relativeDate = "", ...msgParts] = line.split("|");
            return {
              hash,
              shortHash,
              author,
              relativeDate,
              message: msgParts.join("|")
            };
          });

        return Response.json({ commits });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // Git: stage
    if (req.method === "POST" && url.pathname === "/api/git/stage") {
      try {
        const body = await req.json() as { path?: string; file?: string; all?: boolean };
        const repoPath = body.path?.trim();
        if (!repoPath) {
          return Response.json({ error: "path required" }, { status: 400 });
        }

        const cwd = resolve(repoPath);
        const args = body.all ? ["git", "add", "-A"] : body.file ? ["git", "add", "--", body.file] : null;
        if (!args) {
          return Response.json({ error: "file or all required" }, { status: 400 });
        }

        const proc = Bun.spawn(args, {
          cwd,
          env: { ...process.env, PATH: extendedPath },
          stdout: "pipe",
          stderr: "pipe"
        });
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
          return Response.json({ error: stderr.trim() || "git add failed" }, { status: 400 });
        }

        return Response.json({ ok: true });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // Git: unstage
    if (req.method === "POST" && url.pathname === "/api/git/unstage") {
      try {
        const body = await req.json() as { path?: string; file?: string; all?: boolean };
        const repoPath = body.path?.trim();
        if (!repoPath) {
          return Response.json({ error: "path required" }, { status: 400 });
        }

        const cwd = resolve(repoPath);
        const resetArgs = body.all ? ["git", "reset", "HEAD"] : body.file ? ["git", "reset", "HEAD", "--", body.file] : null;
        if (!resetArgs) {
          return Response.json({ error: "file or all required" }, { status: 400 });
        }

        let proc = Bun.spawn(resetArgs, {
          cwd,
          env: { ...process.env, PATH: extendedPath },
          stdout: "pipe",
          stderr: "pipe"
        });
        let stderr = await new Response(proc.stderr).text();
        let exitCode = await proc.exited;

        // Fallback if no initial commit
        if (exitCode !== 0) {
          const rmArgs = body.all ? ["git", "rm", "--cached", "-r", "--", "."] : ["git", "rm", "--cached", "-r", "--", body.file!];
          proc = Bun.spawn(rmArgs, {
            cwd,
            env: { ...process.env, PATH: extendedPath },
            stdout: "pipe",
            stderr: "pipe"
          });
          stderr = await new Response(proc.stderr).text();
          exitCode = await proc.exited;
        }

        if (exitCode !== 0) {
          return Response.json({ error: stderr.trim() || "git unstage failed" }, { status: 400 });
        }

        return Response.json({ ok: true });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // Git: discard
    if (req.method === "POST" && url.pathname === "/api/git/discard") {
      try {
        const body = await req.json() as { path?: string; file?: string; all?: boolean };
        const repoPath = body.path?.trim();
        if (!repoPath) {
          return Response.json({ error: "path required" }, { status: 400 });
        }

        const cwd = resolve(repoPath);

        // Discard all changes in working tree
        if (body.all) {
          // 1. Unstage any staged files
          const unstageProc = Bun.spawn(["git", "restore", "--staged", "."], {
            cwd,
            env: { ...process.env, PATH: extendedPath },
            stdout: "pipe",
            stderr: "pipe"
          });
          await unstageProc.exited;

          // 2. Restore tracked modified files in working tree
          const restoreProc = Bun.spawn(["git", "restore", "--worktree", "."], {
            cwd,
            env: { ...process.env, PATH: extendedPath },
            stdout: "pipe",
            stderr: "pipe"
          });
          const restoreCode = await restoreProc.exited;
          if (restoreCode !== 0) {
            const checkoutProc = Bun.spawn(["git", "checkout", "--", "."], {
              cwd,
              env: { ...process.env, PATH: extendedPath },
              stdout: "pipe",
              stderr: "pipe"
            });
            await checkoutProc.exited;
          }

          // 3. Clean untracked files
          const cleanProc = Bun.spawn(["git", "clean", "-fd"], {
            cwd,
            env: { ...process.env, PATH: extendedPath },
            stdout: "pipe",
            stderr: "pipe"
          });
          await cleanProc.exited;

          return Response.json({ ok: true });
        }

        const file = body.file?.trim();
        if (!file) {
          return Response.json({ error: "file or all required" }, { status: 400 });
        }

        const targetPath = resolve(cwd, file);

        // Security check: must stay inside repo
        if (!targetPath.startsWith(cwd + "/") && targetPath !== cwd) {
          return Response.json({ error: "file outside repository path" }, { status: 400 });
        }

        // 1. Try clean untracked
        const cleanProc = Bun.spawn(["git", "clean", "-fd", "--", file], {
          cwd,
          env: { ...process.env, PATH: extendedPath },
          stdout: "pipe",
          stderr: "pipe"
        });
        await cleanProc.exited;

        // 2. Try restore tracked changes
        const restoreProc = Bun.spawn(["git", "restore", "--staged", "--worktree", "--", file], {
          cwd,
          env: { ...process.env, PATH: extendedPath },
          stdout: "pipe",
          stderr: "pipe"
        });
        const restoreCode = await restoreProc.exited;

        if (restoreCode !== 0) {
          const checkoutProc = Bun.spawn(["git", "checkout", "--", file], {
            cwd,
            env: { ...process.env, PATH: extendedPath },
            stdout: "pipe",
            stderr: "pipe"
          });
          await checkoutProc.exited;
        }

        // 3. Fallback: if untracked physical file still exists inside repoPath, remove safely
        try {
          const s = await stat(targetPath);
          // Check if file is tracked by git
          const lsProc = Bun.spawn(["git", "ls-files", "--error-unmatch", "--", file], {
            cwd,
            env: { ...process.env, PATH: extendedPath },
            stdout: "pipe",
            stderr: "pipe"
          });
          const isTracked = (await lsProc.exited) === 0;

          if (!isTracked && s) {
            await rm(targetPath, { recursive: true, force: true });
          }
        } catch {}

        return Response.json({ ok: true });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // System status
    if (req.method === "GET" && url.pathname === "/api/system-status") {
      const total = totalmem();
      const free = freemem();
      const used = total - free;
      return Response.json({
        port: PORT,
        processRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        systemUsedGb: (used / (1024 ** 3)).toFixed(1),
        systemTotalGb: (total / (1024 ** 3)).toFixed(1),
        systemPercent: Math.round((used / total) * 100)
      });
    }

    // Static Assets serving from public/ with SPA fallback
    const publicTarget = join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    const publicFile = Bun.file(publicTarget);
    if (await publicFile.exists()) {
      return new Response(publicFile);
    }

    // SPA Fallback: return public/index.html if non-API route
    if (!url.pathname.startsWith("/api/")) {
      const publicIndex = Bun.file(join(PUBLIC_DIR, "index.html"));
      if (await publicIndex.exists()) {
        return new Response(publicIndex);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws) {
      wsSessions.set(ws, new Set());
    },
    message(ws, message) {
      try {
        const data = JSON.parse(String(message));

        // Start interactive terminal session
        if (data.action === "spawn") {
          const { repoPath, sessionId, cols = 80, rows = 24 } = data;
          if (!sessionId || !repoPath) {
            ws.send(JSON.stringify({ type: "error", error: "sessionId and repoPath required" }));
            return;
          }

          // Kill existing if already open for this session
          if (activeSessions.has(sessionId)) {
            const existing = activeSessions.get(sessionId)!;
            existing.pty.kill();
            activeSessions.delete(sessionId);
          }

          try {
            const pty = spawnPty({
              cwd: repoPath,
              cols,
              rows,
              env: {
                PATH: extendedPath,
                HOME: process.env.HOME || homedir(),
              }
            });

            const session: TerminalSession = {
              sessionId,
              pty,
              repoPath
            };

            activeSessions.set(sessionId, session);
            const userSessions = wsSessions.get(ws);
            if (userSessions) userSessions.add(sessionId);

            ws.send(JSON.stringify({
              type: "spawned",
              sessionId,
              pid: pty.pid,
              repoPath
            }));

            pty.onData((text) => {
              try {
                ws.send(JSON.stringify({
                  type: "output",
                  sessionId,
                  text
                }));
              } catch {}
            });

            pty.onExit((code) => {
              activeSessions.delete(sessionId);
              if (userSessions) userSessions.delete(sessionId);
              try {
                ws.send(JSON.stringify({
                  type: "exit",
                  sessionId,
                  code
                }));
              } catch {}
            });
          } catch (spawnErr) {
            const errMsg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
            ws.send(JSON.stringify({
              type: "error",
              sessionId,
              error: `Terminal spawn failed: ${errMsg}`
            }));
          }
          return;
        }

        // Terminal input (keystrokes, commands, control codes)
        if (data.action === "input") {
          const { sessionId, data: inputData } = data;
          if (sessionId && inputData !== undefined) {
            const session = activeSessions.get(sessionId);
            if (session) {
              session.pty.write(inputData);
            }
          }
          return;
        }

        // Resize terminal cols & rows
        if (data.action === "resize") {
          const { sessionId, cols, rows } = data;
          if (sessionId && cols && rows) {
            const session = activeSessions.get(sessionId);
            if (session) {
              session.pty.resize(cols, rows);
            }
          }
          return;
        }

        // Kill terminal session
        if (data.action === "kill" || data.action === "stop") {
          const { sessionId } = data;
          if (sessionId && activeSessions.has(sessionId)) {
            const session = activeSessions.get(sessionId)!;
            session.pty.kill();
            activeSessions.delete(sessionId);
            const userSessions = wsSessions.get(ws);
            if (userSessions) userSessions.delete(sessionId);
            ws.send(JSON.stringify({ type: "stopped", sessionId }));
          }
          return;
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", error: String(err) }));
      }
    },
    close(ws) {
      const userSessions = wsSessions.get(ws);
      if (userSessions) {
        for (const sessionId of userSessions) {
          const session = activeSessions.get(sessionId);
          if (session) {
            session.pty.kill();
            activeSessions.delete(sessionId);
          }
        }
        wsSessions.delete(ws);
      }
    }
  }
});

// Graceful shutdown on Ctrl+C / SIGTERM
process.on("SIGINT", () => {
  console.log("\nShutting down server...");
  cleanupAllSessions();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanupAllSessions();
  process.exit(0);
});

console.log(`Web ADE Harness running at http://localhost:${PORT}`);
