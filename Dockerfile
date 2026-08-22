# Multi-stage build for the Vite client and Hono server

# Stage 1: Dependencies and Builder
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat

# Install pnpm
RUN npm install -g pnpm@10

WORKDIR /app

# Copy package files first (better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/

# Install dependencies (Kaniko will cache this layer)
RUN pnpm install --frozen-lockfile

# Copy source code after installing deps
COPY . .

# Set environment for build
ENV NODE_ENV=production
# Firebase public config — baked into the client bundle by Vite.
# Values are supplied as --build-arg from the Cloud Build trigger substitutions.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MEASUREMENT_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID

# Build the application
WORKDIR /app/apps/web
RUN pnpm build

# Stage 2: Runner
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 web

# The server bundle includes its runtime dependencies, so the final image only
# needs the Node runtime, the bundled server, and the hashed Vite assets.
COPY --from=builder --chown=web:nodejs /app/apps/web/dist ./dist
COPY --from=builder --chown=web:nodejs /app/apps/web/dist-server ./dist-server

USER web

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist-server/index.cjs"]
