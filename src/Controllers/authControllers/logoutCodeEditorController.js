const logoutCodeEditorController = (req, res) => {
    const isSecure = process.env.COOKIE_SECURE === 'true';
    res.clearCookie('token', {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
    });

    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.json({ success: true, message: 'Logged out successfully' });
    }

    return res.redirect('/login');
};

export default logoutCodeEditorController;

