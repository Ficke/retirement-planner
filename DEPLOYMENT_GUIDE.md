# Google Cloud Deployment Guide

## Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and configured
- Domain name (optional, for custom domain)

## Option 1: Google Cloud Run (Recommended)

**Best for:** Serverless, auto-scaling, pay-per-use

### Step 1: Set up Cloud SQL (PostgreSQL)

```bash
# Set project
gcloud config set project YOUR_PROJECT_ID

# Create Cloud SQL instance
gcloud sql instances create retire-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-type=SSD \
  --storage-size=10GB

# Create database
gcloud sql databases create retire_prod \
  --instance=retire-db

# Create user
gcloud sql users create retire_user \
  --instance=retire-db \
  --password=SECURE_PASSWORD_HERE

# Get connection name
gcloud sql instances describe retire-db --format='value(connectionName)'
# Output: project-id:region:instance-name
```

### Step 2: Run Database Migrations

```bash
# Connect to Cloud SQL locally (one-time setup)
gcloud sql connect retire-db --user=retire_user --database=retire_prod

# Run migrations
cd apps/web
DATABASE_URL="postgresql://retire_user:PASSWORD@HOST/retire_prod" pnpm exec node -e "
const {getUnifiedDatabaseService} = require('./src/services/server/database.ts');
const db = getUnifiedDatabaseService();
db.initialize().then(() => console.log('Migrations complete'));
"
```

### Step 3: Build and Deploy

```bash
# Build Docker image
docker build -t gcr.io/YOUR_PROJECT_ID/retire-app .

# Push to Google Container Registry
docker push gcr.io/YOUR_PROJECT_ID/retire-app

# Deploy to Cloud Run
gcloud run deploy retire-app \
  --image gcr.io/YOUR_PROJECT_ID/retire-app \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances YOUR_PROJECT_ID:us-central1:retire-db \
  --set-env-vars "NEXTAUTH_URL=https://retire-app-xxx.run.app" \
  --set-secrets "DATABASE_URL=retire-db-url:latest,NEXTAUTH_SECRET=nextauth-secret:latest,GEMINI_API_KEY=gemini-key:latest"
```

### Step 4: Set up Secrets

```bash
# Create secrets in Secret Manager
echo -n "postgresql://retire_user:PASSWORD@/retire_prod?host=/cloudsql/PROJECT:REGION:INSTANCE" | \
  gcloud secrets create retire-db-url --data-file=-

echo -n "$(openssl rand -base64 32)" | \
  gcloud secrets create nextauth-secret --data-file=-

echo -n "YOUR_GEMINI_API_KEY" | \
  gcloud secrets create gemini-key --data-file=-

# Grant Cloud Run access to secrets
gcloud secrets add-iam-policy-binding retire-db-url \
  --member="serviceAccount:YOUR-PROJECT@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Step 5: Configure Domain (Optional)

```bash
# Map custom domain
gcloud run services add-iam-policy-binding retire-app \
  --region=us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"

gcloud run domain-mappings create \
  --service retire-app \
  --domain retire.yourdomain.com \
  --region us-central1
```

---

## Option 2: Google App Engine

**Best for:** Fully managed, integrated services

### Step 1: Create `app.yaml`

Create `apps/web/app.yaml`:
```yaml
runtime: nodejs20
env: standard
instance_class: F1

automatic_scaling:
  max_instances: 10
  min_instances: 0

env_variables:
  NODE_ENV: "production"
  NEXTAUTH_URL: "https://YOUR-PROJECT-ID.appspot.com"

# Use Secret Manager for sensitive vars
```

### Step 2: Deploy

```bash
cd apps/web
gcloud app deploy
```

---

## Option 3: Docker Compose (Self-hosted)

Create `docker-compose.prod.yml`:
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: retire_prod
      POSTGRES_USER: retire_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://retire_user:${DB_PASSWORD}@postgres:5432/retire_prod
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      NEXTAUTH_URL: ${NEXTAUTH_URL}
      GEMINI_API_KEY: ${GEMINI_API_KEY}
    depends_on:
      - postgres

volumes:
  postgres_data:
```

Deploy:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## Dockerfile

Create `Dockerfile` in project root:
```dockerfile
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED 1

RUN cd apps/web && pnpm build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "apps/web/server.js"]
```

---

## Post-Deployment Checklist

- [ ] Database migrations completed
- [ ] Environment variables set
- [ ] Authentication tested (sign up, sign in, sign out)
- [ ] Multi-user data isolation verified
- [ ] Rate limiting tested
- [ ] Error tracking configured
- [ ] SSL certificate verified
- [ ] Custom domain mapped (if applicable)
- [ ] Monitoring/alerts configured
- [ ] Backup strategy implemented

---

## Monitoring & Maintenance

### Cloud Monitoring

```bash
# View logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=retire-app" --limit 50

# Set up alerts
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="High Error Rate" \
  --condition-threshold-value=10 \
  --condition-threshold-duration=60s
```

### Database Backups

```bash
# Automated backups (enabled by default)
gcloud sql backups list --instance=retire-db

# Manual backup
gcloud sql backups create --instance=retire-db
```

### Scaling

```bash
# Update Cloud Run to handle more traffic
gcloud run services update retire-app \
  --max-instances=20 \
  --concurrency=100
```

---

## Troubleshooting

### Connection Issues

```bash
# Test database connectivity
gcloud sql connect retire-db --user=retire_user

# Check Cloud Run logs
gcloud run services logs read retire-app --limit=100
```

### Migration Issues

If migrations fail:
1. Connect to database manually
2. Check `schema_version` table
3. Run SQL migrations individually from `src/services/server/database.ts`

### Environment Variable Issues

```bash
# Verify environment variables
gcloud run services describe retire-app --format='value(spec.template.spec.containers[0].env)'
```

---

## Cost Optimization

- **Cloud Run:** Free tier includes 2 million requests/month
- **Cloud SQL:** Use `db-f1-micro` for development, `db-g1-small` for production
- **Storage:** Enable automated backups, retain for 7 days
- **Monitoring:** Use free tier (50 GB logs/month)

**Estimated Monthly Cost:** $10-30 for small-scale production deployment
