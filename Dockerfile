# Build stage (installs dependencies)
FROM node:20-alpine AS builder

WORKDIR /app

# Ensure Alpine uses a fresh package cache before installation
RUN apk update && apk add --no-cache \
    poppler-utils \
    build-base \
    pkgconfig

# Copy package files and install only production dependencies
COPY package*.json ./

RUN mkdir -p test/data && \
    touch test/data/05-versions-space.pdf

RUN npm ci --only=production

# Copy application source code
COPY . .

# Final stage (runtime)
FROM node:20-alpine

WORKDIR /app

# Ensure Alpine uses a fresh package cache and install required packages
RUN apk update && apk add --no-cache poppler-utils

# Copy only necessary files from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/test ./test

# Create temp directory with proper permissions
RUN mkdir -p /app/temp && \
    chown -R node:node /app && \
    chmod -R 755 /app

# Switch to non-root user
USER node

# Set environment variables
ENV NODE_ENV=production \
    PORT=5000

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "src/index.js"]
