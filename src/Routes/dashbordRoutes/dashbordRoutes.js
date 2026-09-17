import { Router } from "express";
import User from "../../Models/userModels/userModels.js";
import Project from "../../Models/userModels/projectsModel.js/projectModel.js";
import Pdf from "../../Models/userModels/pdfModels.js";
import { requireAuth } from "../../Middlewares/auth.middleware.js";

const router = Router();

router.get("/DashboardCodeEditor", requireAuth, async (req, res) => {
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

        // Fetch user's projects and pdfs from MongoDB
        const currentUserId = user.userId || decoded.userId;
        const [projects, pdfs] = await Promise.all([
            Project.find({ userId: currentUserId }).sort({ createdAt: -1 }),
            Pdf.find({ userId: currentUserId }).sort({ createdAt: -1 })
        ]);

        res.render("dashBoard/dashbord/DashboardCodeEditor", {
            user: {
                username: user.username,
                email: user.email,
                userId: user.userId
            },
            projects: projects || [],
            pdfs: pdfs || []
        });
    } catch (error) {
        console.error("Dashboard auth error:", error);
        return res.redirect("/login");
    }
});

export default router;