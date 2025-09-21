# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Set environment variables
ENV NODE_ENV=production

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application source code
COPY . .

# Expose the port (Cloud Run expects 8080)
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]
