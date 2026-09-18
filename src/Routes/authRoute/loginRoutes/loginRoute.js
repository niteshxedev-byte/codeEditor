import { Router } from 'express';
import jwt from 'jsonwebtoken';
import loginCodeEditorController from '../../../Controllers/authControllers/loginCodeEditorController.js';
import logoutCodeEditorController from '../../../Controllers/authControllers/logoutCodeEditorController.js';

const router = Router();

router.get('/login', (req, res) => {
    if (req.cookies?.token) {
        try {
            jwt.verify(req.cookies.token, process.env.JWT_SECRET);
            return res.redirect('/DashboardCodeEditor');
        } catch (_) {}
    }

    const success = req.query.registered ? 'Account created successfully! Please log in.' : undefined;
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    return res.render('auth/loginCodeEditor', { error: undefined, success, formData: { email } });
});

// Backward compatibility redirect for old link
router.get('/loginCodeEditor', (req, res) => {
    return res.redirect('/login');
});

router.post('/login', loginCodeEditorController);

// Logout route - clears the JWT cookie and redirects to /login
router.get('/logout', logoutCodeEditorController);
router.post('/logout', logoutCodeEditorController);

export default router;
