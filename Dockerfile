FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV KANBANEX_DB=/data/kanbanex.db
VOLUME /data
EXPOSE 3210
CMD ["node", "server.js"]
