import rateLimit from "express-rate-limit";

/**
 * Rate limiter for user authentication (Login).
 * Enforces a maximum of 10 login attempts per 15-minute window per IP.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  standardHeaders: "draft-7",
  legacyHeaders: false,
  statusCode: 429,
  handler: (req, res) => {
    const isJson = Boolean(req.xhr || req.headers.accept?.includes("application/json"));
    const message = "Too many login attempts from this IP. Please try again after 15 minutes.";

    if (isJson) {
      return res.status(429).json({ error: message });
    }

    return res.status(429).render("auth/loginCodeEditor", {
      error: message,
      success: undefined,
      formData: { email: typeof req.body?.email === "string" ? req.body.email : "" },
    });
  },
});

/**
 * Rate limiter for new account registration.
 * Enforces a maximum of 5 registration attempts per 1-hour window per IP.
 */
export const registerRateLimiter = rateLimit({
  windowMs: 120 * 60 * 1000, // 1 hour
  max: 5, // 5 attempts per window
  standardHeaders: "draft-7",
  legacyHeaders: false,
  statusCode: 429,
  handler: (req, res) => {
    const isJson = Boolean(req.xhr || req.headers.accept?.includes("application/json"));
    const message = "Too many account registrations from this IP. Please try again after an hour.";

    if (isJson) {
      return res.status(429).json({ error: message });
    }

    return res.status(429).render("auth/registerCodeEditor", {
      error: message,
      formData: {
        username: typeof req.body?.username === "string" ? req.body.username.trim() : "",
        email: typeof req.body?.email === "string" ? req.body.email.trim() : "",
      },
    });
  },
});

/**
 * Rate limiter for AI Assistant HTTP API (/ask-ai).
 * Enforces a maximum of 20 AI prompts per minute per authenticated user (or IP).
 */
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 20 requests per minute
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || req.ip || "anonymous",
  statusCode: 429,
  handler: (req, res) => {
    const message = "Too many AI assistant requests. Please wait a moment before sending another prompt.";
    return res.status(429).json({
      error: message,
      response: message,
      actions: [],
    });
  },
});

/**
 * Rate limiter for Code Execution (/runCode).
 * Enforces a maximum of 20 code executions per minute per authenticated user (or IP).
 */
export const codeExecutionRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 executions per minute
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || req.ip || "anonymous",
  statusCode: 429,
  handler: (req, res) => {
    return res.status(429).json({
      stdout: "",
      stderr: "Execution rate limit reached: Too many code execution requests. Please wait a moment.",
      compile_output: "",
      time: "0.00",
      memory: 0,
      status: "Rate Limited",
    });
  },
});

/**
 * In-memory sliding-window rate limiter for Socket.IO WebSocket AI events.
 * Prevents WebSocket clients from bypassing HTTP rate limits.
 */
const socketAiLimiterMap = new Map();

export function checkAiSocketRateLimit(identifier, limit = 20, windowMs = 60 * 1000) {
  if (!identifier) return { allowed: true };

  const now = Date.now();
  const timestamps = (socketAiLimiterMap.get(identifier) || []).filter(
    (ts) => now - ts < windowMs
  );

  if (timestamps.length >= limit) {
    const oldestTimestamp = timestamps[0];
    const retryAfterSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  timestamps.push(now);
  socketAiLimiterMap.set(identifier, timestamps);
  return { allowed: true };
}

// Garbage collection for stale socket limiter entries every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, timestamps] of socketAiLimiterMap.entries()) {
    const valid = timestamps.filter((ts) => now - ts < 60 * 1000);
    if (valid.length === 0) {
      socketAiLimiterMap.delete(id);
    } else {
      socketAiLimiterMap.set(id, valid);
    }
  }
}, 2 * 60 * 1000).unref();

export default {
  loginRateLimiter,
  registerRateLimiter,
  aiRateLimiter,
  codeExecutionRateLimiter,
  checkAiSocketRateLimit,
};

