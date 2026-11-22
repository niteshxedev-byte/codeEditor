import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentExecutor, createToolCallingAgent } from "@langchain/classic/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { SystemMessage } from "@langchain/core/messages";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Multi-provider LLM resolver (Groq, OpenRouter, Local Ollama)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Direct OpenRouter chat completion fetch helper.
 * Exactly implements standard OpenRouter REST completion call:
 * fetch('https://openrouter.ai/api/v1/chat/completions', { ... })
 */
export async function fetchOpenRouterCompletion({
  model = "openai/gpt-4o",
  messages = [{ role: "user", content: "What is the meaning of life?" }],
  apiKey = process.env.OPENROUTER_API_KEY,
  siteUrl = process.env.PUBLIC_URL || "https://codeeditor.niteshxe.dev",
  siteName = process.env.SITE_TITLE || "Personal Code Editor",
  max_tokens = 1500,
} = {}) {
  const key = apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not configured. Please add OPENROUTER_API_KEY to your .env file.");
  }

  const payload = {
    model,
    messages,
  };
  if (max_tokens) payload.max_tokens = max_tokens;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": siteUrl,
      "X-Title": siteName,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorBody}`);
  }

  return await response.json();
}

/**
 * Resolves the appropriate LangChain LLM instance based on model name and environment.
 * Supports:
 *  1. Groq (Fast inference, tool calling)
 *  2. OpenRouter (GPT-4o, free models)
 *  3. Local Ollama (Zero-latency offline coding)
 */
export function resolveLLM(modelName = "qwen/qwen3.8-27b") {
  const groqKey = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const publicUrl = process.env.PUBLIC_URL || "https://codeeditor.niteshxe.dev";
  const siteTitle = process.env.SITE_TITLE || "Personal Code Editor";
  const localUrl = (process.env.LOCAL_OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");

  let cleanModel = modelName;
  let forcedProvider = null;

  if (cleanModel.startsWith("groq:")) {
    forcedProvider = "groq";
    cleanModel = cleanModel.replace(/^groq:/, "");
  } else if (cleanModel.startsWith("openrouter:")) {
    forcedProvider = "openrouter";
    cleanModel = cleanModel.replace(/^openrouter:/, "");
  } else if (cleanModel.startsWith("local:") || cleanModel.startsWith("ollama:")) {
    forcedProvider = "ollama";
    cleanModel = cleanModel.replace(/^(local|ollama):/, "");
  }

  // 1. Explicit or heuristic OpenRouter
  const isOpenRouterModel =
    forcedProvider === "openrouter" ||
    (!forcedProvider &&
      (cleanModel.endsWith(":free") ||
        cleanModel.includes("gpt-4o") ||
        cleanModel.startsWith("liquid/") ||
        cleanModel.startsWith("nvidia/") ||
        cleanModel.startsWith("inclusionai/") ||
        cleanModel.startsWith("baidu/")));

  if (isOpenRouterModel) {
    if (!openRouterKey) {
      throw new Error("OPENROUTER_API_KEY is not configured on this server. Please add OPENROUTER_API_KEY to .env to use OpenRouter models.");
    }
    return new ChatOpenAI({
      apiKey: openRouterKey,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": publicUrl,
          "X-Title": siteTitle,
        },
      },
      model: cleanModel,
      maxTokens: 2000,
      temperature: 0.1,
      maxRetries: 1,
    });
  }

  // 2. Explicit or heuristic Groq
  const isGroqModel =
    forcedProvider === "groq" ||
    (!forcedProvider &&
      (cleanModel.startsWith("qwen/") ||
        cleanModel.startsWith("openai/gpt-oss") ||
        cleanModel.startsWith("llama-") ||
        cleanModel.startsWith("mixtral-") ||
        cleanModel.startsWith("gemma-")));

  if (isGroqModel && groqKey) {
    return new ChatOpenAI({
      apiKey: groqKey,
      configuration: {
        baseURL: "https://api.groq.com/openai/v1",
      },
      model: cleanModel,
      temperature: 0.1,
      maxRetries: 1,
    });
  }

  // 3. Fallback to Groq if key is present
  if (groqKey) {
    const groqFallbackModel =
      cleanModel === "llama3.2:1b" || cleanModel === "gemma4:31b" || cleanModel === "gpt-oss:20b"
        ? "qwen/qwen3.8-27b"
        : cleanModel;
    return new ChatOpenAI({
      apiKey: groqKey,
      configuration: {
        baseURL: "https://api.groq.com/openai/v1",
      },
      model: groqFallbackModel,
      temperature: 0.1,
      maxRetries: 1,
    });
  }

  // 4. Fallback to OpenRouter if key is present
  if (openRouterKey) {
    const orFallbackModel =
      cleanModel === "llama3.2:1b" || cleanModel === "gemma4:31b"
        ? "liquid/lfm-3-1.7b:free"
        : cleanModel;
    return new ChatOpenAI({
      apiKey: openRouterKey,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": publicUrl,
          "X-Title": siteTitle,
        },
      },
      model: orFallbackModel,
      temperature: 0.1,
      maxRetries: 1,
    });
  }

  // 5. Fallback to Local Ollama
  return new ChatOllama({
    model: cleanModel,
    baseUrl: localUrl,
    temperature: 0.1,
    maxRetries: 1,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Model discovery
// Fetches available models from Groq, OpenRouter, and local Ollama.
// ─────────────────────────────────────────────────────────────────────────────

let cachedModels = null;
let lastModelFetch = 0;

export async function getAvailableModels() {
  const now = Date.now();
  if (cachedModels && now - lastModelFetch < 300000) {
    // Cache for 5 minutes
    return cachedModels;
  }

  const seen = new Set();
  const models = [];
  const localUrl = (process.env.LOCAL_OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");

  // 1. Groq models
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${groqKey}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        const groqList = data.data || [];
        const preferred = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"];
        preferred.forEach((id) => {
          if (groqList.some((m) => m.id === id) && !seen.has(id)) {
            seen.add(id);
            models.push({ id, name: `${id} (Groq - Fast)`, source: "groq" });
          }
        });
        groqList.slice(0, 8).forEach((m) => {
          if (!seen.has(m.id) && m.active !== false) {
            seen.add(m.id);
            models.push({ id: m.id, name: `${m.id} (Groq)`, source: "groq" });
          }
        });
      }
    } catch (_) {
      const defaultGroq = [
        { id: "qwen/qwen3.8-27b", name: "qwen/qwen3.8-27b (Groq - Fast)", source: "groq" },
        { id: "openai/gpt-oss-120b", name: "openai/gpt-oss-120b (Groq)", source: "groq" },
        { id: "openai/gpt-oss-20b", name: "openai/gpt-oss-20b (Groq)", source: "groq" },
      ];
      defaultGroq.forEach((m) => {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          models.push(m);
        }
      });
    }
  }

  // 2. OpenRouter models
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    if (!seen.has("openai/gpt-4o")) {
      seen.add("openai/gpt-4o");
      models.push({ id: "openai/gpt-4o", name: "openai/gpt-4o (OpenRouter)", source: "openrouter" });
    }

    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "HTTP-Referer": process.env.PUBLIC_URL || "https://codeeditor.niteshxe.dev",
          "X-Title": process.env.SITE_TITLE || "Personal Code Editor",
        },
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data = await res.json();
        const freeModels = (data.data || []).filter((m) => m.id && m.id.endsWith(":free"));
        freeModels.slice(0, 8).forEach((m) => {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            models.push({ id: m.id, name: `${m.name || m.id} (OpenRouter - Free)`, source: "openrouter" });
          }
        });
      }
    } catch (_) {
      const defaultOr = [
        { id: "liquid/lfm-3-1.7b:free", name: "LiquidAI: LFM3-1.7B (OpenRouter - Free)", source: "openrouter" },
        { id: "nvidia/nemotron-3.5-super-vl:free", name: "NVIDIA: Nemotron 3.5 Super (OpenRouter - Free)", source: "openrouter" },
      ];
      defaultOr.forEach((m) => {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          models.push(m);
        }
      });
    }
  }

  // 3. Local Ollama (if running)
  try {
    const res = await fetch(`${localUrl}/api/tags`, {
      signal: AbortSignal.timeout(1200),
    });
    if (res.ok) {
      const { models: localModels = [] } = await res.json();
      localModels.forEach((m) => {
        const id = m.name || m.model;
        if (id && !seen.has(id)) {
          seen.add(id);
          models.push({ id, name: `${id} (Local Ollama)`, source: "local" });
        }
      });
    }
  } catch (_) { }

  const result =
    models.length > 0
      ? models
      : [
          { id: "qwen/qwen3.8-27b", name: "qwen/qwen3.8-27b (Groq - Fast)", source: "groq" },
          { id: "openai/gpt-oss-120b", name: "openai/gpt-oss-120b (Groq)", source: "groq" },
          { id: "openai/gpt-4o", name: "openai/gpt-4o (OpenRouter)", source: "openrouter" },
          { id: "liquid/lfm-3-1.7b:free", name: "LiquidAI: LFM3-1.7B (OpenRouter - Free)", source: "openrouter" },
          { id: "nvidia/nemotron-3.5-super-vl:free", name: "NVIDIA: Nemotron 3.5 Super (OpenRouter - Free)", source: "openrouter" },
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

export async function runTeacherAgent({
  prompt,
  modelName = "qwen/qwen3.8-27b",
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
  } catch (e) { }

  // Build extra context (AGENTS.md memory + other skill files)
  let extraContext = "";
  try {
    const memFile = "./AGENTS.md";
    const fullPath = path.resolve(memFile);
    if (fs.existsSync(fullPath)) {
      extraContext += `\n\n--- MEMORY: ${memFile} ---\n${fs.readFileSync(fullPath, "utf8")}\n`;
    }
  } catch (e) { }

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
  } catch (e) { }

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

  const llm = resolveLLM(modelName);

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
        } catch (_) { }

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
        } catch (_) { }

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
          monospace: ["JetBrains Mono", "Fira Code", "Source Code Pro", "Space Mono", "IBM Plex Mono"],
          serif: ["Playfair Display", "Lora", "Merriweather", "EB Garamond", "Libre Baskerville"],
          sans: ["Inter", "Space Grotesk", "DM Sans", "Outfit", "Plus Jakarta Sans"],
          display: ["Syne", "Unbounded", "Bebas Neue", "Righteous", "Orbitron"],
          handwriting: ["Caveat", "Dancing Script", "Pacifico", "Kalam", "Gloria Hallelujah"],
          gaming: ["Orbitron", "Exo 2", "Rajdhani", "Audiowide", "Press Start 2P"],
          luxury: ["Cormorant Garamond", "Bodoni Moda", "Marcellus", "Cinzel", "Italiana"],
          tech: ["Space Grotesk", "IBM Plex Sans", "Roboto Mono", "Share Tech Mono", "Oxanium"],
          editorial: ["DM Serif Display", "Fraunces", "Vollkorn", "Spectral", "Crimson Pro"],
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
    const result = await agentExecutor.invoke(
      { input: prompt },
      { callbacks, signal: AbortSignal.timeout(35000) }
    );
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
  resolveLLM,
  fetchOpenRouterCompletion,
};
