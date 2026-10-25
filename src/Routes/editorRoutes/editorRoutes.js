import { Router } from "express";
import mongoose from "mongoose";
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
import {
  getUserStorageDir,
  resolveUserStoragePath,
  safeDeleteUserStorage,
  safeDeleteUpload,
} from "../../Utils/fileHelper.js";


const router = Router();

// Multer storage for projects (zip/json) and pdfs with strict per-user and per-asset isolation
const ALLOWED_PROJECT_EXTS = new Set([".zip", ".json", ".txt", ".tar"]);
const ALLOWED_PDF_EXTS = new Set([".pdf"]);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userId = req.user?.userId;
    if (!userId) {
      return cb(new Error("Authentication required for upload storage"));
    }
    const type = file.fieldname === "projectFile" ? "code" : "files";
    try {
      const dest = getUserStorageDir(userId, type);
      cb(null, dest);
    } catch (err) {
      cb(err);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
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

const handleUploadSingle = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    next();
  });
};

// Render Editor Page (Protected - strictly verifies workspace ownership if projectId provided)
router.get("/editor", requireAuth, async (req, res) => {
  const { projectId } = req.query;
  if (projectId) {
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.redirect("/DashboardCodeEditor?error=invalid_project");
    }
    const project = await Project.findOne({ _id: projectId, userId: req.user.userId });
    if (!project) {
      return res.redirect("/DashboardCodeEditor?error=unauthorized_workspace");
    }
  }
  const aiModels = await getAvailableModels();
  res.render("editor/editor", {
    languages: SUPPORTED_LANGUAGES,
    aiModels,
    user: req.user,
  });
});

// Secure Workspace Archive Download (Owner Only)
router.get("/api/projects/:id/archive", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const project = await Project.findOne({ _id: id, userId: req.user.userId });
    if (!project) {
      const exists = await Project.findById(id);
      if (exists) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to access this workspace." });
      }
      return res.status(404).json({ error: "Workspace not found" });
    }

    const filePath = resolveUserStoragePath(req.user.userId, "code", project.storagePath || project.projectUrl);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Workspace archive file not found on disk" });
    }

    const safeFilename = (project.projectName || "workspace").replace(/[^a-zA-Z0-9_-]/g, "_") + ".zip";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
    res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
    return res.sendFile(filePath);
  } catch (err) {
    console.error("Error serving workspace archive:", err);
    return res.status(500).json({ error: "Failed to download workspace archive" });
  }
});

// Secure PDF Document Download / Inline View (Owner Only)
router.get("/api/pdfs/:id/file", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid document ID" });
    }

    const pdf = await Pdf.findOne({ _id: id, userId: req.user.userId });
    if (!pdf) {
      const exists = await Pdf.findById(id);
      if (exists) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to access this document." });
      }
      return res.status(404).json({ error: "Document not found" });
    }

    const filePath = resolveUserStoragePath(req.user.userId, "files", pdf.storagePath || pdf.pdfUrl);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: "PDF document file not found on disk" });
    }

    const safeFilename = (pdf.pdfName || "document").replace(/[^a-zA-Z0-9_-]/g, "_") + ".pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeFilename}"`);
    res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
    return res.sendFile(filePath);
  } catch (err) {
    console.error("Error serving PDF document:", err);
    return res.status(500).json({ error: "Failed to retrieve PDF document" });
  }
});

// Get Available AI Models from local & cloud
router.get("/api/models", authenticate, async (req, res) => {
  const models = await getAvailableModels();
  res.json({ models });
});

// Run Code Endpoint
router.post("/runCode", authenticate, async (req, res) => {
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

// Save Project Endpoint (Create new or Update existing workspace in isolated user storage)
router.post("/save-project", authenticate, handleUploadSingle("projectFile"), async (req, res) => {
  try {
    const { projectId, projectName, projectDescription, projectProgrammingLanguage } = req.body;

    if (!projectName || !req.file) {
      return res.status(400).json({ error: "Project name and file are required" });
    }

    let project = null;
    if (projectId && typeof projectId === "string" && projectId.trim() && projectId !== "null" && projectId !== "undefined" && mongoose.Types.ObjectId.isValid(projectId.trim())) {
      project = await Project.findOne({ _id: projectId.trim(), userId: req.user.userId });
    }

    if (project) {
      // Clean up previous archive file from user's isolated storage
      if (project.storagePath || project.projectUrl) {
        await safeDeleteUserStorage(req.user.userId, "code", project.storagePath || project.projectUrl);
      }

      project.projectName = projectName;
      project.projectUrl = `/api/projects/${project._id}/archive`;
      project.storagePath = req.file.path;
      if (projectDescription !== undefined) project.projectDescription = projectDescription || "Saved Workspace";
      if (projectProgrammingLanguage) project.projectProgrammingLanguage = projectProgrammingLanguage;

      await project.save();
      return res.json({ success: true, project, updated: true });
    }

    project = new Project({
      userId: req.user.userId,
      projectName,
      projectUrl: "/api/projects/pending/archive",
      storagePath: req.file.path,
      projectDescription: projectDescription || "Saved Workspace",
      projectProgrammingLanguage: projectProgrammingLanguage || "Various",
    });

    await project.save();
    project.projectUrl = `/api/projects/${project._id}/archive`;
    await project.save();

    return res.json({ success: true, project, created: true });
  } catch (error) {
    console.error("Save project error:", error);
    return res.status(500).json({ error: "Failed to save project" });
  }
});

// Save PDF Endpoint (User-isolated storage)
router.post("/save-pdf", authenticate, handleUploadSingle("pdfFile"), async (req, res) => {
  try {
    const { pdfName } = req.body;

    if (!pdfName || !req.file) {
      return res.status(400).json({ error: "PDF name and file are required" });
    }

    const pdf = new Pdf({
      userId: req.user.userId,
      pdfName,
      pdfUrl: "/api/pdfs/pending/file",
      storagePath: req.file.path,
    });

    await pdf.save();
    pdf.pdfUrl = `/api/pdfs/${pdf._id}/file`;
    await pdf.save();

    return res.json({ success: true, pdf });
  } catch (error) {
    console.error("Save PDF error:", error);
    return res.status(500).json({ error: "Failed to save PDF" });
  }
});

// Simple Teacher Agent Endpoint
router.post("/ask-ai", authenticate, async (req, res) => {
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

/**
 * Intelligently assembles a preview document from HTML, CSS, and JS.
 * Ensures external CDNs (like GSAP), stylesheets, and scripts execute cleanly
 * whether the user provided a full HTML document or an HTML fragment.
 */
function assemblePreviewDocument({ html = "", css = "", js = "" }) {
  const hasFullDocument = /<!DOCTYPE\s+html|<html[\s>]/i.test(html);
  const usesGsap = /(gsap\.|TweenMax|TimelineMax|ScrollTrigger)/i.test(html + " " + js);
  const hasGsapCdn = /cdnjs\.cloudflare\.com\/ajax\/libs\/gsap|cdn\.jsdelivr\.net\/npm\/gsap|unpkg\.com\/gsap/i.test(html);

  const gsapScripts = (usesGsap && !hasGsapCdn)
    ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>\n`
    : "";

  const styleTag = css.trim() ? `<style>\n${css}\n</style>` : "";
  const scriptTag = js.trim() ? `<script>\ndocument.addEventListener("DOMContentLoaded", () => {\n${js}\n});\n<\/script>` : "";

  if (hasFullDocument) {
    let doc = html;

    // 1. If GSAP is used and not in HTML, inject into <head>
    if (gsapScripts) {
      if (/<head[\s>]/i.test(doc)) {
        doc = doc.replace(/<head[\s>]/i, (match) => `${match}\n${gsapScripts}`);
      } else if (/<html[\s>]/i.test(doc)) {
        doc = doc.replace(/<html[\s>]/i, (match) => `${match}\n<head>${gsapScripts}</head>`);
      } else {
        doc = gsapScripts + doc;
      }
    }

    // 2. Inject CSS: replace <link ... href="style.css"> if present, or inject into <head>
    if (styleTag) {
      if (/<link[^>]+href=["'](?:\.\/)?style\.css["'][^>]*>/i.test(doc)) {
        doc = doc.replace(/<link[^>]+href=["'](?:\.\/)?style\.css["'][^>]*>/i, styleTag);
      } else if (/<\/head>/i.test(doc)) {
        doc = doc.replace(/<\/head>/i, `${styleTag}\n</head>`);
      } else if (/<body[\s>]/i.test(doc)) {
        doc = doc.replace(/<body[\s>]/i, `${styleTag}\n<body>`);
      } else {
        doc = styleTag + doc;
      }
    }

    // 3. Inject JS: replace <script src="script.js"></script> if present, or inject before </body>
    if (scriptTag) {
      if (/<script[^>]+src=["'](?:\.\/)?(?:script|main)\.js["'][^>]*>\s*<\/script>/i.test(doc)) {
        doc = doc.replace(/<script[^>]+src=["'](?:\.\/)?(?:script|main)\.js["'][^>]*>\s*<\/script>/i, scriptTag);
      } else if (/<\/body>/i.test(doc)) {
        doc = doc.replace(/<\/body>/i, `${scriptTag}\n</body>`);
      } else {
        doc = doc + "\n" + scriptTag;
      }
    }

    return doc;
  }

  // If HTML is a fragment, wrap in complete HTML5 document with GSAP CDN included
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <!-- GSAP CDN Core & ScrollTrigger Plugin -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
  ${styleTag}
</head>
<body>
${html}
${scriptTag}
</body>
</html>`;
}

// Store a preview snippet — returns an opaque 32-hex-char id
router.post("/preview", authenticate, (req, res) => {
  const { html = "", css = "", js = "" } = req.body || {};

  if (typeof html !== "string" || typeof css !== "string" || typeof js !== "string") {
    return res.status(400).json({ error: "html, css, and js must be strings." });
  }

  const document = assemblePreviewDocument({ html, css, js });

  const byteLen = Buffer.byteLength(document, "utf8");
  if (byteLen > PREVIEW_MAX_BYTES) {
    return res.status(413).json({ error: "Preview content exceeds 2 MB limit." });
  }

  const id = randomBytes(16).toString("hex"); // 32-char hex — unguessable
  previewStore.set(id, { html: document, expiresAt: Date.now() + PREVIEW_TTL_MS, userId: req.user?.userId });

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

  // Verify preview ownership
  if (entry.userId && req.user?.userId && entry.userId !== req.user.userId) {
    return res.status(403).send("Forbidden: You do not have permission to access this preview.");
  }

  res
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("X-Content-Type-Options", "nosniff")
    .setHeader(
      "Content-Security-Policy",
      "sandbox allow-scripts allow-forms allow-modals allow-popups; default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob: https: http:; style-src * 'unsafe-inline' data: blob: https: http:; img-src * data: blob: https: http:; font-src * data: blob: https: http:; media-src * data: blob: https: http:; connect-src * data: blob: https: http: ws: wss:; frame-src * data: blob: https: http:;"
    )
    .setHeader("X-Frame-Options", "DENY")
    .send(entry.html);
});

export default router;

