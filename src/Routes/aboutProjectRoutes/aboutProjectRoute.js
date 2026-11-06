import { Router } from "express";
import { optionalAuth } from "../../Middlewares/auth.middleware.js";

const router = Router();

router.get(["/aboutCodeEditor", "/about", "/aboutcodeeditor"], optionalAuth, (req, res) => {
    res.render("aboutcodeeditor", {
        user: req.user || null
    });
});

export default router;
