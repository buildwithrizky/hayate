import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";

test("API /api/workspaces, /api/repos and WebSocket PTY terminal session work", async () => {
  const testPort = "3489";
  const proc = Bun.spawn(["bun", "src/server.ts"], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, PORT: testPort }
  });

  try {
    // wait for server ready
    await new Promise((r) => setTimeout(r, 600));

    const res = await fetch(`http://localhost:${testPort}/api/repos`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.repos)).toBe(true);

    const staticRes = await fetch(`http://localhost:${testPort}/`);
    expect(staticRes.status).toBe(200);

    // Test WebSocket PTY interactive spawn, input, resize, output
    const ws = new WebSocket(`ws://localhost:${testPort}/ws`);
    const outputs: string[] = [];
    let spawned = false;
    let exited = false;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            action: "spawn",
            sessionId: "test-pty-1",
            repoPath: process.cwd(),
            cols: 80,
            rows: 24
          })
        );
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "spawned") {
          spawned = true;
          // Test resize
          ws.send(
            JSON.stringify({
              action: "resize",
              sessionId: "test-pty-1",
              cols: 100,
              rows: 30
            })
          );
          // Test keyboard input
          setTimeout(() => {
            ws.send(
              JSON.stringify({
                action: "input",
                sessionId: "test-pty-1",
                data: "echo INTERACTIVE_PTY_OK; exit\n"
              })
            );
          }, 300);
        } else if (msg.type === "output") {
          outputs.push(msg.text);
        } else if (msg.type === "exit") {
          exited = true;
          ws.close();
          resolve();
        }
      };

      ws.onerror = reject;
      setTimeout(() => reject(new Error("WS timeout")), 15000);
    });

    const fullOutput = outputs.join("");
    expect(spawned).toBe(true);
    expect(fullOutput).toContain("INTERACTIVE_PTY_OK");
    expect(exited).toBe(true);

    // Test File Explorer API
    const filesRes = await fetch(`http://localhost:${testPort}/api/files?path=` + encodeURIComponent(process.cwd()));
    expect(filesRes.status).toBe(200);
    const filesBody = await filesRes.json();
    expect(Array.isArray(filesBody.items)).toBe(true);
    // directories should come first
    const firstFileIdx = filesBody.items.findIndex((i: { isDirectory: boolean }) => !i.isDirectory);
    const lastDirIdx = filesBody.items.findLastIndex((i: { isDirectory: boolean }) => i.isDirectory);
    if (firstFileIdx !== -1 && lastDirIdx !== -1) {
      expect(lastDirIdx).toBeLessThan(firstFileIdx);
    }
    // .git should be filtered out
    expect(filesBody.items.some((i: { name: string }) => i.name === ".git")).toBe(false);

    // Test File Content API
    const contentRes = await fetch(`http://localhost:${testPort}/api/file-content?path=` + encodeURIComponent(process.cwd() + "/package.json"));
    expect(contentRes.status).toBe(200);
    const contentBody = await contentRes.json();
    expect(contentBody.content).toContain("web-ade-harness");

    // Test Git Status API
    const gitStatusRes = await fetch(`http://localhost:${testPort}/api/git/status?path=` + encodeURIComponent(process.cwd()));
    expect(gitStatusRes.status).toBe(200);
    const gitStatusBody = await gitStatusRes.json();
    expect(typeof gitStatusBody.branch).toBe("string");
    expect(Array.isArray(gitStatusBody.staged)).toBe(true);
    expect(Array.isArray(gitStatusBody.unstaged)).toBe(true);
    expect(Array.isArray(gitStatusBody.untracked)).toBe(true);
    expect(Array.isArray(gitStatusBody.ignored)).toBe(true);

    // Test System Status API
    const sysRes = await fetch(`http://localhost:${testPort}/api/system-status`);
    expect(sysRes.status).toBe(200);
    const sysBody = await sysRes.json();
    expect(sysBody.port).toBe(Number(testPort));
    expect(typeof sysBody.processRssMb).toBe("number");
    expect(typeof sysBody.systemUsedGb).toBe("string");
    expect(typeof sysBody.systemTotalGb).toBe("string");
    expect(typeof sysBody.systemPercent).toBe("number");

    // Test Git Diff API
    const gitDiffRes = await fetch(`http://localhost:${testPort}/api/git/diff?path=` + encodeURIComponent(process.cwd()) + "&file=package.json");
    expect(gitDiffRes.status).toBe(200);
    const gitDiffBody = await gitDiffRes.json();
    expect(typeof gitDiffBody.diff).toBe("string");

    // Test Save File Content API (POST & PUT)
    const testTempFile = resolve(tmpdir(), "test-save-content.txt");
    const savePostRes = await fetch(`http://localhost:${testPort}/api/file-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: testTempFile, content: "hello world" })
    });
    expect(savePostRes.status).toBe(200);
    const savePostBody = await savePostRes.json();
    expect(savePostBody.ok).toBe(true);
    expect(savePostBody.path).toBe(testTempFile);
    expect(savePostBody.size).toBe(Buffer.byteLength("hello world"));

    const savePutRes = await fetch(`http://localhost:${testPort}/api/file-content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: testTempFile, content: "updated content" })
    });
    expect(savePutRes.status).toBe(200);
    const savePutBody = await savePutRes.json();
    expect(savePutBody.ok).toBe(true);
    expect(savePutBody.size).toBe(Buffer.byteLength("updated content"));

    // Validation error: empty path
    const invalidPathRes = await fetch(`http://localhost:${testPort}/api/file-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "", content: "abc" })
    });
    expect(invalidPathRes.status).toBe(400);

    // Error handling: invalid directory
    const invalidDirRes = await fetch(`http://localhost:${testPort}/api/file-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/invalid/path/that/does/not/exist/test.txt", content: "abc" })
    });
    expect(invalidDirRes.status).toBe(400);

    try {
      await unlink(testTempFile);
    } catch {}

    // Test Git Log API
    const gitLogRes = await fetch(`http://localhost:${testPort}/api/git/log?path=` + encodeURIComponent(process.cwd()));
    expect(gitLogRes.status).toBe(200);
    const gitLogBody = await gitLogRes.json();
    expect(Array.isArray(gitLogBody.commits)).toBe(true);
    if (gitLogBody.commits.length > 0) {
      const commit = gitLogBody.commits[0];
      expect(typeof commit.hash).toBe("string");
      expect(typeof commit.shortHash).toBe("string");
      expect(typeof commit.author).toBe("string");
      expect(typeof commit.relativeDate).toBe("string");
      expect(typeof commit.message).toBe("string");
    }

    // Test Git Stage, Unstage, Discard in temporary git repo
    const tempRepoDir = resolve(tmpdir(), `ade-git-test-${Date.now()}`);
    await Bun.spawn(["git", "init", tempRepoDir]).exited;
    await Bun.spawn(["git", "-C", tempRepoDir, "config", "user.name", "Tester"]).exited;
    await Bun.spawn(["git", "-C", tempRepoDir, "config", "user.email", "tester@test.local"]).exited;

    // Log on empty repo returns commits: []
    const emptyLogRes = await fetch(`http://localhost:${testPort}/api/git/log?path=` + encodeURIComponent(tempRepoDir));
    expect(emptyLogRes.status).toBe(200);
    expect((await emptyLogRes.json()).commits).toEqual([]);

    // Create untracked file
    const sampleFile = "sample.txt";
    await Bun.write(resolve(tempRepoDir, sampleFile), "initial content\n");

    // Stage file
    const stageRes = await fetch(`http://localhost:${testPort}/api/git/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempRepoDir, file: sampleFile })
    });
    expect(stageRes.status).toBe(200);
    expect((await stageRes.json()).ok).toBe(true);

    // Unstage file (empty repo fallback via git rm --cached)
    const unstageRes = await fetch(`http://localhost:${testPort}/api/git/unstage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempRepoDir, file: sampleFile })
    });
    expect(unstageRes.status).toBe(200);
    expect((await unstageRes.json()).ok).toBe(true);

    // Stage all
    const stageAllRes = await fetch(`http://localhost:${testPort}/api/git/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempRepoDir, all: true })
    });
    expect(stageAllRes.status).toBe(200);
    expect((await stageAllRes.json()).ok).toBe(true);

    // Initial commit
    await Bun.spawn(["git", "-C", tempRepoDir, "commit", "-m", "initial commit"]).exited;

    // Modify file
    await Bun.write(resolve(tempRepoDir, sampleFile), "modified content\n");

    // Discard tracked changes
    const discardTrackedRes = await fetch(`http://localhost:${testPort}/api/git/discard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempRepoDir, file: sampleFile })
    });
    expect(discardTrackedRes.status).toBe(200);
    expect((await discardTrackedRes.json()).ok).toBe(true);
    expect(await Bun.file(resolve(tempRepoDir, sampleFile)).text()).toBe("initial content\n");

    // Discard untracked file
    const untrackedFile = "untracked.txt";
    await Bun.write(resolve(tempRepoDir, untrackedFile), "untracked data\n");
    const discardUntrackedRes = await fetch(`http://localhost:${testPort}/api/git/discard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempRepoDir, file: untrackedFile })
    });
    expect(discardUntrackedRes.status).toBe(200);
    expect((await discardUntrackedRes.json()).ok).toBe(true);
    expect(await Bun.file(resolve(tempRepoDir, untrackedFile)).exists()).toBe(false);

    // Cleanup temp repo
    const { rm } = await import("node:fs/promises");
    await rm(tempRepoDir, { recursive: true, force: true });
  } finally {
    proc.kill();
  }
}, 20000);
