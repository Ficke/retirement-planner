# GCP Deployment Guide

This guide walks you through deploying the RetirePlan application to Google Cloud Platform (GCP) using Cloud Run.

## Prerequisites

1. **Google Cloud Account** - [Sign up](https://cloud.google.com/)
2. **gcloud CLI** - [Install](https://cloud.google.com/sdk/docs/install)
3. **Docker** - [Install](https://docs.docker.com/get-docker/) (for local testing)
4. **Neon PostgreSQL** - Already configured (see NEON_MIGRATION.md)
5. **Firebase Project** - For authentication

## 🚀 Quick Start

### 1. Test Docker Build Locally

```bash
# Build the Docker image
docker build -t retire-plan .

# Test with docker-compose (uses .env.local variables)
docker-compose up

# Visit http://localhost:3000
```

### 2. GCP Project Setup

```bash
# Login to gcloud
gcloud auth login

# Create a new project (or use existing)
gcloud projects create retire-plan-prod --name="RetirePlan Production"

# Set as active project
gcloud config set project retire-plan-prod

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

### 3. Configure Secrets

Store sensitive environment variables in Google Secret Manager:

```bash
# Database connection string
echo -n "your-neon-connection-string" | \
  gcloud secrets create DATABASE_URL --data-file=-

# Firebase private key (from Firebase Console)
cat firebase-private-key.txt | \
  gcloud secrets create FIREBASE_PRIVATE_KEY --data-file=-

# Gemini API key (optional - for OCR)
echo -n "your-gemini-api-key" | \
  gcloud secrets create GEMINI_API_KEY --data-file=-

# Polygon API key (optional - for market data)
echo -n "your-polygon-api-key" | \
  gcloud secrets create POLYGON_API_KEY --data-file=-

# Langfuse keys (optional - for observability)
echo -n "pk-lf-..." | \
  gcloud secrets create LANGFUSE_PUBLIC_KEY --data-file=-

echo -n "sk-lf-..." | \
  gcloud secrets create LANGFUSE_SECRET_KEY --data-file=-
```

### 4. Grant Secret Access

```bash
# Get your Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe retire-plan-prod --format="value(projectNumber)")
SERVICE_ACCOUNT="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

# Grant access to secrets
gcloud secrets add-iam-policy-binding DATABASE_URL \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding FIREBASE_PRIVATE_KEY \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"

# Repeat for optional secrets
```

### 5. Deploy to Cloud Run

#### Option A: Using Cloud Build (Recommended)

```bash
# Submit build and deploy
gcloud builds submit --config cloudbuild.yaml

# View deployment status
gcloud run services list
```

#### Option B: Manual Deploy

```bash
# Build and push image
docker build -t gcr.io/retire-plan-prod/retire-plan .
docker push gcr.io/retire-plan-prod/retire-plan

# Deploy to Cloud Run
gcloud run deploy retire-plan \
  --image gcr.io/retire-plan-prod/retire-plan \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key,NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com,NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id,FIREBASE_PROJECT_ID=your-project-id,FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com \
  --set-secrets DATABASE_URL=DATABASE_URL:latest,FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10 \
  --timeout 300
```

### 6. Verify Deployment

```bash
# Get service URL
gcloud run services describe retire-plan \
  --platform managed \
  --region us-central1 \
  --format 'value(status.url)'

# Test the endpoint
curl https://retire-plan-xxxxx.run.app
```

## 📋 Environment Variables

### Required Variables

| Variable | Description | Where to Set |
|----------|-------------|--------------|
| `DATABASE_URL` | Neon PostgreSQL connection string | Secret Manager |
| `FIREBASE_PROJECT_ID` | Firebase project ID | Cloud Run env |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email | Cloud Run env |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key | Secret Manager |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web API key | Cloud Run env |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain | Cloud Run env |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID (public) | Cloud Run env |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API for OCR | None |
| `POLYGON_API_KEY` | Polygon.io for market data | None |
| `POLYGON_RATE_LIMIT_PER_MINUTE` | API rate limit | 5 |
| `LANGFUSE_PUBLIC_KEY` | Langfuse observability | None |
| `LANGFUSE_SECRET_KEY` | Langfuse secret | None |
| `LANGFUSE_HOST` | Langfuse host URL | None |

## 🔧 Troubleshooting

### Build Fails

```bash
# Check build logs
gcloud builds list
gcloud builds log [BUILD_ID]

# Common issues:
# - Missing dependencies: Check package.json
# - TypeScript errors: Run `pnpm typecheck` locally
# - Out of memory: Increase machineType in cloudbuild.yaml
```

### Deployment Fails

```bash
# Check Cloud Run logs
gcloud run services logs read retire-plan --region us-central1

# Common issues:
# - Missing secrets: Verify Secret Manager setup
# - Database connection: Check Neon URL and firewall rules
# - Port configuration: Ensure PORT=3000 is set
```

### Application Errors

```bash
# Stream logs in real-time
gcloud run services logs tail retire-plan --region us-central1

# Check environment variables
gcloud run services describe retire-plan --region us-central1
```

## 🔄 CI/CD Setup (Optional)

### Connect GitHub Repository

```bash
# Install Cloud Build GitHub app
# https://github.com/apps/google-cloud-build

# Create trigger for main branch
gcloud builds triggers create github \
  --repo-name=retire \
  --repo-owner=your-github-username \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml
```

## 💰 Cost Optimization

### Cloud Run Pricing

- **Free tier**: 2 million requests/month
- **Compute**: ~$0.00002400/vCPU-second, ~$0.00000250/GiB-second
- **Requests**: $0.40 per million requests

### Recommendations

1. **Start with min-instances=0** - Scale to zero when idle
2. **Use 512Mi memory** - Adequate for most loads
3. **Set max-instances=10** - Prevent runaway costs
4. **Monitor usage** - Set up billing alerts

### Neon Database (Already Configured)

- **Free tier**: 512MB storage, auto-suspend after 5min
- **Upgrade if needed**: $19/mo for 4GB storage
- Already using pooler endpoint for efficient connections

## 🔐 Security Best Practices

1. ✅ **Use Secret Manager** for sensitive data (DATABASE_URL, API keys)
2. ✅ **Never commit** `.env.local` or secrets to Git
3. ✅ **Least privilege** - Grant minimal IAM permissions
4. ✅ **HTTPS only** - Cloud Run enforces this by default
5. ✅ **Regular updates** - Keep dependencies patched

## 📊 Monitoring

### Set Up Monitoring

```bash
# View metrics
gcloud run services describe retire-plan --region us-central1

# Set up uptime checks
gcloud monitoring uptime-checks create https://retire-plan-xxxxx.run.app

# Set up log-based metrics
# Visit: https://console.cloud.google.com/logs
```

## 🎯 Next Steps

1. **Custom Domain** - Map your domain to Cloud Run
2. **CDN** - Set up Cloud CDN for static assets
3. **Monitoring** - Configure Cloud Monitoring & Alerting
4. **Backup** - Set up Neon database backups
5. **Performance** - Review and optimize bundle size

## 📚 Resources

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Neon PostgreSQL](https://neon.tech/docs)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
