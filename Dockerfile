# Multi-stage build para optimización

# Stage 1: Base
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client \
    tzdata
ENV TZ=America/Bogota

# Stage 2: Dependencies
FROM base AS dependencies
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Stage 3: Development dependencies
FROM base AS dev-dependencies
COPY package*.json ./
RUN npm ci

# Stage 4: Development
FROM base AS development
COPY --from=dev-dependencies /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Stage 5: Builder
FROM base AS builder
COPY --from=dev-dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build || echo "No build script found"

# Stage 6: Production
FROM base AS production
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src ./src
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
