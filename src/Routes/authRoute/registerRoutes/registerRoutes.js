import { Router } from 'express';
import registerCodeEditorController from '../../../Controllers/authControllers/registerCodeEditorController.js';

const router = Router();

router.get('/register', (req, res) => {
    res.render('auth/registerCodeEditor', { error: undefined, formData: {} });
});

router.post('/register', registerCodeEditorController);

export default router;