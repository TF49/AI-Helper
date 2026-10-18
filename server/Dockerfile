FROM node:20-alpine
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY website/ /app/website/
EXPOSE 3001
CMD ["node", "server.js"]
