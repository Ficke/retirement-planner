# Development Setup

## Quick Start

1. **Clone and authenticate**:
   ```bash
   git clone <repo>
   gcloud auth login
   ```

2. **Pull secrets and start**:
   ```bash
   ./scripts/pull-secrets.sh
   pnpm install
   pnpm dev
   ```

## How It Works

- **Public config**: Committed in the script (safe to share)
- **Secrets**: Pulled fresh from GCP Secret Manager
- **Local override**: Edit `.env.local` to override any values during development

## Test Status

✅ **Core tests** (103 pass): Logic, calculations, projections  
⚠️ **Integration tests** (3 fail): Firebase auth, external APIs

The integration test failures don't block development or deployment since they require additional Firebase setup for the test environment.

## Deployment Pipeline

✅ **GitHub Actions**: Tests PRs before merge  
✅ **Cloud Build**: Deploys to Cloud Run on merge to main  
✅ **Cloud Run**: Live at https://retire-plan-789638662967.us-central1.run.app

## Commands

```bash
# Development
pnpm dev              # Start dev server
pnpm test             # Run tests  
pnpm typecheck        # Type checking
pnpm build            # Production build

# Secrets
./scripts/pull-secrets.sh    # Refresh local secrets from GCP
```