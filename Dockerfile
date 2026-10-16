FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY . .

EXPOSE 8095

CMD ["node", "backend/server.js"]
