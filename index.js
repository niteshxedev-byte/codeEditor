import express from 'express';
import dotenv from 'dotenv';
import path from "path";
import { fileURLToPath } from "url";
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';

import aboutProjectRoute from "./src/Routes/aboutProjectRoutes/aboutProjectRoute.js";
import loginRoute from "./src/Routes/authRoute/loginRoutes/loginRoute.js";
import registerRoute from "./src/Routes/authRoute/registerRoutes/registerRoutes.js";
import dashbordRoute from "./src/Routes/dashbordRoutes/dashbordRoutes.js";
import editorRoute from "./src/Routes/editorRoutes/editorRoutes.js";
import connectDB from './src/Config/db.connection.js';
import { runTeacherAgent } from "./src/Services/langchainAgent.service.js";
import { checkAndIncrementAiQuota } from "./src/Services/quota.service.js";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

// Validate critical security secrets on bootstrap
const INSECURE_JWT_SECRETS = new Set([
    'secret',
    'changeme',
    'your-secret-key',
    'your_jwt_secret_key_here',
    'supersecretkey123',
    'jwt_secret',
]);

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32 || INSECURE_JWT_SECRETS.has(jwtSecret.toLowerCase())) {
    throw new Error(
        "FATAL SECURITY CONFIGURATION: JWT_SECRET is missing, shorter than 32 characters, or set to an insecure default."
    );
}

if (isProduction) {
    if (!process.env.MONGO_URI) {
        throw new Error("FATAL: MONGO_URI must be configured in production.");
    }
    if (allowedOrigins.length === 0) {
        throw new Error("FATAL: ALLOWED_ORIGINS must be configured in production.");
    }
}

await connectDB(process.env.MONGO_URI);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');

// Security headers with strict Content-Security-Policy via Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'", // Monaco editor worker bundle requires eval for grammar syntax parsers
                "https://cdnjs.cloudflare.com",
                "https://cdn.jsdelivr.net",
                "https://cdn.socket.io",
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
                "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com",
            ],
            fontSrc: [
                "'self'",
                "https://fonts.gstatic.com",
                "https://cdn.jsdelivr.net",
            ],
            connectSrc: ["'self'", "ws:", "wss:"],
            imgSrc: ["'self'", "data:", "blob:"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// Strict CORS validator
const checkCorsOrigin = (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl, same-origin)
    if (!origin) return callback(null, true);

    // Allow origins explicitly listed in ALLOWED_ORIGINS
    if (allowedOrigins.length > 0 && (allowedOrigins.includes(origin) || allowedOrigins.includes("*"))) {
        return callback(null, true);
    }

    // In non-production, permit localhost, loopback, and local network IPs
    if (!isProduction) {
        const localOrLanRegex = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|\[::1\])(:\d+)?$/;
        if (localOrLanRegex.test(origin)) {
            return callback(null, true);
        }
    }

    return callback(new Error("CORS not allowed"));
};

const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: checkCorsOrigin,
        credentials: true
    },
    transports: ["websocket", "polling"],
});

// Security headers
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
});

// Authenticate socket connections using JWT cookie
io.use((socket, next) => {
    try {
        const rawCookie = socket.handshake.headers.cookie;
        if (!rawCookie) {
            return next(new Error("Authentication required: No cookies provided"));
        }
        const match = rawCookie.match(/(?:^|;\s*)token=([^;]+)/);
        const token = match ? decodeURIComponent(match[1]) : null;
        if (!token) {
            return next(new Error("Authentication required: Session token missing"));
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        socket.user = decoded;
        next();
    } catch (err) {
        return next(new Error("Authentication failed: Invalid or expired token"));
    }
});

// Attach io to req so routes can access if needed
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Handle real-time connections
io.on('connection', (socket) => {
    socket.on('ask-ai', async (data) => {
        try {
            if (!data || typeof data !== 'object') {
                return socket.emit('ai_error', { message: 'Invalid payload structure' });
            }

            const { prompt, model, fileSystem, activeFileId, code, language } = data;

            // Validate prompt presence and length (max 4000 characters)
            if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
                return socket.emit('ai_error', { message: 'Prompt must be a non-empty string.' });
            }
            if (prompt.length > 4000) {
                return socket.emit('ai_error', { message: 'Prompt exceeds maximum allowed length of 4000 characters.' });
            }

            // Reject oversized code payloads (> 100 KB)
            if (typeof code === 'string' && code.length > 100 * 1024) {
                return socket.emit('ai_error', { message: 'Payload rejected: code exceeds 100 KB limit.' });
            }

            // Enforce per-user daily AI quota (50 requests/day)
            const quota = checkAndIncrementAiQuota(socket.user?.userId);
            if (!quota.allowed) {
                return socket.emit('ai_error', {
                    message: `Daily AI request quota exceeded (${quota.limit} requests/day). Please try again tomorrow.`
                });
            }

            const emitter = {
                onAnalysisChunk: (chunk) => socket.emit('ai_chunk', chunk),
                onThought: (thought) => socket.emit('ai_thought', thought),
                onToolCall: (toolCall) => socket.emit('ai_tool_call', toolCall),
                onToolResult: (result) => socket.emit('ai_tool_result', result)
            };

            const result = await runTeacherAgent({
                prompt,
                modelName: model || "llama3.2:1b",
                fileSystem: Array.isArray(fileSystem) ? fileSystem : [],
                activeFileId,
                activeCode: code || "",
                language: language || "JavaScript",
                emitter
            });

            socket.emit('ai_complete', {
                response: result.response,
                actions: result.actions || [],
                model: result.model
            });
        } catch (error) {
            socket.emit('ai_error', { message: error.message });
        }
    });

    socket.on('disconnect', () => { });
});

app.use(morgan('dev'));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(cookieParser());

// NoSQL injection sanitizer: sanitize keys starting with '$' or containing '.'
const sanitizeMongo = (target) => {
    if (!target || typeof target !== 'object') return;
    for (const key of Object.keys(target)) {
        if (key.startsWith('$') || key.includes('.')) {
            delete target[key];
        } else if (typeof target[key] === 'object' && target[key] !== null) {
            sanitizeMongo(target[key]);
        }
    }
};

app.use((req, res, next) => {
    if (req.body) sanitizeMongo(req.body);
    if (req.query) sanitizeMongo(req.query);
    if (req.params) sanitizeMongo(req.params);
    next();
});

// Trust proxy for Docker and reverse proxies
app.set('trust proxy', 1);

// Session middleware — secure only if accessing via HTTPS
const isCookieSecure = process.env.COOKIE_SECURE === 'true';
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isCookieSecure, // Set to true ONLY if accessing via HTTPS
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Strictly block any direct or unauthenticated access to legacy uploads path
app.use('/uploads', (req, res) => {
    return res.status(403).json({
        error: "Forbidden: Direct unauthenticated file access is blocked. User files and code are strictly protected and isolated."
    });
});

app.use(express.static(path.join(__dirname, 'src/public')));
app.set('views', path.join(__dirname, 'src/Views'));
app.set('view engine', 'ejs');

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.redirect("/aboutCodeEditor");
});

app.use("/", aboutProjectRoute);
app.use("/", loginRoute);
app.use("/", registerRoute);
app.use("/", dashbordRoute);
app.use("/", editorRoute);

// Global production-aware error handling middleware (prevents stack trace disclosure)
app.use((err, req, res, next) => {
    console.error("Unhandled Application Error:", err.message || err);

    if (res.headersSent) {
        return next(err);
    }

    const isProd = process.env.NODE_ENV === "production";
    const status = err.status || err.statusCode || 500;
    const message = isProd && status === 500
        ? "An internal server error occurred."
        : err.message || "An unexpected error occurred.";

    if (req.is('json') || req.path.startsWith('/api') || req.xhr) {
        return res.status(status).json({
            error: message,
            status: "Error",
            ...(isProd ? {} : { stack: err.stack }),
        });
    }

    return res.status(status).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Error</title><style>body{background:#000;color:#fff;font-family:sans-serif;padding:40px;text-align:center;}</style></head>
        <body>
            <h2>Something went wrong</h2>
            <p>${message}</p>
            <p><a href="/aboutCodeEditor" style="color:#2563eb;">Return to Home</a></p>
        </body>
        </html>
    `);
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
