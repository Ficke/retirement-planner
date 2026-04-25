# Multi-stage build for Next.js production deployment

# Stage 1: Dependencies and Builder
FROM node:20-alpine AS builder
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
ENV NEXT_TELEMETRY_DISABLED=1

# Firebase public config — real values injected at runtime via Cloud Run env vars.
# These placeholders satisfy next build's static pre-rendering without real credentials.
ARG NEXT_PUBLIC_FIREBASE_API_KEY=placeholder-for-build
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=placeholder.firebaseapp.com
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID=placeholder-project
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=placeholder.appspot.com
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
ARG NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:placeholder
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID

# Build the application
WORKDIR /app/apps/web
RUN pnpm build

# Stage 3: Runner
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_ENV=production

# Start the application
CMD ["node", "apps/web/server.js"]
