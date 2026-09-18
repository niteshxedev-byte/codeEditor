import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../../Models/userModels/userModels.js';

const loginCodeEditorController = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
            return res.render('auth/loginCodeEditor', { error: 'Email and password are required.', formData: {} });
        }

        const cleanEmail = email.trim().toLowerCase();
        if (cleanEmail.length > 254 || password.length > 128) {
            return res.render('auth/loginCodeEditor', { error: 'Invalid email or password length.', formData: {} });
        }

        const user = await User.findOne({ email: cleanEmail });

        if (!user) {
            return res.render('auth/loginCodeEditor', { error: 'No account found with that email.', formData: { email: cleanEmail } });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.render('auth/loginCodeEditor', { error: 'Incorrect password.', formData: { email: cleanEmail } });
        }

        const token = jwt.sign(
            { userId: user.userId, username: user.username, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Secure only if accessing via HTTPS or COOKIE_SECURE is explicitly true
        const isSecure = process.env.COOKIE_SECURE === 'true' || (req.secure && req.headers['x-forwarded-proto'] === 'https');

        res.cookie('token', token, {
            httpOnly: true,
            secure: isSecure, // Set to true ONLY if accessing via HTTPS
            sameSite: 'lax',  // Required for cookies to persist across top-level redirects
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.redirect('/DashboardCodeEditor');
    } catch (error) {
        console.error(error);
        res.render('auth/loginCodeEditor', { error: 'Something went wrong. Try again.' });
    }
};

export default loginCodeEditorController;