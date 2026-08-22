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

# Create .env.local with public config + the server secrets used locally.
cat > apps/web/.env.local << EOF
# Firebase Configuration (public)
VITE_FIREBASE_API_KEY=AIzaSyDhz2HOuS6HN_QE3SD0L9w7hGDDHMMyDrQ
VITE_FIREBASE_APP_ID=1:789638662967:web:07de8d66e7d782c488a8b2
VITE_FIREBASE_AUTH_DOMAIN=gen-lang-client-0372385774.firebaseapp.com
VITE_FIREBASE_MESSAGING_SENDER_ID=789638662967
VITE_FIREBASE_PROJECT_ID=gen-lang-client-0372385774
VITE_FIREBASE_STORAGE_BUCKET=gen-lang-client-0372385774.firebasestorage.app

# Server-side Firebase token verification
FIREBASE_PROJECT_ID=gen-lang-client-0372385774

# Secrets (auto-generated from GCP)
DATABASE_URL=$(gcloud secrets versions access latest --secret="DATABASE_URL")
SIGNUP_INVITE_CODES=$(gcloud secrets versions access latest --secret="SIGNUP_INVITE_CODES")
EOF

echo "✅ Secrets pulled to apps/web/.env.local"
echo ""
echo "🚀 Ready for development:"
echo "   pnpm dev"
