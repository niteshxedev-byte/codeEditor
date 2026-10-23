import { Router } from "express";
import { requireAuth, requireApiAuth } from "../../Middlewares/auth.middleware.js";
import {
    renderDashboard,
    renameProject,
    deleteProject,
    renamePdf,
    deletePdf,
} from "../../Controllers/dashboardControllers/dashboardController.js";

const router = Router();

// Page Route
router.get("/DashboardCodeEditor", requireAuth, renderDashboard);

// Workspace Projects API
router.patch("/api/projects/:id", requireApiAuth, renameProject);
router.post("/api/projects/:id/rename", requireApiAuth, renameProject);
router.delete("/api/projects/:id", requireApiAuth, deleteProject);
router.post("/api/projects/:id/delete", requireApiAuth, deleteProject);

// Exports & Documentation (PDF) API
router.patch("/api/pdfs/:id", requireApiAuth, renamePdf);
router.post("/api/pdfs/:id/rename", requireApiAuth, renamePdf);
router.delete("/api/pdfs/:id", requireApiAuth, deletePdf);
router.post("/api/pdfs/:id/delete", requireApiAuth, deletePdf);

export default router;
