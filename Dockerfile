FROM node:20-alpine

WORKDIR /usr/src/app

COPY . .

RUN npm ci --omit=dev

EXPOSE 8081
ENV NODE_ENV=production

CMD ["node", "server.js"]
