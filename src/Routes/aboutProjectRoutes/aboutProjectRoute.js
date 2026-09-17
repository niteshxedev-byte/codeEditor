import { Router } from "express";

const router = Router();

router.get("/aboutCodeEditor", (req, res) => {
    res.render("aboutProjectRoute");
});

export default router;
