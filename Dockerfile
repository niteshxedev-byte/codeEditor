# Multi-stage production Dockerfile
FROM node:22-alpine AS base

# Install system dependencies (e.g. libc compatibility if needed)
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3001

# Copy package descriptors first to maximize Docker layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application source code
COPY . .

# Ensure upload directory exists and has correct permissions for the unprivileged node user
RUN mkdir -p /app/src/public/uploads && chown -R node:node /app

# Switch to non-root user for security
USER node

# Expose server port
EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/aboutCodeEditor || exit 1

# Start the application
CMD ["node", "index.js"]

