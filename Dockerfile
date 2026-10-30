FROM node:22-alpine
RUN apk add --no-cache ffmpeg unzip
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/.song-data && chown node:node /app/.song-data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "src/server.mjs"]
