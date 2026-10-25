import mongoose from "mongoose";
import User from "../../Models/userModels/userModels.js";
import Project from "../../Models/userModels/projectsModel.js/projectModel.js";
import Pdf from "../../Models/userModels/pdfModels.js";
import { resolveUserId, safeDeleteUpload, safeDeleteUserStorage } from "../../Utils/fileHelper.js";

/**
 * GET /DashboardCodeEditor
 * Renders the dashboard view populated with the authenticated user's saved workspaces and PDFs.
 */
export const renderDashboard = async (req, res) => {
    try {
        const decoded = req.user;
        let user = null;

        if (decoded.userId) {
            user = await User.findOne({ userId: decoded.userId });
        } else if (decoded.email) {
            user = await User.findOne({ email: decoded.email });
        }

        if (!user && decoded.username) {
            user = { username: decoded.username, email: decoded.email, userId: decoded.userId };
        }

        if (!user) {
            return res.redirect("/login");
        }

        const currentUserId = user.userId || decoded.userId;
        const [projects, pdfs] = await Promise.all([
            Project.find({ userId: currentUserId }).sort({ createdAt: -1 }),
            Pdf.find({ userId: currentUserId }).sort({ createdAt: -1 }),
        ]);

        return res.render("dashBoard/dashbord/DashboardCodeEditor", {
            user: {
                username: user.username,
                email: user.email,
                userId: user.userId,
            },
            projects: projects || [],
            pdfs: pdfs || [],
        });
    } catch (error) {
        console.error("Dashboard render error:", error);
        return res.redirect("/login");
    }
};

/**
 * PATCH /api/projects/:id & POST /api/projects/:id/rename
 * Renames an existing workspace project owned by the user.
 */
export const renameProject = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: "Invalid project ID" });
        }

        const currentUserId = await resolveUserId(req.user);
        if (!currentUserId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const project = await Project.findById(id);
        if (!project) {
            return res.status(404).json({ success: false, error: "Workspace not found" });
        }

        if (project.userId !== currentUserId) {
            return res.status(403).json({ success: false, error: "Forbidden: You do not own this workspace" });
        }

        const { name, description } = req.body;
        if (!name || typeof name !== "string" || !name.trim()) {
            return res.status(400).json({ success: false, error: "Workspace name cannot be empty" });
        }

        const trimmedName = name.trim();
        if (trimmedName.length > 100) {
            return res.status(400).json({ success: false, error: "Workspace name must be 100 characters or less" });
        }

        project.projectName = trimmedName;
        if (typeof description === "string") {
            project.projectDescription = description.trim().slice(0, 300);
        }

        await project.save();

        return res.json({
            success: true,
            message: "Workspace renamed successfully",
            project: {
                _id: project._id,
                projectName: project.projectName,
                projectDescription: project.projectDescription,
                projectUrl: project.projectUrl,
            },
        });
    } catch (error) {
        console.error("Error renaming workspace:", error);
        return res.status(500).json({ success: false, error: "Failed to rename workspace" });
    }
};

/**
 * DELETE /api/projects/:id & POST /api/projects/:id/delete
 * Permanently deletes a workspace project and unlinks its zip archive from disk.
 */
export const deleteProject = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: "Invalid project ID" });
        }

        const currentUserId = await resolveUserId(req.user);
        if (!currentUserId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const project = await Project.findById(id);
        if (!project) {
            return res.status(404).json({ success: false, error: "Workspace not found" });
        }

        if (project.userId !== currentUserId) {
            return res.status(403).json({ success: false, error: "Forbidden: You do not own this workspace" });
        }

        // Clean up disk archive safely from isolated user storage
        await safeDeleteUserStorage(currentUserId, "code", project.storagePath || project.projectUrl);

        await Project.findByIdAndDelete(id);

        return res.json({
            success: true,
            message: "Workspace deleted successfully",
            id,
        });
    } catch (error) {
        console.error("Error deleting workspace:", error);
        return res.status(500).json({ success: false, error: "Failed to delete workspace" });
    }
};

/**
 * PATCH /api/pdfs/:id & POST /api/pdfs/:id/rename
 * Renames an exported documentation PDF owned by the user.
 */
export const renamePdf = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: "Invalid document ID" });
        }

        const currentUserId = await resolveUserId(req.user);
        if (!currentUserId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const pdf = await Pdf.findById(id);
        if (!pdf) {
            return res.status(404).json({ success: false, error: "Document not found" });
        }

        if (pdf.userId !== currentUserId) {
            return res.status(403).json({ success: false, error: "Forbidden: You do not own this document" });
        }

        const { name } = req.body;
        if (!name || typeof name !== "string" || !name.trim()) {
            return res.status(400).json({ success: false, error: "Document name cannot be empty" });
        }

        const trimmedName = name.trim();
        if (trimmedName.length > 100) {
            return res.status(400).json({ success: false, error: "Document name must be 100 characters or less" });
        }

        pdf.pdfName = trimmedName;
        await pdf.save();

        return res.json({
            success: true,
            message: "Document renamed successfully",
            pdf: {
                _id: pdf._id,
                pdfName: pdf.pdfName,
                pdfUrl: pdf.pdfUrl,
            },
        });
    } catch (error) {
        console.error("Error renaming PDF:", error);
        return res.status(500).json({ success: false, error: "Failed to rename document" });
    }
};

/**
 * DELETE /api/pdfs/:id & POST /api/pdfs/:id/delete
 * Permanently deletes an exported PDF and unlinks its file from disk.
 */
export const deletePdf = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: "Invalid document ID" });
        }

        const currentUserId = await resolveUserId(req.user);
        if (!currentUserId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const pdf = await Pdf.findById(id);
        if (!pdf) {
            return res.status(404).json({ success: false, error: "Document not found" });
        }

        if (pdf.userId !== currentUserId) {
            return res.status(403).json({ success: false, error: "Forbidden: You do not own this document" });
        }

        // Clean up disk PDF safely from isolated user storage
        await safeDeleteUserStorage(currentUserId, "files", pdf.storagePath || pdf.pdfUrl);

        await Pdf.findByIdAndDelete(id);

        return res.json({
            success: true,
            message: "Document deleted successfully",
            id,
        });
    } catch (error) {
        console.error("Error deleting PDF:", error);
        return res.status(500).json({ success: false, error: "Failed to delete document" });
    }
};

export default {
    renderDashboard,
    renameProject,
    deleteProject,
    renamePdf,
    deletePdf,
};
