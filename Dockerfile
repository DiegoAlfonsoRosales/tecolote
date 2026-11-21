FROM node:22-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production PORT=8088 DATA_DIR=/data
EXPOSE 8088
HEALTHCHECK --interval=1m --timeout=5s CMD wget -qO- http://localhost:8088/health || exit 1
CMD ["node", "server.js"]
