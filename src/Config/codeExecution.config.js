import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * Judge0 / Code Execution Configuration
 */
export const JUDGE0_CONFIG = {
  baseURL: process.env.JUDGE0_URL || "https://judge0-ce.p.rapidapi.com",
  apiKey: (process.env.JUDGE0_API_KEY || "").trim(),
  apiHost: "judge0-ce.p.rapidapi.com",
  timeoutMs: 15000,
};

/**
 * Comprehensive mapping of programming languages supported by Judge0 & Monaco
 */
export const SUPPORTED_LANGUAGES = [
  { id: 63, name: "JavaScript (Node.js 12.14.0)", monaco: "javascript" },
  { id: 74, name: "TypeScript (3.7.4)", monaco: "typescript" },
  { id: 71, name: "Python (3.8.1)", monaco: "python" },
  { id: 54, name: "C++ (GCC 9.2.0)", monaco: "cpp" },
  { id: 50, name: "C (GCC 9.2.0)", monaco: "c" },
  { id: 62, name: "Java (OpenJDK 13.0.1)", monaco: "java" },
  { id: 73, name: "Rust (1.40.0)", monaco: "rust" },
  { id: 60, name: "Go (1.13.5)", monaco: "go" },
  { id: 51, name: "C# (Mono 6.6.0.161)", monaco: "csharp" },
  { id: 68, name: "PHP (7.4.1)", monaco: "php" },
  { id: 72, name: "Ruby (2.7.0)", monaco: "ruby" },
  { id: 83, name: "Swift (5.2.3)", monaco: "swift" },
  { id: 78, name: "Kotlin (1.3.70)", monaco: "kotlin" },
  { id: 82, name: "SQL (SQLite 3.27.2)", monaco: "sql" },
  { id: 46, name: "Bash (5.0.0)", monaco: "shell" },
];

/**
 * Helper to safely decode Base64 strings returned by Judge0
 */
function decodeBase64(str) {
  if (!str) return "";
  try {
    return Buffer.from(str, "base64").toString("utf-8");
  } catch (err) {
    return str;
  }
}

/**
 * Executes source code via Judge0 API using Base64 encoding for reliable special character handling
 *
 * @param {Object} options
 * @param {string} options.code - Source code to execute
 * @param {number|string} options.language_id - Judge0 language ID
 * @param {string} [options.stdin] - Optional standard input
 * @returns {Promise<{ stdout: string, stderr: string, compile_output: string, time: string, memory: number, status: string }>}
 */
export async function executeCode({ code, language_id, stdin = "" }) {
  if (!code || typeof code !== "string") {
    throw new Error("Source code is required for execution");
  }

  const langId = Number(language_id) || 63;
  const apiKey = (process.env.JUDGE0_API_KEY || "").trim();

  if (!apiKey || apiKey === "rapidapi_key_here") {
    return {
      stdout: `[Local Simulation Mode]\nCode received (${code.length} bytes, language ID: ${langId}).\nSet your JUDGE0_API_KEY in the .env file to enable live compilation.`,
      stderr: "",
      compile_output: "",
      time: "0.01",
      memory: 1024,
      status: "Local Simulation",
    };
  }

  const client = axios.create({
    baseURL: JUDGE0_CONFIG.baseURL,
    timeout: JUDGE0_CONFIG.timeoutMs,
    headers: {
      "content-type": "application/json",
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": JUDGE0_CONFIG.apiHost,
    },
  });

  try {
    // 1. Submit code to Judge0 with base64_encoded=true & wait=true
    const encodedSource = Buffer.from(code, "utf-8").toString("base64");
    const encodedStdin = stdin ? Buffer.from(stdin, "utf-8").toString("base64") : "";

    const submissionPayload = {
      source_code: encodedSource,
      language_id: langId,
      stdin: encodedStdin,
    };

    if (langId === 54) {
      submissionPayload.compiler_options = "-std=c++17 -O2";
    }

    const submissionRes = await client.post(
      "/submissions?base64_encoded=true&wait=true",
      submissionPayload
    );

    let result = submissionRes.data;

    // 2. If status is In Queue (1) or Processing (2), poll until completed (up to 5 attempts)
    if (result.token && (result.status?.id === 1 || result.status?.id === 2)) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const checkRes = await client.get(
          `/submissions/${result.token}?base64_encoded=true&fields=*`
        );
        result = checkRes.data;
        if (result.status?.id > 2) break; // Finished
      }
    }

    // 3. Decode base64 outputs
    const stdout = decodeBase64(result.stdout);
    const stderr = decodeBase64(result.stderr);
    const compileOutput = decodeBase64(result.compile_output);

    return {
      stdout,
      stderr,
      compile_output: compileOutput,
      time: result.time || "0.00",
      memory: result.memory || 0,
      status: result.status?.description || "Completed",
    };
  } catch (err) {
    const errorDetails =
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.message ||
      "Execution failed";

    console.error("Judge0 Execution Error:", errorDetails);

    return {
      stdout: "",
      stderr: `Execution Error: ${errorDetails}`,
      compile_output: "",
      time: "0.00",
      memory: 0,
      status: "Execution Failed",
    };
  }
}

export default {
  JUDGE0_CONFIG,
  SUPPORTED_LANGUAGES,
  executeCode,
};
