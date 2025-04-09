
FROM node:20-alpine AS builder

WORKDIR /app


RUN apk update && apk add --no-cache \
    poppler-utils \
    build-base \
    pkgconfig


COPY package*.json ./

RUN mkdir -p test/data && \
    touch test/data/05-versions-space.pdf

RUN npm ci --only=production


COPY . .


FROM node:20-alpine

WORKDIR /app


RUN apk update && apk add --no-cache poppler-utils


COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/test ./test


RUN mkdir -p /app/temp && \
    chown -R node:node /app && \
    chmod -R 755 /app


USER node


ENV NODE_ENV=production \
    PORT=5000


EXPOSE 5000


CMD ["node", "src/index.js"]
