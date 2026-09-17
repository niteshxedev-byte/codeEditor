import jwt from "jsonwebtoken";

/**
 * Extracts token from either httpOnly cookie or Authorization Bearer header.
 */
const extractToken = (req) => {
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }
  return null;
};

/**
 * Web Page Auth Middleware:
 * For page routes like /editor, /DashboardCodeEditor.
 * Redirects unauthenticated visitors to /login.
 */
export const requireAuth = (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.redirect("/login");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.clearCookie("token");
    return res.redirect("/login");
  }
};

/**
 * API Auth Middleware:
 * For JSON endpoints like /save-project, /save-pdf, /runCode.
 * Returns standard 401 Unauthorized JSON responses.
 */
export const requireApiAuth = (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
};

/**
 * Optional Auth Middleware:
 * Attaches req.user if a valid token is present, but allows guest access if not.
 */
export const optionalAuth = (req, res, next) => {
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch (_) {
      // Silent pass for optional auth
    }
  }
  next();
};

export default {
  requireAuth,
  requireApiAuth,
  optionalAuth,
};

