import { Router } from 'express';
import jwt from 'jsonwebtoken';
import registerCodeEditorController from '../../../Controllers/authControllers/registerCodeEditorController.js';

const router = Router();

router.get('/register', (req, res) => {
    if (req.cookies?.token) {
        try {
            jwt.verify(req.cookies.token, process.env.JWT_SECRET);
            return res.redirect('/DashboardCodeEditor');
        } catch (_) {}
    }
    res.render('auth/registerCodeEditor', { error: undefined, formData: {} });
});

// Backward compatibility redirect for old link
router.get('/registerCodeEditor', (req, res) => {
    res.redirect('/register');
});

router.post('/register', registerCodeEditorController);

export default router;