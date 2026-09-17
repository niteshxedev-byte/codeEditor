import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Ollama endpoint resolver
// Picks local (11434) if reachable, otherwise falls back to Ollama Cloud.
// ─────────────────────────────────────────────────────────────────────────────

async function resolveOllamaEndpoint(modelName) {
  const cloudUrl = (process.env.OLLAMA_URL || "https://ollama.com").replace(/\/$/, "");
  const cloudKey = process.env.OLLAMA_API_KEY || "";
  const localUrl = (process.env.LOCAL_OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");

  try {
    const check = await fetch(`${localUrl}/api/tags`, {
      signal: AbortSignal.timeout(1200),
    });
    if (check.ok) {
      const data = await check.json();
      const localModels = data.models || [];
      const hasModelLocally = !modelName || localModels.some(m => m.name === modelName || m.model === modelName);
      if (hasModelLocally) {
        return { baseUrl: localUrl, headers: { "Content-Type": "application/json" } };
      }
    }
  } catch (_) {}

  return {
    baseUrl: cloudUrl,
    headers: {
      "Content-Type": "application/json",
      ...(cloudKey ? { Authorization: `Bearer ${cloudKey}` } : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Model discovery
// Fetches available models from local and cloud Ollama.
// ─────────────────────────────────────────────────────────────────────────────

let cachedModels = null;
let lastModelFetch = 0;

export async function getAvailableModels() {
  const now = Date.now();
  if (cachedModels && (now - lastModelFetch < 300000)) { // Cache for 5 minutes
    return cachedModels;
  }

  const seen = new Set();
  const models = [];
  const localUrl = (process.env.LOCAL_OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");

  // Local Ollama
  try {
    const res = await fetch(`${localUrl}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const { models: localModels = [] } = await res.json();
      localModels.forEach((m) => {
        const id = m.name || m.model;
        if (id && !seen.has(id)) {
          seen.add(id);
          models.push({ id, name: `${id} (Local)`, source: "local" });
        }
      });
    }
  } catch (_) {}

  // Cloud Ollama
  const cloudUrl = (process.env.OLLAMA_URL || "https://ollama.com").replace(/\/$/, "");
  const cloudKey = process.env.OLLAMA_API_KEY;
  try {
    const res = await fetch(`${cloudUrl}/api/tags`, {
      headers: cloudKey ? { Authorization: `Bearer ${cloudKey}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const { models: cloudModels = [] } = await res.json();
      cloudModels.forEach((m) => {
        const id = m.name || m.model;
        if (id && !seen.has(id)) {
          seen.add(id);
          models.push({ id, name: `${id} (Cloud)`, source: "cloud" });
        }
      });
    }
  } catch (_) {}

  const result = models.length > 0
    ? models
    : [
        { id: "llama3.2:1b", name: "llama3.2:1b (Local)", source: "local" },
        { id: "qwen3.5:0.8b", name: "qwen3.5:0.8b (Local)", source: "local" },
        { id: "gemma4:31b", name: "gemma4:31b (Cloud - Free)", source: "cloud" },
        { id: "gpt-oss:20b", name: "gpt-oss:20b (Cloud - Free)", source: "cloud" },
      ];
      
  cachedModels = result;
  lastModelFetch = Date.now();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Built-in workspace tools
// These mirror the Python `deepagents` tool pattern:
//   { name, description, parameters: JSONSchema, execute(args) }
// The agent can call any of these during its reasoning loop.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All tools the Teacher Agent can invoke.
 * Each tool has:
 *   - name         : snake_case identifier sent to Ollama
 *   - description  : what the tool does (shown to the model)
 *   - parameters   : JSON Schema object describing the input
 *   - execute(args): async function that performs the action server-side
 */
import { ChatOllama } from "@langchain/ollama";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentExecutor, createToolCallingAgent } from "@langchain/classic/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { SystemMessage } from "@langchain/core/messages";

export async function runTeacherAgent({
  prompt,
  modelName = "llama3.2:1b",
  fileSystem = [],
  activeFileId = null,
  activeCode = "",
  language = "JavaScript",
  emitter = {}
}) {
  const activeFile = fileSystem.find((f) => f.id === activeFileId && f.type === "file");
  const isHtmlTask = /html|css|web|page|site|ui|frontend|design|layout|gsap|porsche|landing|portfolio|bootstrap|tailwind/i.test(prompt)
    || (activeFile && /\.(html|htm|css)$/i.test(activeFile.name));

  const effectiveLanguage = isHtmlTask ? "HTML/JavaScript" : language;
  const isCpp = !isHtmlTask && /c\+\+|cpp/i.test(language);
  const isPy = !isHtmlTask && /python/i.test(language);
  const langTag = isHtmlTask ? "html" : (isCpp ? "cpp" : isPy ? "python" : "javascript");

  const defaultExt = isHtmlTask ? ".html" : (isCpp ? ".cpp" : isPy ? ".py" : ".js");
  const defaultBase = isHtmlTask ? "index" : (isCpp ? "main" : isPy ? "main" : "index");

  const activeFileName = activeFile
    ? activeFile.name
    : (isHtmlTask ? "index.html" : (isCpp ? "main.cpp" : isPy ? "main.py" : "main.js"));

  // ── Load Frontend design skill (mandatory for HTML) ─────────────────────
  let frontendSkill = "";
  const frontendSkillPath = path.resolve("./skills/Frountend.md");
  try {
    if (fs.existsSync(frontendSkillPath)) {
      frontendSkill = fs.readFileSync(frontendSkillPath, "utf8");
    }
  } catch (e) {}

  // Build extra context (AGENTS.md memory + other skill files)
  let extraContext = "";
  try {
    const memFile = "./AGENTS.md";
    const fullPath = path.resolve(memFile);
    if (fs.existsSync(fullPath)) {
      extraContext += `\n\n--- MEMORY: ${memFile} ---\n${fs.readFileSync(fullPath, "utf8")}\n`;
    }
  } catch (e) {}

  try {
    const skillDir = path.resolve("./skills/");
    if (fs.existsSync(skillDir) && fs.statSync(skillDir).isDirectory()) {
      for (const file of fs.readdirSync(skillDir)) {
        // Skip Frountend.md — already loaded above
        if (file === "Frountend.md") continue;
        if (file.endsWith(".md") || file.endsWith(".txt")) {
          extraContext += `\n\n--- SKILL: ${file} ---\n${fs.readFileSync(path.join(skillDir, file), "utf8")}\n`;
        }
      }
    }
  } catch (e) {}

  // Tailored guidelines for web design requests
  const htmlDesignGuidelines = isHtmlTask ? `
FRONTEND & WEB CODING RULES:
- When asked to build an HTML page (like index.html with GSAP, fonts, etc.):
  You MUST call the create_file tool with filename: "index.html" and the COMPLETE working code.
- Do NOT output partial snippets solely in chat text. Provide the complete runnable file via create_file.
- Do NOT create unnecessary folders (never create stl_containers or lesson_examples for web tasks). Write directly to root.
- Ready-to-use CDN links (embed directly):
  • GSAP: <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  • ScrollTrigger: <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
  • Remix Icons: <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/remixicon@4.5.0/fonts/remixicon.css">
- Design principles: High-contrast, sleek palette tailored to the subject (e.g. for Porsche: obsidian #08080a, racing red #e10600 or guards red, silver metallic #d1d5db). Smooth scroll animations.
` : "";

  const systemPromptStr = `You are an expert programming teacher and developer specializing in ${effectiveLanguage}.
Tools available: create_file, create_folder, write_code, explain_concept, web_search, search_fonts.

CRITICAL INSTRUCTIONS:
- Whenever asked to write, create, or update code, you MUST call create_file or write_code with the full working code. Do NOT output raw code snippets solely in chat text.
- web_search / search_fonts: call at most ONCE if really needed, then immediately call create_file or write_code.
- Keep file structure simple: write to the root workspace unless the student explicitly asks for a folder.
${htmlDesignGuidelines}
Current file: "${activeFileName}" | Language: ${effectiveLanguage}
\`\`\`${langTag}
${activeCode || "// (empty buffer)"}
\`\`\`${extraContext}`;

  const { baseUrl, headers } = await resolveOllamaEndpoint(modelName);
  
  const llm = new ChatOllama({
    model: modelName,
    baseUrl: baseUrl,
    headers: headers,
    temperature: 0.1,
  });

  const actions = []; // Collect actions for frontend

  // ── SSRF-safe private-range blocklist ────────────────────────────────────
  function isBlockedUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      const h = u.hostname.toLowerCase();
      if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
      if (/^169\.254\./.test(h)) return true; // link-local
      if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
      return false;
    } catch {
      return true;
    }
  }

  const tools = [
    // ── Workspace tools ──────────────────────────────────────────────────
    new DynamicStructuredTool({
      name: "create_file",
      description: "Creates a new file in the workspace with the given content.",
      schema: z.object({
        filename: z.string().describe("Name of the file"),
        content: z.string().describe("Full content of the file"),
        folderName: z.string().optional().describe("Optional folder to create it in")
      }),
      func: async ({ filename, content, folderName }) => {
        actions.push({ type: "create_file", name: filename, content, folderName });
        return `File ${filename} created successfully.`;
      }
    }),
    new DynamicStructuredTool({
      name: "create_folder",
      description: "Creates a new folder in the workspace.",
      schema: z.object({
        folderName: z.string().describe("Name of the folder"),
        parentFolderName: z.string().optional().describe("Optional parent folder")
      }),
      func: async ({ folderName, parentFolderName }) => {
        actions.push({ type: "create_folder", name: folderName, parentFolder: parentFolderName });
        return `Folder ${folderName} created successfully.`;
      }
    }),
    new DynamicStructuredTool({
      name: "write_code",
      description: "Replaces the entire content of an existing file in the workspace.",
      schema: z.object({
        filename: z.string().describe("Name of the file to overwrite"),
        content: z.string().describe("New full content of the file")
      }),
      func: async ({ filename, content }) => {
        actions.push({ type: "write_code", name: filename, content });
        return `Code written to ${filename} successfully.`;
      }
    }),
    new DynamicStructuredTool({
      name: "explain_concept",
      description: "Explains a programming concept without making file changes. Use for theory questions.",
      schema: z.object({
        concept: z.string().describe("The programming concept to explain"),
        language: z.string().describe("The programming language context")
      }),
      func: async ({ concept }) => {
        return `Explanation for ${concept} — respond directly in your message.`;
      }
    }),

    // ── Web search — DDG Instant Answer API (JSON, ~200ms, no parsing) ───────
    new DynamicStructuredTool({
      name: "web_search",
      description: `Search the web for information: image CDN URLs, CSS libraries, icons, design references, documentation, tech facts.
Returns a summary and related links instantly.
Use ONCE before creating an HTML file to gather subject matter facts or resource URLs.`,
      schema: z.object({
        query: z.string().describe("Search query, e.g. 'Porsche 911 history specs' or 'Picsum free image CDN URLs'")
      }),
      func: async ({ query }) => {
        const q = String(query).slice(0, 200).trim();
        if (!q) return "Empty query.";

        // ── Strategy 1: DuckDuckGo Instant Answer API (JSON, no HTML) ──────
        try {
          const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`;
          const res = await fetch(ddgUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; TeacherAgent/1.0)" },
            signal: AbortSignal.timeout(3000)
          });
          if (res.ok) {
            const data = await res.json();
            const parts = [];

            if (data.Abstract) {
              parts.push(`**Summary (${data.AbstractSource}):** ${data.Abstract}\nURL: ${data.AbstractURL}`);
            }
            if (data.Answer) {
              parts.push(`**Answer:** ${data.Answer}`);
            }

            const related = (data.RelatedTopics || [])
              .filter(t => t.Text && t.FirstURL)
              .slice(0, 4)
              .map((t, i) => `${i + 1}. ${t.Text.slice(0, 120)}\n   URL: ${t.FirstURL}`);
            if (related.length) parts.push(`**Related:**\n${related.join("\n")}`);

            if (parts.length > 0) {
              return `Search results for "${q}":\n\n${parts.join("\n\n")}`;
            }
          }
        } catch (_) {}

        // ── Strategy 2: Wikipedia REST summary (fast JSON, no parsing) ──────
        try {
          const term = encodeURIComponent(q.split(" ").slice(0, 3).join("_"));
          const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${term}`;
          const res = await fetch(wikiUrl, {
            headers: { "User-Agent": "TeacherAgent/1.0 (educational-code-editor)" },
            signal: AbortSignal.timeout(3000)
          });
          if (res.ok) {
            const data = await res.json();
            if (data.extract) {
              return `**Wikipedia — ${data.title}:**\n${data.extract.slice(0, 600)}\nURL: ${data.content_urls?.desktop?.page || "https://en.wikipedia.org"}`;
            }
          }
        } catch (_) {}

        return `No results found for "${q}". Use known CDN links directly (e.g. picsum.photos, cdnjs.cloudflare.com).`;
      }
    }),

    // ── Font search — fully offline, instant, zero network ───────────────────
    new DynamicStructuredTool({
      name: "search_fonts",
      description: `Get Google Fonts CDN links by category (monospace, serif, sans, display, handwriting, gaming, luxury, tech).
Returns ready-to-paste <link> tags and CSS font-family values. Instant — no network call.`,
      schema: z.object({
        query: z.string().describe("Font style category: 'monospace', 'serif', 'sans', 'display', 'handwriting', 'gaming', 'luxury', 'tech', or a specific font name like 'Inter'")
      }),
      func: async ({ query }) => {
        const q = String(query).slice(0, 100).toLowerCase().trim();

        // Offline curated font catalogue — no network needed
        const catalogue = {
          monospace:   ["JetBrains Mono", "Fira Code", "Source Code Pro", "Space Mono", "IBM Plex Mono"],
          serif:       ["Playfair Display", "Lora", "Merriweather", "EB Garamond", "Libre Baskerville"],
          sans:        ["Inter", "Space Grotesk", "DM Sans", "Outfit", "Plus Jakarta Sans"],
          display:     ["Syne", "Unbounded", "Bebas Neue", "Righteous", "Orbitron"],
          handwriting: ["Caveat", "Dancing Script", "Pacifico", "Kalam", "Gloria Hallelujah"],
          gaming:      ["Orbitron", "Exo 2", "Rajdhani", "Audiowide", "Press Start 2P"],
          luxury:      ["Cormorant Garamond", "Bodoni Moda", "Marcellus", "Cinzel", "Italiana"],
          tech:        ["Space Grotesk", "IBM Plex Sans", "Roboto Mono", "Share Tech Mono", "Oxanium"],
          editorial:   ["DM Serif Display", "Fraunces", "Vollkorn", "Spectral", "Crimson Pro"],
        };

        // Find best matching category
        let match = [];
        for (const [cat, fonts] of Object.entries(catalogue)) {
          if (q.includes(cat) || cat.includes(q)) { match = fonts; break; }
        }

        // Direct font name match
        if (match.length === 0) {
          const allFonts = Object.values(catalogue).flat();
          const direct = allFonts.filter(f => f.toLowerCase().includes(q));
          if (direct.length) match = direct;
        }

        // Default to sans if nothing matched
        if (match.length === 0) match = catalogue.sans;

        const lines = match.slice(0, 6).map(name => {
          const encoded = name.replace(/ /g, "+");
          const link = `https://fonts.googleapis.com/css2?family=${encoded}:wght@300;400;500;600;700&display=swap`;
          return `• **${name}**\n  <link href="${link}" rel="stylesheet">\n  font-family: '${name}', sans-serif;`;
        });

        return `Google Fonts — ${q}:\n\n${lines.join("\n\n")}\n\nPaste the <link> into <head>. Use the font-family in CSS.`;
      }
    }),
  ];


  const promptTemplate = ChatPromptTemplate.fromMessages([
    new SystemMessage(systemPromptStr),
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);


  const agent = createToolCallingAgent({
    llm,
    tools,
    prompt: promptTemplate,
  });

  const agentExecutor = new AgentExecutor({
    agent,
    tools,
    maxIterations: 6,
    handleParsingErrors: true,
  });

  // Streaming Callbacks
  const callbacks = [{
    handleLLMNewToken(token) {
      if (emitter.onAnalysisChunk && token) {
        emitter.onAnalysisChunk(token);
      }
    },
    handleAgentAction(action) {
      if (emitter.onToolCall) {
        emitter.onToolCall({
          name: action.tool,
          input: typeof action.toolInput === "string" ? action.toolInput : JSON.stringify(action.toolInput),
        });
      }
    }
  }];

  try {
    const result = await agentExecutor.invoke({ input: prompt }, { callbacks });
    let fallbackActions = actions;
    if (actions.length === 0 && result.output) {
      fallbackActions = extractCodeBlocksAndActions(result.output, effectiveLanguage, activeFileName, prompt);
    }
    return { response: result.output, actions: fallbackActions, model: modelName };
  } catch (err) {
    console.warn("[Teacher Agent] Offline or error:", err.message);

    // Fallbacks
    if (isCpp && /\bstl\b/i.test(prompt)) {
      const pack = getStlContainersMultiFilePack();
      return {
        response: pack.response + `\n\n> *(Offline mode: ${err.message})*`,
        actions: pack.actions,
        model: modelName,
      };
    }

    const fallbackCode = isHtmlTask
      ? `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>${prompt.replace(/"/g, "")}</title>\n</head>\n<body>\n  <h1>${prompt.replace(/"/g, "")}</h1>\n</body>\n</html>\n`
      : isCpp
      ? `// ${activeFileName}\n#include <iostream>\n\nint main() {\n    std::cout << "Lesson: ${prompt.replace(/"/g, "")}" << std::endl;\n    return 0;\n}\n`
      : isPy
      ? `# ${activeFileName}\nprint("Lesson: ${prompt.replace(/"/g, "")}")\n`
      : `// ${activeFileName}\nconsole.log("Lesson: ${prompt.replace(/"/g, "")}");\n`;

    return {
      response:
        `### 🎓 ${prompt} — ${effectiveLanguage}\n\n` +
        `Here is a starter template in your editor buffer.\n\n` +
        `> *(Offline mode: ${err.message})*`,
      actions: [{ type: "write_code", name: activeFileName, content: fallbackCode }],
      model: modelName,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Multi-code-block parser
// Extracts filenames + code blocks from a plain-text markdown reply
// (used as fallback when the model doesn't use tool calling).
// ─────────────────────────────────────────────────────────────────────────────

export function extractCodeBlocksAndActions(reply, language = "JavaScript", activeFileName = "main.js", prompt = "") {
  const isHtmlPrompt = /html|css|web|page|site|ui|frontend|design|layout|gsap|porsche|landing|index\.html/i.test(prompt);
  const isCpp = !isHtmlPrompt && /c\+\+|cpp/i.test(language);
  const isPy = !isHtmlPrompt && /python/i.test(language);
  const defaultExt = isHtmlPrompt ? ".html" : (isCpp ? ".cpp" : isPy ? ".py" : ".js");
  const defaultBase = isHtmlPrompt ? "index" : (isCpp ? "main" : isPy ? "main" : "index");
  const actions = [];

  // Check for explicit JSON action block
  const actionBlockMatch = reply.match(/```(?:json:actions|actions)\s*\n([\s\S]*?)```/i);
  if (actionBlockMatch) {
    try {
      const parsed = JSON.parse(actionBlockMatch[1]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed.forEach((act) => {
          if (act.type || act.action) {
            actions.push({
              type: act.type || act.action,
              name: act.name || act.filename,
              content: act.content || "",
              folderName: act.folderName || act.folder,
              parentFolder: act.parentFolder || "root",
            });
          }
        });
        if (actions.some((a) => a.type === "create_file" || a.type === "write_code")) {
          return actions;
        }
      }
    } catch (e) {
      console.warn("Failed to parse explicit actions block:", e.message);
    }
  }

  // Extract all code blocks using global regex
  const codeBlockRegex = /```([a-zA-Z0-9_+#.-]+)?(?::([^\s\n\r]+)|\s+filename=([^\s\n\r]+)|\s+([^\s\n\r]+))?\s*\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  while ((match = codeBlockRegex.exec(reply)) !== null) {
    const langTag = (match[1] || "").toLowerCase();
    if (langTag === "actions" || langTag === "json:actions") continue;
    const inlineName = match[2] || match[3] || (match[4]?.includes(".") ? match[4] : null);
    const content = match[5].trim();
    if (content.length > 10) {
      blocks.push({ langTag, inlineName, content, startIndex: match.index });
    }
  }

  if (blocks.length === 0) return actions;

  // Decide folder name ONLY if student explicitly asked for a folder, or explicitly for C++ STL
  let targetFolder = null;
  if (isCpp && /\bstl\b/i.test(prompt)) {
    targetFolder = "stl_containers";
  } else if (/\b(in\s+a?\s*folder|subfolder|directory)\b/i.test(prompt)) {
    targetFolder = "project_files";
  }
  // Web / HTML tasks ALWAYS go directly to the workspace root unless asked
  if (isHtmlPrompt) {
    targetFolder = null;
  }

  if (targetFolder) {
    actions.push({ type: "create_folder", name: targetFolder, parentFolder: "root" });
  }

  // If one of the blocks is a complete HTML document, prioritize it and discard tiny fragments
  const fullHtmlBlock = blocks.find(b => /<!DOCTYPE\s+html|<html[\s>]/i.test(b.content));
  let candidateBlocks = blocks;
  if (fullHtmlBlock && isHtmlPrompt) {
    // Keep the complete HTML page, and any distinct CSS or JS block (> 8 lines)
    candidateBlocks = blocks.filter(b => b === fullHtmlBlock || b.content.split("\n").length >= 8);
  }

  const seenNames = new Set();
  candidateBlocks.forEach((block, idx) => {
    let fileName = block.inlineName;

    // Detect actual extension from content or language tag
    let ext = defaultExt;
    if (block.langTag === "html" || /<!DOCTYPE|<html|<head|<body/i.test(block.content)) {
      ext = ".html";
    } else if (block.langTag === "css" || /@media|:root|\.[\w-]+\s*\{/i.test(block.content)) {
      ext = ".css";
    } else if (block.langTag === "js" || block.langTag === "javascript") {
      ext = ".js";
    } else if (block.langTag === "py" || block.langTag === "python") {
      ext = ".py";
    } else if (block.langTag === "cpp" || block.langTag === "c++") {
      ext = ".cpp";
    }

    if (!fileName) {
      const textBefore = reply.slice(Math.max(0, block.startIndex - 400), block.startIndex);
      const headerMatches = [...textBefore.matchAll(/(?:###|\*\*|File:?|program:?)\s*`?([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)`?/gi)];
      if (headerMatches.length > 0) fileName = headerMatches[headerMatches.length - 1][1];
    }

    if (!fileName) {
      const firstLine = block.content.split("\n")[0] || "";
      const cmatch = firstLine.match(/(?:\/\/|#|\/\*)\s*(?:File:\s*)?([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)/i);
      if (cmatch) fileName = cmatch[1];
    }

    if (!fileName) {
      if (ext === ".html") {
        fileName = "index.html";
      } else if (ext === ".css") {
        fileName = "style.css";
      } else if (ext === ".js") {
        fileName = candidateBlocks.length === 1 ? (activeFileName.endsWith(".js") ? activeFileName : "main.js") : `script${idx > 0 ? idx : ""}.js`;
      } else {
        fileName = candidateBlocks.length === 1
          ? activeFileName || `${defaultBase}${ext}`
          : `${defaultBase}${String(idx + 1).padStart(2, "0")}${ext}`;
      }
    }

    fileName = fileName.replace(/[`'"]/g, "").trim();
    if (!fileName.includes(".")) fileName += ext;

    // Deduplicate
    let uniqueName = fileName;
    let dupN = 1;
    while (seenNames.has(uniqueName)) {
      const parts = fileName.split(".");
      const fExt = parts.pop();
      uniqueName = `${parts.join(".")}_${dupN++}.${fExt}`;
    }
    seenNames.add(uniqueName);

    actions.push(
      targetFolder
        ? { type: "create_file", name: uniqueName, content: block.content, folderName: targetFolder }
        : { type: "create_file", name: uniqueName, content: block.content }
    );
  });

  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Built-in STL fallback pack (C++ programs)
// Returned when the user asks for C++ containers but Ollama is offline.
// ─────────────────────────────────────────────────────────────────────────────

function getStlContainersMultiFilePack() {
  const folder = "stl_containers";

  const sampleFiles = [
    { name: "main01_vector.cpp", content: "#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> v = {1, 2, 3};\n    v.push_back(4);\n    for(int x : v) std::cout << x << ' ';\n    return 0;\n}\n" },
    { name: "main02_array.cpp", content: "#include <iostream>\n#include <array>\n\nint main() {\n    std::array<int, 4> a = {10, 20, 30, 40};\n    for(int x : a) std::cout << x << ' ';\n    return 0;\n}\n" },
  ];

  const actions = [{ type: "create_folder", name: folder, parentFolder: "root" }];
  sampleFiles.forEach((f) => actions.push({ type: "create_file", name: f.name, content: f.content, folderName: folder }));

  const response = `### 🎓 C++ STL Containers — Sample Programs Created\n\nCreated starter files in the \`${folder}\` folder.`;
  return { actions, response };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────


export default {
  getAvailableModels,
  extractCodeBlocksAndActions,
  runTeacherAgent,
};
