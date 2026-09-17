import { Router } from 'express';
import loginCodeEditorController from '../../../Controllers/authControllers/loginCodeEditorController.js';
import logoutCodeEditorController from '../../../Controllers/authControllers/logoutCodeEditorController.js';

const router = Router();

router.get('/login', (req, res) => {
    res.render('auth/loginCodeEditor', { error: undefined, formData: {} });
});

router.post('/login', loginCodeEditorController);

// Logout route - clears the JWT cookie and redirects to /login
router.get('/logout', logoutCodeEditorController);
router.post('/logout', logoutCodeEditorController);

export default router;
