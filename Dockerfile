FROM node:24.14.1-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/filesystem/package.json ./packages/filesystem/
RUN npm ci

COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN mkdir -p /app/data

EXPOSE 3001 5173
