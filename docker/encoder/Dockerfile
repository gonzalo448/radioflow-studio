FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY apps/encoder/package.json ./
COPY apps/encoder/src ./src
RUN npm install
ENV RADIOFLOW_API_URL=http://api:4000
ENV RADIOFLOW_MEDIA_ROOT=/media
ENV ENABLE_FFMPEG=1
ENV RADIOFLOW_USE_WS=1
CMD ["npx", "tsx", "src/index.ts"]
