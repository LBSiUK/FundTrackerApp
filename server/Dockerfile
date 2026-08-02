FROM node:22-alpine

WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# Snapshots live on a mounted volume, not in the image.
ENV FUNDTRACKER_DATA_DIR=/data
ENV NODE_ENV=production
ENV PORT=3100

RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 3100
CMD ["node", "server.js"]
