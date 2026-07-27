#!/bin/bash

# Pull secrets from GCP Secret Manager to .env.local
# Run this once after cloning the repo and authenticating with GCP

set -e

echo "🔐 Pulling secrets from GCP Secret Manager..."

# Check authentication
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Not authenticated. Run: gcloud auth login"
    exit 1
fi

# Create .env.local with public config + secrets
cat > apps/web/.env.local << EOF
# Firebase Configuration (public)
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyBkCJjpT2Kt3DlPlPQa745iwx1RCzAAHjU
NEXT_PUBLIC_FIREBASE_APP_ID=1:106859282187:web:9bd82c3f08f77725cfc376
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=retire-5250e.firebaseapp.com
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-QRVN9XBC4Z
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=106859282187
NEXT_PUBLIC_FIREBASE_PROJECT_ID=retire-5250e
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=retire-5250e.firebasestorage.app

# Server-side Firebase
FIREBASE_PROJECT_ID=retire-5250e
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@retire-5250e.iam.gserviceaccount.com

# Secrets (auto-generated from GCP)
DATABASE_URL=$(gcloud secrets versions access latest --secret="DATABASE_URL")
FIREBASE_PRIVATE_KEY="$(gcloud secrets versions access latest --secret="FIREBASE_PRIVATE_KEY" | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')"
EOF

echo "✅ Secrets pulled to apps/web/.env.local"
echo ""
echo "🚀 Ready for development:"
echo "   pnpm dev"