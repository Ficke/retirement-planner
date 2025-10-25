# Production Environment Variables

## Required Environment Variables

These environment variables MUST be set in production:

### Database
```bash
DATABASE_URL=postgresql://user:password@host:5432/database_name
# Example for Google Cloud SQL:
# DATABASE_URL=postgresql://retire_user:PASSWORD@/retire_prod?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
```

### Authentication (NextAuth.js)
```bash
# Generate with: openssl rand -base64 32
NEXTAUTH_SECRET=your-secret-here-min-32-characters

# Production URL
NEXTAUTH_URL=https://your-domain.com
```

### AI Services
```bash
# Required for OCR functionality
GEMINI_API_KEY=your-gemini-api-key-here
```

## Optional Environment Variables

### Observability (Langfuse)
```bash
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

### Market Data (Optional - if using Polygon.io)
```bash
POLYGON_API_KEY=your-polygon-key-here
```

## Environment Variable Validation

The application will validate required environment variables at startup:
- `DATABASE_URL` - Required
- `NEXTAUTH_SECRET` - Required in production
- `NEXTAUTH_URL` - Required in production

Missing required variables will cause the application to fail startup.

## Security Notes

1. **Never commit `.env` files** - They are in `.gitignore`
2. **Use different secrets for each environment** (dev, staging, prod)
3. **Rotate `NEXTAUTH_SECRET` periodically**
4. **Use environment-specific database credentials**
5. **Restrict database access by IP** (Cloud SQL allows IP whitelisting)

## Setting Environment Variables

### Google Cloud Run
```bash
gcloud run services update retire-app \
  --set-env-vars="NEXTAUTH_SECRET=xxx,NEXTAUTH_URL=https://retire.example.com" \
  --set-secrets="DATABASE_URL=database-url:latest,GEMINI_API_KEY=gemini-key:latest"
```

### Google Cloud App Engine
Add to `app.yaml`:
```yaml
env_variables:
  NEXTAUTH_URL: "https://retire.example.com"
  NEXTAUTH_SECRET: "your-secret-here"

# Use Secret Manager for sensitive values
```

### Vercel
Set in Project Settings → Environment Variables

### Docker
Create `.env.production` file (DO NOT commit):
```bash
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=...
# ... other vars
```

## Next Steps

After setting environment variables:
1. Run database migrations
2. Test authentication flow
3. Verify database connectivity
4. Test OCR functionality (if using)
