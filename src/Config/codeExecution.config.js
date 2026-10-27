import { spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";

/**
 * Local code execution engine with security hardening:
 * - Isolated SAFE_ENV (never inherits process.env)
 * - 5,000ms wall-clock hard timeout with SIGKILL
 * - 100 KB max stdout+stderr output cap
 * - Graceful ENOENT error handling (503 sandbox unavailable)
 * - Per-user & global concurrency limits
 */

const EXEC_TIMEOUT_MS = 5000; // 5 seconds strict wall-clock timeout
const MAX_OUTPUT_BYTES = 100 * 1024; // 100 KB output limit

// Explicit safe environment allowlist: strictly omit parent secrets & tokens
const cleanPath = (process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
  .split(":")
  .filter((p) => p && !p.startsWith("/home/"))
  .join(":") || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

const SAFE_ENV = Object.freeze({
  PATH: cleanPath,
  HOME: "/tmp",
  TMPDIR: "/tmp",
  LANG: "C.UTF-8",
});

// Concurrency tracking: 1 run per user, global max configurable
const activeUserRuns = new Set();
let globalActiveRuns = 0;

export function acquireExecutionSlot(userId) {
  const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_RUNS, 10) || 5;
  if (globalActiveRuns >= maxConcurrent) {
    return {
      allowed: false,
      status: 429,
      error: `Global execution limit reached (${maxConcurrent} concurrent runs). Please wait and try again.`,
    };
  }
  if (userId && activeUserRuns.has(userId)) {
    return {
      allowed: false,
      status: 429,
      error: "You already have a code execution in progress. Please wait for it to complete.",
    };
  }

  globalActiveRuns++;
  if (userId) activeUserRuns.add(userId);
  return { allowed: true };
}

export function releaseExecutionSlot(userId) {
  globalActiveRuns = Math.max(0, globalActiveRuns - 1);
  if (userId) activeUserRuns.delete(userId);
}

/**
 * Sequential language IDs (1-15) mapped to local runtimes.
 * The `monaco` field drives Monaco Editor syntax highlighting.
 */
export const SUPPORTED_LANGUAGES = [
  { id: 1,  name: "JavaScript (Node.js)",      monaco: "javascript", ext: "js"    },
  { id: 2,  name: "TypeScript (ts-node)",       monaco: "typescript", ext: "ts"    },
  { id: 3,  name: "Python (python3)",           monaco: "python",     ext: "py"    },
  { id: 4,  name: "C++ (GCC, C++17)",           monaco: "cpp",        ext: "cpp"   },
  { id: 5,  name: "C (GCC)",                    monaco: "c",          ext: "c"     },
  { id: 6,  name: "Java (OpenJDK)",             monaco: "java",       ext: "java"  },
  { id: 7,  name: "Rust (rustc)",               monaco: "rust",       ext: "rs"    },
  { id: 8,  name: "Go (go run)",                monaco: "go",         ext: "go"    },
  { id: 9,  name: "C# (dotnet-script)",         monaco: "csharp",     ext: "cs"    },
  { id: 10, name: "PHP (php)",                  monaco: "php",        ext: "php"   },
  { id: 11, name: "Ruby (ruby)",                monaco: "ruby",       ext: "rb"    },
  { id: 12, name: "Swift (swift)",              monaco: "swift",      ext: "swift" },
  { id: 13, name: "Kotlin (kotlinc)",           monaco: "kotlin",     ext: "kt"    },
  { id: 14, name: "SQL (SQLite)",               monaco: "sql",        ext: "sql"   },
  { id: 15, name: "Bash",                       monaco: "shell",      ext: "sh"    },
];

/**
 * Spawns a child process with:
 * - SAFE_ENV allowlist (never spreading process.env)
 * - 5,000ms wall-clock timeout killing with SIGKILL
 * - 100 KB stdout+stderr output cap
 * - Safe stdio handling with graceful ENOENT capture
 *
 * @param {string}   cmd
 * @param {string[]} args
 * @param {{ cwd?: string, input?: string }} [options]
 * @returns {Promise<{ stdout: string, stderr: string, code: number|null, timedOut: boolean, isEnoent: boolean, outputLimitExceeded: boolean }>}
 */
async function runProcess(cmd, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputLimitExceeded = false;
    let isEnoent = false;
    let totalOutputBytes = 0;
    let proc = null;
    let timer = null;

    try {
      proc = spawn(cmd, args, {
        cwd: options.cwd || "/tmp",
        env: SAFE_ENV,
        shell: false,
        stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      });
    } catch (spawnErr) {
      return resolve({
        stdout: "",
        stderr: `Sandbox error: ${spawnErr.message}`,
        code: -1,
        timedOut: false,
        isEnoent: spawnErr.code === "ENOENT",
        outputLimitExceeded: false,
      });
    }

    timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGKILL");
      } catch (_) {}
    }, EXEC_TIMEOUT_MS);

    const onData = (chunk, isStderr = false) => {
      totalOutputBytes += chunk.length;
      if (totalOutputBytes > MAX_OUTPUT_BYTES) {
        if (!outputLimitExceeded) {
          outputLimitExceeded = true;
          stderr += "\n[Execution terminated: combined stdout/stderr exceeded 100 KB limit]";
          try {
            proc.kill("SIGKILL");
          } catch (_) {}
        }
        return;
      }
      if (isStderr) {
        stderr += chunk.toString();
      } else {
        stdout += chunk.toString();
      }
    };

    proc.stdout?.on("data", (chunk) => onData(chunk, false));
    proc.stderr?.on("data", (chunk) => onData(chunk, true));

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        code,
        timedOut,
        isEnoent,
        outputLimitExceeded,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      isEnoent = err.code === "ENOENT";
      const message = isEnoent
        ? `Sandbox unavailable: runtime executable '${cmd}' not found on server.`
        : `Execution failed: ${err.message}`;
      resolve({
        stdout,
        stderr: message,
        code: -1,
        timedOut: false,
        isEnoent,
        outputLimitExceeded,
      });
    });

    if (options.input && proc.stdin) {
      try {
        proc.stdin.write(options.input);
        proc.stdin.end();
      } catch (_) {}
    }
  });
}

function resolveStatus(res, defaultSuccess = "Accepted") {
  if (res.isEnoent) return "Sandbox Unavailable";
  if (res.timedOut) return "Time Limit Exceeded";
  if (res.outputLimitExceeded) return "Output Limit Exceeded";
  if (res.code !== 0) return "Runtime Error";
  return defaultSuccess;
}

function resolveCompileStatus(res) {
  if (res.isEnoent) return "Sandbox Unavailable";
  if (res.timedOut) return "Time Limit Exceeded";
  if (res.outputLimitExceeded) return "Output Limit Exceeded";
  if (res.code !== 0) return "Compilation Error";
  return "Accepted";
}

/**
 * Executes source code locally using the host's installed compilers/interpreters.
 *
 * @param {Object} options
 * @param {string}        options.code        - Source code to execute
 * @param {number|string} options.language_id  - Language ID matching SUPPORTED_LANGUAGES
 * @param {string}        [options.stdin]      - Optional stdin string
 * @returns {Promise<{ stdout: string, stderr: string, compile_output: string, time: string, memory: number, status: string }>}
 */
export async function executeCode({ code, language_id, stdin = "" }) {
  if (!code || typeof code !== "string") {
    throw new Error("Source code is required for execution");
  }

  const langId = Number(language_id) || 1;
  const lang = SUPPORTED_LANGUAGES.find((l) => l.id === langId) ?? SUPPORTED_LANGUAGES[0];
  const startTime = Date.now();

  // Create isolated temp directory for this run
  const runId = randomBytes(8).toString("hex");
  const tmpDir = path.join(tmpdir(), `ce_${runId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const elapsed = () => ((Date.now() - startTime) / 1000).toFixed(3);

  try {
    let sourceFile;
    let compile_output = "";
    let stdout = "";
    let stderr = "";
    let status = "Accepted";

    // ------------------------------------------------------------------
    // Java: class name must be Main, file must be named Main.java
    // ------------------------------------------------------------------
    if (lang.ext === "java") {
      sourceFile = path.join(tmpDir, "Main.java");
      // Replace any public class declaration with 'public class Main'
      const normalized = code.replace(
        /public\s+class\s+\w+/,
        "public class Main"
      );
      fs.writeFileSync(sourceFile, normalized, "utf-8");
    } else {
      sourceFile = path.join(tmpDir, `solution.${lang.ext}`);
      // Go: ensure package main is present
      if (lang.ext === "go" && !/^\s*package\s+main/.test(code)) {
        fs.writeFileSync(sourceFile, `package main\n\n${code}`, "utf-8");
      } else {
        fs.writeFileSync(sourceFile, code, "utf-8");
      }
    }

    // ------------------------------------------------------------------
    // Per-language compile + run dispatch
    // ------------------------------------------------------------------
    const procOpts = { cwd: tmpDir, input: stdin };

    switch (lang.id) {
      // --- JavaScript (Node.js) ---
      case 1: {
        const res = await runProcess("node", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        status = resolveStatus(res);
        break;
      }

      // --- TypeScript (ts-node) ---
      case 2: {
        const res = await runProcess(
          "npx",
          ["ts-node", "--transpile-only", sourceFile],
          procOpts
        );
        stdout = res.stdout;
        stderr = res.stderr;
        status = resolveStatus(res);
        break;
      }

      // --- Python ---
      case 3: {
        const res = await runProcess("python3", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        status = resolveStatus(res);
        break;
      }

      // --- C++ ---
      case 4: {
        const outFile = path.join(tmpDir, "solution.out");
        const compRes = await runProcess(
          "g++",
          ["-std=c++17", "-O2", "-o", outFile, sourceFile],
          { cwd: tmpDir }
        );
        compile_output = compRes.stdout + compRes.stderr;
        status = resolveCompileStatus(compRes);
        if (compRes.code !== 0 || compRes.isEnoent) {
          if (compRes.isEnoent) stderr = compRes.stderr;
          break;
        }
        const runRes = await runProcess(outFile, [], procOpts);
        stdout = runRes.stdout;
        stderr = runRes.stderr;
        status = resolveStatus(runRes);
        break;
      }

      // --- C ---
      case 5: {
        const outFile = path.join(tmpDir, "solution.out");
        const compRes = await runProcess(
          "gcc",
          ["-O2", "-o", outFile, sourceFile],
          { cwd: tmpDir }
        );
        compile_output = compRes.stdout + compRes.stderr;
        status = resolveCompileStatus(compRes);
        if (compRes.code !== 0 || compRes.isEnoent) {
          if (compRes.isEnoent) stderr = compRes.stderr;
          break;
        }
        const runRes = await runProcess(outFile, [], procOpts);
        stdout = runRes.stdout;
        stderr = runRes.stderr;
        status = resolveStatus(runRes);
        break;
      }

      // --- Java ---
      case 6: {
        const compRes = await runProcess("javac", [sourceFile], { cwd: tmpDir });
        compile_output = compRes.stdout + compRes.stderr;
        status = resolveCompileStatus(compRes);
        if (compRes.code !== 0 || compRes.isEnoent) {
          if (compRes.isEnoent) stderr = compRes.stderr;
          break;
        }
        const runRes = await runProcess(
          "java",
          ["-cp", tmpDir, "Main"],
          procOpts
        );
        stdout = runRes.stdout;
        stderr = runRes.stderr;
        status = resolveStatus(runRes);
        break;
      }

      // --- Rust ---
      case 7: {
        const outFile = path.join(tmpDir, "solution.out");
        const compRes = await runProcess(
          "rustc",
          ["-o", outFile, sourceFile],
          { cwd: tmpDir }
        );
        compile_output = compRes.stdout + compRes.stderr;
        status = resolveCompileStatus(compRes);
        if (compRes.code !== 0 || compRes.isEnoent) {
          if (compRes.isEnoent) stderr = compRes.stderr;
          break;
        }
        const runRes = await runProcess(outFile, [], procOpts);
        stdout = runRes.stdout;
        stderr = runRes.stderr;
        status = resolveStatus(runRes);
        break;
      }

      // --- Go ---
      case 8: {
        const res = await runProcess("go", ["run", sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        status = resolveStatus(res);
        break;
      }

      // --- C# (dotnet-script) ---
      case 9: {
        const res = await runProcess("dotnet-script", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        status = resolveStatus(res);
        if (res.code !== 0 && (res.stderr.includes("not found") || res.isEnoent)) {
          stderr = "dotnet-script is not installed on this server. Install it with: dotnet tool install -g dotnet-script\n\n" + res.stderr;
        }
        break;
      }

      // --- PHP ---
      case 10: {
        const res = await runProcess("php", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        status = resolveStatus(res);
        break;
      }

      // --- Ruby ---
      case 11: {
        const res = await runProcess("ruby", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        status = resolveStatus(res);
        break;
      }

      // --- Swift ---
      case 12: {
        const res = await runProcess("swift", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        status = resolveStatus(res);
        break;
      }

      // --- Kotlin ---
      case 13: {
        const jarFile = path.join(tmpDir, "solution.jar");
        const compRes = await runProcess(
          "kotlinc",
          [sourceFile, "-include-runtime", "-d", jarFile],
          { cwd: tmpDir }
        );
        compile_output = compRes.stdout + compRes.stderr;
        status = resolveCompileStatus(compRes);
        if (compRes.code !== 0 || compRes.isEnoent) {
          if (compRes.isEnoent) stderr = compRes.stderr;
          break;
        }
        const runRes = await runProcess("java", ["-jar", jarFile], procOpts);
        stdout = runRes.stdout;
        stderr = runRes.stderr;
        status = resolveStatus(runRes);
        break;
      }

      // --- SQL (SQLite) ---
      case 14: {
        const res = await runProcess("sqlite3", [], {
          ...procOpts,
          input: (stdin ? stdin + "\n" : "") + code,
        });
        stdout = res.stdout;
        stderr = res.stderr;
        status = resolveStatus(res);
        break;
      }

      // --- Bash ---
      case 15: {
        const res = await runProcess("bash", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        status = resolveStatus(res);
        break;
      }

      default: {
        stdout = "";
        stderr = `Unsupported language ID: ${langId}`;
        status = "Unsupported Language";
      }
    }

    return {
      stdout,
      stderr,
      compile_output,
      time: elapsed(),
      memory: 0,
      status,
    };
  } finally {
    // Always clean up the temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      // Non-fatal — temp dir will be cleaned by OS eventually
    }
  }
}

export default {
  SUPPORTED_LANGUAGES,
  executeCode,
  acquireExecutionSlot,
  releaseExecutionSlot,
  SAFE_ENV,
};
