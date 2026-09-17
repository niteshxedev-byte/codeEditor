import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../../Models/userModels/userModels.js';

const loginCodeEditorController = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
            return res.render('auth/loginCodeEditor', { error: 'Email and password are required.', formData: {} });
        }

        const cleanEmail = email.trim().toLowerCase();
        if (cleanEmail.length > 254 || password.length > 128) {
            return res.render('auth/loginCodeEditor', { error: 'Invalid email or password length.', formData: {} });
        }

      
        if (!user) {
            return res.render('auth/loginCodeEditor', { error: 'No account found with that email.', formData: { email: cleanEmail } });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.render('auth/loginCodeEditor', { error: 'Incorrect password.', formData: { email } });
        }

        const token = jwt.sign(
            { userId: user.userId, username: user.username, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.redirect('/DashboardCodeEditor');
    } catch (error) {
        console.error(error);
        res.render('auth/loginCodeEditor', { error: 'Something went wrong. Try again.' });
    }
};

export default loginCodeEditorController;