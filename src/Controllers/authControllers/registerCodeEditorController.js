import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../../Models/userModels/userModels.js';

const registerCodeEditorController = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password || 
            typeof username !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
            return res.render('auth/registerCodeEditor', { error: 'All fields are required and must be valid text.', formData: {} });
        }

        if (password.length < 8) {
            return res.render('auth/registerCodeEditor', { error: 'Password must be at least 8 characters.', formData: { username, email } });
        const cleanUsername = username.trim();
     
        if (cleanUsername.length < 3 || cleanUsername.length > 30 || !/^[a-zA-Z0-9_.-]+$/.test(cleanUsername)) {
            return res.render('auth/registerCodeEditor', { 
                error: 'Username must be 3-30 alphanumeric characters (underscores and hyphens allowed).', 
                formData: { email: cleanEmail } 
            });
        }

        
        if (password.length < 8 || password.length > 128) {
            return res.render('auth/registerCodeEditor', { 
                error: 'Password must be between 8 and 128 characters.', 
                formData: { username: cleanUsername, email: cleanEmail } 
            });
        }

        const existingUser = await User.findOne({ $or: [{ email: cleanEmail }, { username: cleanUsername }] });
        if (existingUser) {
            const field = existingUser.email === email ? 'email' : 'username';
            return res.render('auth/registerCodeEditor', { error: `An account with that ${field} already exists.`, formData: { username, email } });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const newUser = new User({
            userId: new mongoose.Types.ObjectId().toString(),
            username,
            email,
            password: hashedPassword,
        });

        await newUser.save();

        res.redirect('/login');
    }}catch(error){
         res.redirect('/login');
    }
}



     

    

   


export default registerCodeEditorController;