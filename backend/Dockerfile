# Use official Node.js LTS image
FROM node:20-alpine AS base

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first for caching
COPY package*.json ./

# Install dependencies (only production dependencies)
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Expose the port (from .env or default 8081)
EXPOSE 8081

# Set NODE_ENV to production
ENV NODE_ENV=production

# Start the application
CMD ["node", "server.js"]
