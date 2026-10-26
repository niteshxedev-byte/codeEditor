# =========================================================================
# Stage 1: Dependency Installation
# =========================================================================
FROM node:22-alpine AS deps

WORKDIR /app

# Install libc compatibility for Alpine if needed
RUN apk add --no-cache libc6-compat

# Copy package manifests
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts

# =========================================================================
# Stage 2: Production Runtime
# =========================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Install tini init process and libc compatibility
RUN apk add --no-cache tini libc6-compat

# Configure production environment defaults
ENV NODE_ENV=production
ENV PORT=3001

# Copy cached node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source code with non-root ownership
COPY --chown=node:node . .

# Ensure runtime writable directories exist and are owned by the node user
# - /app/storage     : per-user isolated code workspaces and PDF/file uploads
# - /app/src/public/uploads : legacy uploads path (kept for backward compatibility)
RUN mkdir -p /app/storage /app/src/public/uploads \
    && chown -R node:node /app/storage /app/src/public/uploads

# Switch to non-root user for security
USER node

# Expose service port
EXPOSE 3001

# Healthcheck using native Node.js fetch (no external binary required)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/aboutCodeEditor').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Use tini to properly handle PID 1 signal forwarding (SIGTERM, SIGINT)
ENTRYPOINT ["/sbin/tini", "--"]

# Start Express server
CMD ["node", "index.js"]
