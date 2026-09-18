import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../../Models/userModels/userModels.js';

const registerCodeEditorController = async (req, res) => {
    try {
        const { username, email, password, confirmPassword } = req.body;

        const isJson = Boolean(req.xhr || req.headers.accept?.includes('application/json'));

        const sendError = (status, message, formData = {}) => {
            if (isJson) {
                return res.status(status).json({ error: message });
            }
            return res.render('auth/registerCodeEditor', { error: message, formData });
        };

        // 1. Required fields check & type safety
        if (
            !username || !email || !password || !confirmPassword ||
            typeof username !== 'string' || typeof email !== 'string' ||
            typeof password !== 'string' || typeof confirmPassword !== 'string'
        ) {
            return sendError(400, 'All fields are required.', {
                username: typeof username === 'string' ? username.trim() : '',
                email: typeof email === 'string' ? email.trim() : ''
            });
        }

        const cleanUsername = username.trim();
        const cleanEmail = email.trim().toLowerCase();

        // 2. Validate username format (3-30 chars, alphanumeric, underscores, dots, hyphens)
        const usernameRegex = /^[a-zA-Z0-9_.-]{3,30}$/;
        if (!usernameRegex.test(cleanUsername)) {
            return sendError(400, 'Username must be 3-30 characters (letters, numbers, underscores, dots, hyphens).', {
                username: cleanUsername,
                email: cleanEmail
            });
        }

        // 3. Validate email format & length
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (cleanEmail.length > 254 || !emailRegex.test(cleanEmail)) {
            return sendError(400, 'Please enter a valid email address.', {
                username: cleanUsername,
                email: cleanEmail
            });
        }

        // 4. Validate password length
        if (password.length < 8 || password.length > 128) {
            return sendError(400, 'Password must be between 8 and 128 characters.', {
                username: cleanUsername,
                email: cleanEmail
            });
        }

        // 5. Validate password match
        if (password !== confirmPassword) {
            return sendError(400, 'Passwords do not match.', {
                username: cleanUsername,
                email: cleanEmail
            });
        }

        // 6. Check if email or username already exists
        const existingUser = await User.findOne({
            $or: [{ email: cleanEmail }, { username: cleanUsername }]
        });
        if (existingUser) {
            const isEmailTaken = existingUser.email === cleanEmail;
            return sendError(409, isEmailTaken ? 'An account with that email already exists.' : 'That username is already taken.', {
                username: cleanUsername,
                email: cleanEmail
            });
        }

        // 7. Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // 8. Create user
        const newUser = new User({
            userId: new mongoose.Types.ObjectId().toString(),
            username: cleanUsername,
            email: cleanEmail,
            password: hashedPassword,
        });

        await newUser.save();

        if (isJson) {
            return res.status(201).json({
                success: true,
                message: 'Account created successfully.',
                redirectUrl: `/login?registered=true&email=${encodeURIComponent(cleanEmail)}`
            });
        }

        return res.redirect(`/login?registered=true&email=${encodeURIComponent(cleanEmail)}`);
    } catch (error) {
        console.error('Registration error:', error);

        const isJson = Boolean(req.xhr || req.headers.accept?.includes('application/json'));
        const fallbackFormData = {
            username: typeof req.body?.username === 'string' ? req.body.username.trim() : '',
            email: typeof req.body?.email === 'string' ? req.body.email.trim() : ''
        };

        // Handle MongoDB duplicate key error (code 11000)
        if (error && error.code === 11000) {
            const isEmail = error.keyPattern && error.keyPattern.email;
            const isUsername = error.keyPattern && error.keyPattern.username;
            let message = 'An account with those details already exists.';
            if (isEmail) message = 'An account with that email already exists.';
            else if (isUsername) message = 'That username is already taken.';

            if (isJson) {
                return res.status(409).json({ error: message });
            }
            return res.render('auth/registerCodeEditor', { error: message, formData: fallbackFormData });
        }

        if (isJson) {
            return res.status(500).json({ error: 'Something went wrong. Please try again.' });
        }
        return res.render('auth/registerCodeEditor', {
            error: 'Something went wrong. Please try again.',
            formData: fallbackFormData
        });
    }
};

export default registerCodeEditorController;