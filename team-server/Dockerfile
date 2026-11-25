# Local Notes team server. Build from the repository root:
#   docker build -f team-server/Dockerfile -t local-notes-team .

# 1) bundle the web app
FROM node:24-alpine AS ui
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run build

# 2) the server
FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data PUBLIC_DIR=/app/public
WORKDIR /app/team-server
COPY team-server/package.json team-server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY team-server/src ./src
COPY server/ai.js /app/server/ai.js
COPY --from=ui /src/public /app/public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/team/info >/dev/null || exit 1
CMD ["node", "src/index.js"]
