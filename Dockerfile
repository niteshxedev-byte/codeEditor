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

# Install tini init process, libc compatibility, and local code execution runtimes
RUN apk add --no-cache tini libc6-compat \
    python3 \
    nodejs \
    openjdk17-jre \
    gcc \
    g++ \
    musl-dev \
    go \
    php83 \
    ruby \
    bash \
    sqlite \
    rust \
    cargo
# Note: Swift and Kotlin are not available in Alpine apk due to their large size.
# If a user submits Swift or Kotlin code, the executor returns a helpful error message.

# Configure production environment defaults
ENV NODE_ENV=production
ENV PORT=3001

# Copy cached node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source code with non-root ownership
COPY --chown=node:node . .

# Ensure runtime writable directory exists and is owned by the node user
# - /app/src/public/uploads : stores user project zips and PDF uploads (per-user subdirs)
RUN mkdir -p /app/src/public/uploads \
    && chown -R node:node /app/src/public/uploads

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
