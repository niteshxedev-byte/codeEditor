const logoutCodeEditorController = (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
    });

    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.json({ success: true, message: 'Logged out successfully' });
    }

    return res.redirect('/login');
};

export default logoutCodeEditorController;

