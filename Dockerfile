# --- Stage 1: Build ---
FROM node:20-alpine AS builder
WORKDIR /app

# Copy config files
COPY package.json package-lock.json ./
# Copy workspace packages
COPY packages/core/package.json ./packages/core/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/web-server/package.json ./packages/web-server/
COPY packages/frontend/package.json ./packages/frontend/

# Install dependencies (including better-sqlite3 build tools)
RUN apk add --no-cache python3 make g++
RUN npm ci

# Copy source code
COPY . .

# Build everything (Core -> MCP -> Web -> Frontend)
RUN npm run build -w packages/core
RUN npm run build -w packages/mcp-server
RUN npm run build -w packages/web-server
RUN npm run build -w packages/frontend

# --- Stage 2: Runtime (The Product) ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV PROJECT_DIR=/data

# Install production dependencies only
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/web-server/package.json ./packages/web-server/
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
    npm rebuild better-sqlite3

# Copy built artifacts from builder
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=builder /app/packages/web-server/dist ./packages/web-server/dist
COPY --from=builder /app/packages/frontend/dist ./packages/frontend/dist

# Persist user data
VOLUME ["/data"]
EXPOSE 3000

# Start the Web Server (which now serves the Frontend too)
CMD ["node", "packages/web-server/dist/index.js"]
