import { Router } from "express";
import { executeCode, SUPPORTED_LANGUAGES } from "../../Config/codeExecution.config.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { randomBytes } from "crypto";
import Project from "../../Models/userModels/projectsModel.js/projectModel.js";
import Pdf from "../../Models/userModels/pdfModels.js";
import { runTeacherAgent, getAvailableModels } from "../../Services/langchainAgent.service.js";
import { requireApiAuth as authenticate, requireAuth } from "../../Middlewares/auth.middleware.js";


const router = Router();

// Multer storage for projects (zip/json) and pdfs
const ALLOWED_PROJECT_EXTS = new Set([".zip", ".json", ".txt", ".tar"]);
const ALLOWED_PDF_EXTS = new Set([".pdf"]);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let dest = "src/public/uploads/";
    if (file.fieldname === "projectFile") {
      dest += "projects/";
    } else if (file.fieldname === "pdfFile") {
      dest += "pdfs/";
    }
    // Ensure dir exists
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
    // Sanitize extension to strictly allowed characters
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});


const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit to prevent DoS
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "projectFile") {
      if (ALLOWED_PROJECT_EXTS.has(ext)) return cb(null, true);
      return cb(new Error("Invalid project file type. Only .zip, .json, and .txt allowed."));
    }
    if (file.fieldname === "pdfFile") {
      if (ALLOWED_PDF_EXTS.has(ext)) return cb(null, true);
      return cb(new Error("Invalid file type. Only .pdf files allowed."));
    }
    return cb(new Error("Unexpected upload field"));
  }
});

// Render Editor Page (Protected - requires valid JWT or redirects to /login)
router.get("/editor", requireAuth, async (req, res) => {
  const aiModels = await getAvailableModels();
  res.render("editor/editor", {
    languages: SUPPORTED_LANGUAGES,
    aiModels,
    user: req.user,
  });
});

// Get Available AI Models from local & cloud
router.get("/api/models", async (req, res) => {
  const models = await getAvailableModels();
  res.json({ models });
});

// Run Code Endpoint
router.post("/runCode", async (req, res) => {
  try {
    const { code, language_id, stdin } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Source code is required" });
    }

    const executionResult = await executeCode({
      code,
      language_id,
      stdin,
    });

    return res.json(executionResult);
  } catch (error) {
    console.error("Route error in /runCode:", error.message);
    return res.status(500).json({
      stdout: "",
      stderr: `Server Error: ${error.message}`,
      compile_output: "",
      time: 0,
      memory: 0,
      status: "Error",
    });
  }
});

// Save Project Endpoint
router.post("/save-project", authenticate, upload.single("projectFile"), async (req, res) => {
  try {
    const { projectName, projectDescription, projectProgrammingLanguage } = req.body;
    
    if (!projectName || !req.file) {
      return res.status(400).json({ error: "Project name and file are required" });
    }

    const projectUrl = "/uploads/projects/" + req.file.filename;

    const project = new Project({
      userId: req.user.userId,
      projectName,
      projectUrl,
      projectDescription: projectDescription || "Saved Workspace",
      projectProgrammingLanguage: projectProgrammingLanguage || "Various",
    });

    await project.save();
    return res.json({ success: true, project });
  } catch (error) {
    console.error("Save project error:", error);
    return res.status(500).json({ error: "Failed to save project" });
  }
});

// Save PDF Endpoint
router.post("/save-pdf", authenticate, upload.single("pdfFile"), async (req, res) => {
  try {
    const { pdfName } = req.body;
    
    if (!pdfName || !req.file) {
      return res.status(400).json({ error: "PDF name and file are required" });
    }

    const pdfUrl = "/uploads/pdfs/" + req.file.filename;

    const pdf = new Pdf({
      userId: req.user.userId,
      pdfName,
      pdfUrl,
    });

    await pdf.save();
    return res.json({ success: true, pdf });
  } catch (error) {
    console.error("Save PDF error:", error);
    return res.status(500).json({ error: "Failed to save PDF" });
  }
});

// Simple Teacher Agent Endpoint
router.post("/ask-ai", async (req, res) => {
  try {
    const { prompt, model, fileSystem, activeFileId, code, language } = req.body;
    if (!prompt) {
      return res.status(400).json({ response: "Prompt is required." });
    }

    const result = await runTeacherAgent({
      prompt,
      modelName: model || "llama3.2:1b",
      fileSystem: Array.isArray(fileSystem) ? fileSystem : [],
      activeFileId,
      activeCode: code || "",
      language: language || "JavaScript"
    });

    return res.json({
      response: result.response,
      actions: result.actions || [],
      model: result.model
    });
  } catch (error) {
    console.error("Error in /ask-ai route:", error.message);
    return res.status(500).json({
      response: `Teacher Agent Error: ${error.message}`,
      actions: []
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HTML Preview — render user HTML in a new browser tab
// POST /preview  → stores HTML+CSS+JS in a short-lived in-memory map, returns { id }
// GET  /preview/:id → serves the stored snippet as text/html (10-min TTL)
// No file I/O, no eval, no shell — purely in-memory passthrough.
// ─────────────────────────────────────────────────────────────────────────────

// Map<id, { html: string, expiresAt: number }>
const previewStore = new Map();

const PREVIEW_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024; // 2 MB hard cap

// Periodically sweep expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of previewStore) {
    if (entry.expiresAt < now) previewStore.delete(id);
  }
}, 5 * 60 * 1000);

// Store a preview snippet — returns an opaque 32-hex-char id
router.post("/preview", requireAuth, (req, res) => {
  const { html = "", css = "", js = "" } = req.body || {};

  if (typeof html !== "string" || typeof css !== "string" || typeof js !== "string") {
    return res.status(400).json({ error: "html, css, and js must be strings." });
  }

  // Compose a full document so the preview is self-contained
  const document = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <style>${css}</style>
</head>
<body>
${html}
<script>
(function() {
${js}
})();
<\/script>
</body>
</html>`;

  const byteLen = Buffer.byteLength(document, "utf8");
  if (byteLen > PREVIEW_MAX_BYTES) {
    return res.status(413).json({ error: "Preview content exceeds 2 MB limit." });
  }

  const id = randomBytes(16).toString("hex"); // 32-char hex — unguessable
  previewStore.set(id, { html: document, expiresAt: Date.now() + PREVIEW_TTL_MS });

  return res.json({ id });
});

// Serve the stored preview as raw HTML
router.get("/preview/:id", requireAuth, (req, res) => {
  const { id } = req.params;

  // Strict id validation: exactly 32 lowercase hex chars
  if (!/^[0-9a-f]{32}$/.test(id)) {
    return res.status(400).send("Invalid preview ID.");
  }

  const entry = previewStore.get(id);
  if (!entry || entry.expiresAt < Date.now()) {
    previewStore.delete(id);
    return res.status(404).send(`
      <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Preview expired</title></head>
      <body style="font-family:sans-serif;padding:2rem;color:#555">
        <h2>Preview expired or not found</h2>
        <p>Previews are stored for 10 minutes. Go back to the editor and click <strong>Preview</strong> again.</p>
      </body></html>
    `);
  }

  res
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("X-Content-Type-Options", "nosniff")
    .setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http:;")
    .setHeader("X-Frame-Options", "DENY")
    .send(entry.html);
});

export default router;

