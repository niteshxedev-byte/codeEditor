import { spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";

/**
 * Local code execution engine — no external API required.
 * Each language runs via its native compiler/interpreter installed on the host.
 */

const EXEC_TIMEOUT_MS = 10_000;

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
 * Spawns a child process, captures stdout/stderr, enforces timeout.
 *
 * @param {string}   cmd
 * @param {string[]} args
 * @param {{ cwd?: string, input?: string }} [options]
 * @returns {Promise<{ stdout: string, stderr: string, code: number|null, timedOut: boolean }>}
 */
async function runProcess(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: options.cwd, shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, EXEC_TIMEOUT_MS);

    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, code: -1, timedOut: false });
    });

    if (options.input) {
      proc.stdin?.write(options.input);
    }
    proc.stdin?.end();
  });
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
        if (res.timedOut)  status = "Time Limit Exceeded";
        else if (res.code !== 0) status = "Runtime Error";
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
        if (res.timedOut)  status = "Time Limit Exceeded";
        else if (res.code !== 0) status = "Runtime Error";
        break;
      }

      // --- Python ---
      case 3: {
        const res = await runProcess("python3", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        if (res.timedOut)  status = "Time Limit Exceeded";
        else if (res.code !== 0) status = "Runtime Error";
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
        if (compRes.code !== 0) {
          status = "Compilation Error";
          break;
        }
        const runRes = await runProcess(outFile, [], procOpts);
        stdout = runRes.stdout;
        stderr = runRes.stderr;
        if (runRes.timedOut)  status = "Time Limit Exceeded";
        else if (runRes.code !== 0) status = "Runtime Error";
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
        if (compRes.code !== 0) {
          status = "Compilation Error";
          break;
        }
        const runRes = await runProcess(outFile, [], procOpts);
        stdout = runRes.stdout;
        stderr = runRes.stderr;
        if (runRes.timedOut)  status = "Time Limit Exceeded";
        else if (runRes.code !== 0) status = "Runtime Error";
        break;
      }

      // --- Java ---
      case 6: {
        const compRes = await runProcess("javac", [sourceFile], { cwd: tmpDir });
        compile_output = compRes.stdout + compRes.stderr;
        if (compRes.code !== 0) {
          status = "Compilation Error";
          break;
        }
        const runRes = await runProcess(
          "java",
          ["-cp", tmpDir, "Main"],
          procOpts
        );
        stdout = runRes.stdout;
        stderr = runRes.stderr;
        if (runRes.timedOut)  status = "Time Limit Exceeded";
        else if (runRes.code !== 0) status = "Runtime Error";
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
        if (compRes.code !== 0) {
          status = "Compilation Error";
          break;
        }
        const runRes = await runProcess(outFile, [], procOpts);
        stdout = runRes.stdout;
        stderr = runRes.stderr;
        if (runRes.timedOut)  status = "Time Limit Exceeded";
        else if (runRes.code !== 0) status = "Runtime Error";
        break;
      }

      // --- Go ---
      case 8: {
        const res = await runProcess("go", ["run", sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        if (res.timedOut)  status = "Time Limit Exceeded";
        else if (res.code !== 0) status = "Runtime Error";
        break;
      }

      // --- C# (dotnet-script) ---
      case 9: {
        const res = await runProcess("dotnet-script", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        if (res.timedOut)  status = "Time Limit Exceeded";
        else if (res.code !== 0) {
          // dotnet-script not installed is a common failure — give helpful hint
          status = "Runtime Error";
          if (res.stderr.includes("not found") || res.stderr.includes("ENOENT")) {
            stderr =
              "dotnet-script is not installed on this server. " +
              "Install it with: dotnet tool install -g dotnet-script\n\n" +
              res.stderr;
          }
        }
        break;
      }

      // --- PHP ---
      case 10: {
        const res = await runProcess("php", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        if (res.timedOut)  status = "Time Limit Exceeded";
        else if (res.code !== 0) status = "Runtime Error";
        break;
      }

      // --- Ruby ---
      case 11: {
        const res = await runProcess("ruby", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        if (res.timedOut)  status = "Time Limit Exceeded";
        else if (res.code !== 0) status = "Runtime Error";
        break;
      }

      // --- Swift (optional — large install, may not be present) ---
      case 12: {
        const res = await runProcess("swift", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        if (res.timedOut) {
          status = "Time Limit Exceeded";
        } else if (res.code !== 0) {
          status = "Runtime Error";
          if (res.stderr.includes("not found") || res.stderr.includes("ENOENT")) {
            stderr =
              "Swift is not installed on this server " +
              "(it is optional due to its large size).\n\n" + res.stderr;
          }
        }
        break;
      }

      // --- Kotlin (optional — large install, may not be present) ---
      case 13: {
        const jarFile = path.join(tmpDir, "solution.jar");
        const compRes = await runProcess(
          "kotlinc",
          [sourceFile, "-include-runtime", "-d", jarFile],
          { cwd: tmpDir }
        );
        compile_output = compRes.stdout + compRes.stderr;
        if (compRes.code !== 0) {
          status = "Compilation Error";
          if (compRes.stderr.includes("not found") || compRes.stderr.includes("ENOENT")) {
            compile_output =
              "Kotlin compiler (kotlinc) is not installed on this server " +
              "(it is optional due to its large size).\n\n" + compile_output;
          }
          break;
        }
        const runRes = await runProcess("java", ["-jar", jarFile], procOpts);
        stdout = runRes.stdout;
        stderr = runRes.stderr;
        if (runRes.timedOut)  status = "Time Limit Exceeded";
        else if (runRes.code !== 0) status = "Runtime Error";
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
        if (res.timedOut)  status = "Time Limit Exceeded";
        else if (res.code !== 0) status = "Runtime Error";
        break;
      }

      // --- Bash ---
      case 15: {
        const res = await runProcess("bash", [sourceFile], procOpts);
        stdout = res.stdout;
        stderr = res.stderr;
        if (res.timedOut)  status = "Time Limit Exceeded";
        else if (res.code !== 0) status = "Runtime Error";
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
};
