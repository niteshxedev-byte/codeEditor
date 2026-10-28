import axios from "axios";

/**
 * Codebox Sandboxed Execution Engine Integration.
 * Drop-in Judge0 API compatible code execution service.
 * Supports synchronous wait=true as well as asynchronous submit-and-poll workflows.
 */

const getCodeboxUrl = () => (process.env.CODEBOX_URL || "http://localhost:3000").replace(/\/+$/, "");
const getCodeboxAuthToken = () => process.env.CODEBOX_AUTH_TOKEN || "";
const EXEC_TIMEOUT_MS = 20_000;

/**
 * Supported Languages in Codebox execution sandbox.
 * Strictly aligned with active Codebox runtimes (JavaScript, Python, C++, C, Java, Rust, Bash).
 */
export const SUPPORTED_LANGUAGES = [
  { id: 63, codeboxId: 63, name: "JavaScript (Node.js)", monaco: "javascript", ext: "js" },
  { id: 71, codeboxId: 71, name: "Python (3.x)",         monaco: "python",     ext: "py" },
  { id: 54, codeboxId: 54, name: "C++ (G++)",            monaco: "cpp",        ext: "cpp" },
  { id: 50, codeboxId: 50, name: "C (GCC)",              monaco: "c",          ext: "c" },
  { id: 62, codeboxId: 62, name: "Java (OpenJDK)",        monaco: "java",       ext: "java" },
  { id: 73, codeboxId: 73, name: "Rust (rustc)",         monaco: "rust",       ext: "rs" },
  { id: 46, codeboxId: 46, name: "Bash",                 monaco: "shell",      ext: "sh" },
];

const LEGACY_ID_MAP = {
  1: 63,
  2: 63,
  3: 71,
  4: 54,
  5: 50,
  6: 62,
  7: 73,
  8: 46,
  74: 63,
  92: 71,
  93: 63,
  94: 63,
  102: 63,
};

/**
 * Executes source code inside an isolated Codebox sandbox container.
 * Submits the job and polls until completion, returning stdout, stderr, compile_output, and time.
 *
 * @param {Object} options
 * @param {string}        options.code            - Source code to execute
 * @param {number|string} options.language_id      - Language ID matching SUPPORTED_LANGUAGES or standard Codebox ID
 * @param {string}        [options.stdin]          - Optional stdin input
 * @param {string}        [options.expected_output]- Optional expected output for judge comparison
 * @returns {Promise<{ stdout: string, stderr: string, compile_output: string, time: string, memory: number, status: string, token?: string }>}
 */
export async function executeCode({ code, language_id, stdin = "", expected_output = null }) {
  if (!code || typeof code !== "string") {
    throw new Error("Source code is required for execution");
  }

  const rawId = Number(language_id) || 63;
  const normalizedId = LEGACY_ID_MAP[rawId] || rawId;
  const lang = SUPPORTED_LANGUAGES.find((l) => l.id === normalizedId || l.codeboxId === normalizedId) || SUPPORTED_LANGUAGES[0];
  const targetCodeboxLangId = lang.codeboxId;

  const codeboxUrl = getCodeboxUrl();
  const codeboxAuthToken = getCodeboxAuthToken();

  let submissionCode = code;
  if (targetCodeboxLangId === 62) {
    // Java: Ensure class name is Main so 'javac Main.java && java Main' succeeds without ClassNotFoundException
    if (!/\bclass\s+Main\b/.test(submissionCode)) {
      if (/\b(?:public\s+)?class\s+\w+/.test(submissionCode)) {
        submissionCode = submissionCode.replace(/\b(?:public\s+)?class\s+\w+/, "public class Main");
      } else if (!/\bclass\b/.test(submissionCode)) {
        // Plain snippet without class declaration
        submissionCode = `public class Main {\n    public static void main(String[] args) {\n${submissionCode.split("\n").map((l) => "        " + l).join("\n")}\n    }\n}`;
      }
    }
  }

  const headers = {
    "Content-Type": "application/json",
  };
  if (codeboxAuthToken) {
    headers["X-Auth-Token"] = codeboxAuthToken;
  }

  try {
    // Step 1: Submit code execution job
    const postRes = await axios.post(
      `${codeboxUrl}/submissions`,
      {
        language_id: targetCodeboxLangId,
        source_code: submissionCode,
        stdin: typeof stdin === "string" ? stdin : "",
        ...(expected_output ? { expected_output } : {}),
      },
      {
        headers,
        timeout: 10_000,
        validateStatus: () => true,
      }
    );

    let data = postRes.data;

    if (!data || postRes.status >= 400) {
      return {
        stdout: "",
        stderr: data?.message || data?.error || `Codebox returned error status HTTP ${postRes.status}`,
        compile_output: "",
        time: "0.00",
        memory: 0,
        status: "Execution Engine Error",
      };
    }

    // Step 2: Poll GET /submissions/:token if asynchronous job queued
    const isQueued = data.token && (
      !data.status ||
      data.status.id === 1 || // In Queue
      data.status.id === 2 || // Processing
      (data.stdout === undefined && data.stderr === undefined && data.compile_output === undefined)
    );

    if (isQueued) {
      const token = data.token;
      const pollStart = Date.now();
      let delay = 40;

      while (Date.now() - pollStart < EXEC_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay + 25, 200);

        const getRes = await axios.get(`${codeboxUrl}/submissions/${token}`, {
          headers,
          timeout: 5000,
          validateStatus: () => true,
        });

        if (getRes.status === 200 && getRes.data) {
          data = getRes.data;
          const statusId = data.status?.id ?? 0;
          // Status >= 3 means job has finished (3=Accepted, 4=Wrong Answer, 5=TLE, 6=Compilation Error, 7=Runtime Error, etc.)
          if (statusId >= 3 || data.stdout !== undefined || data.stderr !== undefined || data.compile_output !== undefined) {
            break;
          }
        }
      }
    }

    const statusDescription =
      typeof data.status === "object"
        ? data.status?.description || "Accepted"
        : data.status || "Accepted";

    let duration = "0.00";
    if (data.time !== undefined && data.time !== null) {
      duration = typeof data.time === "number" ? data.time.toFixed(3) : String(data.time);
    }

    return {
      stdout: data.stdout || "",
      stderr: data.stderr || "",
      compile_output: data.compile_output || "",
      time: duration,
      memory: Number(data.memory) || 0,
      status: statusDescription,
      token: data.token || null,
    };
  } catch (error) {
    const isConnRefused =
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND" ||
      error.code === "EAI_AGAIN" ||
      error.code === "ECONNRESET";

    const isTimeout = error.code === "ECONNABORTED" || error.message?.includes("timeout");

    let status = "Execution Error";
    let errorDetails = error.message;

    if (isConnRefused) {
      status = "Service Unavailable";
      errorDetails = `Codebox sandbox service is offline or unreachable at ${codeboxUrl}. Please start Codebox (docker compose up -d) or check CODEBOX_URL in .env.`;
    } else if (isTimeout) {
      status = "Time Limit Exceeded";
      errorDetails = `Execution timed out after ${EXEC_TIMEOUT_MS / 1000}s while awaiting Codebox response.`;
    }

    return {
      stdout: "",
      stderr: errorDetails,
      compile_output: "",
      time: "0.00",
      memory: 0,
      status,
    };
  }
}

/**
 * Cancels a pending or active submission in Codebox.
 * @param {string} token - Submission token
 */
export async function cancelSubmission(token) {
  if (!token) return { success: false, message: "Submission token is required" };
  const codeboxUrl = getCodeboxUrl();
  const headers = { "Content-Type": "application/json" };
  const codeboxAuthToken = getCodeboxAuthToken();
  if (codeboxAuthToken) headers["X-Auth-Token"] = codeboxAuthToken;

  try {
    const res = await axios.delete(`${codeboxUrl}/submissions/${token}`, {
      headers,
      timeout: 5000,
      validateStatus: () => true,
    });
    return res.data;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Fetches language runtime details from Codebox.
 * @param {number|string} languageId
 */
export async function getLanguageDetails(languageId) {
  const codeboxUrl = getCodeboxUrl();
  const headers = { "Content-Type": "application/json" };
  const codeboxAuthToken = getCodeboxAuthToken();
  if (codeboxAuthToken) headers["X-Auth-Token"] = codeboxAuthToken;

  try {
    const res = await axios.get(`${codeboxUrl}/languages/${languageId}`, {
      headers,
      timeout: 5000,
      validateStatus: () => true,
    });
    return res.data;
  } catch (err) {
    return null;
  }
}

export default {
  SUPPORTED_LANGUAGES,
  executeCode,
  cancelSubmission,
  getLanguageDetails,
};


