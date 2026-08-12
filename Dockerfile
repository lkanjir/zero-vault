ARG NODE_VERSION=24.19.0

FROM node:${NODE_VERSION}-bookworm-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build -- --configuration production


FROM node:${NODE_VERSION}-bookworm-slim AS backend-build

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/ ./
RUN npm run build


FROM node:${NODE_VERSION}-bookworm-slim AS backend-dependencies

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=backend-dependencies --chown=node:node \
    /app/backend/node_modules ./backend/node_modules

COPY --from=backend-build --chown=node:node \
    /app/backend/dist ./backend/dist

COPY --from=frontend-build --chown=node:node \
    /app/frontend/dist ./frontend/dist

USER node

EXPOSE 3000

CMD ["node", "backend/dist/server.js"]