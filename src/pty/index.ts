import { dlopen, FFIType, ptr } from "bun:ffi";
import { join } from "node:path";
import { existsSync } from "node:fs";
import fs from "node:fs";

const ptyDylibPath = join(import.meta.dir, "libpty_macos.dylib");
const cSourcePath = join(import.meta.dir, "pty_macos.c");

// Ensure dylib exists or compile it with clang
if (!existsSync(ptyDylibPath)) {
  const proc = Bun.spawnSync([
    "clang",
    "-shared",
    "-fPIC",
    "-O2",
    cSourcePath,
    "-o",
    ptyDylibPath
  ]);
  if (proc.exitCode !== 0) {
    throw new Error(`Failed to compile pty helper: ${proc.stderr?.toString()}`);
  }
}

const ptyLib = dlopen(ptyDylibPath, {
  pty_open: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32],
    returns: FFIType.i32
  },
  pty_resize: {
    args: [FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.i32
  }
});

const libc = dlopen("/usr/lib/libc.dylib", {
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  write: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 }
});

export interface PtyInstance {
  pid: number;
  masterFd: number;
  stream: fs.ReadStream;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  kill(signal?: number | string): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number) => void): void;
}

export function spawnPty(options: {
  cwd: string;
  cols?: number;
  rows?: number;
  shell?: string;
  env?: Record<string, string | undefined>;
}): PtyInstance {
  const cols = options.cols || 80;
  const rows = options.rows || 24;
  const shell = options.shell || process.env.SHELL || "/bin/zsh";

  const m = new Int32Array(1);
  const s = new Int32Array(1);

  const res = ptyLib.symbols.pty_open(ptr(m), ptr(s), rows, cols);
  if (res !== 0) {
    throw new Error(`openpty failed with return code ${res}`);
  }

  const masterFd = m[0];
  const slaveFd = s[0];

  const mergedEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...(options.env || {}),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "en_US.UTF-8"
  };

  const proc = Bun.spawn([shell, "-l"], {
    stdin: slaveFd,
    stdout: slaveFd,
    stderr: slaveFd,
    cwd: options.cwd,
    env: mergedEnv
  });

  // Close slave in parent immediately
  libc.symbols.close(slaveFd);

  const readStream = fs.createReadStream(null, { fd: masterFd, highWaterMark: 64 * 1024 });

  let isClosed = false;
  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(code: number) => void> = [];

  readStream.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    for (const cb of dataCallbacks) cb(text);
  });
  readStream.on("error", () => {
    // Suppress expected EIO when child process exits
  });

  proc.exited.then((code) => {
    if (!isClosed) {
      isClosed = true;
      try { readStream.destroy(); } catch {}
    }
    for (const cb of exitCallbacks) cb(code);
  });

  return {
    pid: proc.pid,
    masterFd,
    stream: readStream,
    write(data: string | Uint8Array) {
      if (isClosed) return;
      const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      libc.symbols.write(masterFd, ptr(buf), BigInt(buf.length));
    },
    resize(newCols: number, newRows: number) {
      if (isClosed) return;
      ptyLib.symbols.pty_resize(masterFd, newRows, newCols);
    },
    kill(signal: number | string = 9) {
      if (isClosed) return;
      isClosed = true;
      try {
        proc.kill(signal as any);
      } catch {}
      try {
        readStream.destroy();
      } catch {}
    },
    onData(cb: (data: string) => void) {
      dataCallbacks.push(cb);
    },
    onExit(cb: (code: number) => void) {
      exitCallbacks.push(cb);
    }
  };
}
