FROM node:20-alpine

WORKDIR /usr/src/app

# Copy all files (guarantees package.json is included)
COPY . .

# Install only production dependencies
RUN npm ci --omit=dev

EXPOSE 8081
ENV NODE_ENV=production

CMD ["node", "server.js"]
