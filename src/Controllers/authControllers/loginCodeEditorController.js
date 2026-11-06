import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../../Models/userModels/userModels.js';
import connectDB from '../../Config/db.connection.js';

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

        // Fast-fail if MongoDB is not connected instead of hanging 10 seconds
        if (mongoose.connection.readyState !== 1) {
            await connectDB();
            if (mongoose.connection.readyState !== 1) {
                return res.render('auth/loginCodeEditor', {
                    error: 'Database is currently unreachable. Check your MongoDB Atlas Network Access IP whitelist and MONGO_URI.',
                    formData: { email: cleanEmail }
                });
            }
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
            secure: isSecure,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        return res.redirect('/DashboardCodeEditor');
    } catch (error) {
        console.error("Login error:", error);
        return res.render('auth/loginCodeEditor', { error: 'Something went wrong. Try again.', formData: {} });
    }
};

export default loginCodeEditorController;
