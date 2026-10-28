import { Router } from "express";
import { optionalAuth } from "../../Middlewares/auth.middleware.js";

const router = Router();

router.get("/aboutCodeEditor", optionalAuth, (req, res) => {
    res.render("aboutProjectRoute", {
        user: req.user || null
    });
});

export default router;

