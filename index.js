import express from 'express';
import dotenv from 'dotenv';
import path from "path";
import { fileURLToPath } from "url";
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';

import aboutProjectRoute from "./src/Routes/aboutProjectRoutes/aboutProjectRoute.js";
import loginRoute from "./src/Routes/authRoute/loginRoutes/loginRoute.js";
import registerRoute from "./src/Routes/authRoute/registerRoutes/registerRoutes.js";
import dashbordRoute from "./src/Routes/dashbordRoutes/dashbordRoutes.js";
import editorRoute from "./src/Routes/editorRoutes/editorRoutes.js";
import connectDB from './src/Config/db.connection.js';
import { runTeacherAgent } from "./src/Services/langchainAgent.service.js";

dotenv.config();

await connectDB(process.env.MONGO_URI);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: { 
        origin: (origin, callback) => {
            if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
                callback(null, true);
            } else {
                callback(new Error("CORS not allowed"));
            }
        },
        credentials: true 
    }
});

// Security headers
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    next();
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

    socket.on('disconnect', () => {});
});

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
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
