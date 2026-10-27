import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../../Models/userModels/userModels.js';

const loginCodeEditorController = async (req, res) => {
    const isApi = req.path.startsWith('/api') || req.is('json') || req.headers['content-type']?.includes('application/json');

    try {
        const { email, password } = req.body || {};

        if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
            if (isApi) {
                return res.status(400).json({ error: 'Email and password are required and must be strings.' });
            }
            return res.status(400).render('auth/loginCodeEditor', { error: 'Email and password are required.', formData: {} });
        }

        const cleanEmail = email.trim().toLowerCase();
        if (cleanEmail.length > 254 || password.length > 128) {
            if (isApi) {
                return res.status(400).json({ error: 'Invalid email or password length.' });
            }
            return res.status(400).render('auth/loginCodeEditor', { error: 'Invalid email or password length.', formData: {} });
        }

        const user = await User.findOne({ email: cleanEmail });

        if (!user) {
            if (isApi) {
                return res.status(401).json({ error: 'Invalid email or password.' });
            }
            return res.status(401).render('auth/loginCodeEditor', { error: 'No account found with that email.', formData: { email: cleanEmail } });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            if (isApi) {
                return res.status(401).json({ error: 'Invalid email or password.' });
            }
            return res.status(401).render('auth/loginCodeEditor', { error: 'Incorrect password.', formData: { email: cleanEmail } });
        }

        const token = jwt.sign(
            { userId: user.userId, username: user.username, email: user.email },
            process.env.JWT_SECRET,
            { algorithm: 'HS256', expiresIn: '7d' }
        );

        // Secure only if accessing via HTTPS or COOKIE_SECURE is explicitly true
        const isSecure = process.env.COOKIE_SECURE === 'true' || (req.secure && req.headers['x-forwarded-proto'] === 'https');

        res.cookie('token', token, {
            httpOnly: true,
            secure: isSecure,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        if (isApi) {
            return res.status(200).json({
                success: true,
                message: "Logged in successfully",
                token,
                user: { userId: user.userId, username: user.username, email: user.email }
            });
        }

        return res.redirect('/DashboardCodeEditor');
    } catch (error) {
        console.error("Login error:", error);
        if (isApi) {
            return res.status(500).json({ error: 'Internal server error during login.' });
        }
        return res.status(500).render('auth/loginCodeEditor', { error: 'Something went wrong. Try again.', formData: {} });
    }
};

export default loginCodeEditorController;
