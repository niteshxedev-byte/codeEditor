import 'dotenv/config';
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

import aboutProjectRoute from "./src/Routes/aboutProjectRoutes/aboutProjectRoute.js";
import loginRoute from "./src/Routes/authRoute/loginRoutes/loginRoute.js";
import registerRoute from "./src/Routes/authRoute/registerRoutes/registerRoutes.js";
import dashbordRoute from "./src/Routes/dashbordRoutes/dashbordRoutes.js";
import editorRoute from "./src/Routes/editorRoutes/editorRoutes.js";
import connectDB from './src/Config/db.connection.js';
import { runTeacherAgent } from "./src/Services/langchainAgent.service.js";
import { checkAiSocketRateLimit } from "./src/Middlewares/rateLimiter.middleware.js";

dotenv.config();

await connectDB(process.env.MONGO_URI);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: (origin, callback) => {
            // Allow requests with no origin (e.g. mobile apps, curl, same-origin)
            if (!origin) return callback(null, true);

            // Allow localhost, loopback, and local network IPs (e.g. 192.168.x.x, 10.x.x.x, 172.x.x.x)
            const localOrLanRegex = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|\[::1\])(:\d+)?$/;
            if (localOrLanRegex.test(origin)) {
                return callback(null, true);
            }

            // Allow origins specified in environment variables
            const envOrigins = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || "")
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean);
            if (envOrigins.length > 0 && (envOrigins.includes(origin) || envOrigins.includes("*"))) {
                return callback(null, true);
            }

            // In production Linux server deployments, permit HTTP/HTTPS origins serving this app
            try {
                const parsed = new URL(origin);
                if (parsed.protocol === "http:" || parsed.protocol === "https:") {
                    return callback(null, true);
                }
            } catch (_) {}

            return callback(new Error("CORS not allowed"));
        },
        credentials: true
    },
    transports: ["websocket", "polling"], // Allow polling fallback if WebSockets are blocked by proxies
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
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
            const socketUserIdentifier = socket.user?.userId || socket.handshake.address;
            const rateLimitCheck = checkAiSocketRateLimit(socketUserIdentifier);
            if (!rateLimitCheck.allowed) {
                socket.emit('ai_error', {
                    message: `Rate limit exceeded. Please wait ${rateLimitCheck.retryAfterSeconds}s before sending another prompt.`
                });
                return;
            }

            const { prompt, model, fileSystem, activeFileId, code, language } = data;

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
