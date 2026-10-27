import rateLimit from "express-rate-limit";

// Auth rate limiter: 5 requests per minute per IP
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 1 minute before trying again." },
});

// Code execution rate limiter: 10 requests per minute per user / IP
export const executionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.userId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Execution rate limit exceeded. You can run code at most 10 times per minute." },
});

// AI chat rate limiter: 20 requests per minute per user / IP
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.userId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "AI rate limit exceeded. You can send at most 20 AI prompts per minute." },
});

export default {
  authLimiter,
  executionLimiter,
  aiLimiter,
};
