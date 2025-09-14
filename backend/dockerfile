FROM node:20-alpine

WORKDIR /usr/src/app

# Copy all files (ensures package.json is included)
COPY . .

# Install only production dependencies (without lockfile requirement)
RUN npm install --omit=dev

EXPOSE 8081
ENV NODE_ENV=production

CMD ["node", "server.js"]
