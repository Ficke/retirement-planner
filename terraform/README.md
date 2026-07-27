# Terraform Infrastructure for RetirePlan

This directory contains Terraform configuration for deploying RetirePlan to Google Cloud Platform (GCP).

## 📁 Project Structure

```
terraform/
├── main.tf                          # Main Terraform configuration
├── variables.tf                     # Variable definitions
├── outputs.tf                       # Output definitions
├── terraform.tfvars.example         # Example variables file
└── modules/
    ├── artifact-registry/           # Docker image repository
    ├── cloud-run/                   # Cloud Run service (used twice: web + Rust)
    └── secrets/                     # Secret Manager configuration
```

There is a single root module. Prod is configured by `terraform.tfvars`
(gitignored) alongside `main.tf` — not by a per-environment directory. To add a
second environment, run the same root with a different `-var-file` and a
different `backend` state prefix.

## 🚀 Quick Start

### Prerequisites

1. **Install Terraform** (v1.5+)
   ```bash
   # macOS
   brew install terraform

   # Or download from https://www.terraform.io/downloads
   ```

2. **Install gcloud CLI**
   ```bash
   # macOS
   brew install --cask google-cloud-sdk

   # Login
   gcloud auth login
   gcloud auth application-default login
   ```

3. **Create GCP Project**
   ```bash
   # Create project
   gcloud projects create retire-plan-prod --name="RetirePlan Production"

   # Set as active
   gcloud config set project retire-plan-prod

   # Enable billing (required)
   # Visit: https://console.cloud.google.com/billing
   ```

### Step 1: Configure Variables

```bash
# Copy example file
cp terraform.tfvars.example terraform.tfvars

# Edit with your values
nano terraform.tfvars
```

**Required variables:**
- `project_id` - Your GCP project ID
- `cloud_run_image` - Docker image URL (update after first build)
- `public_env_vars` - Firebase and other public environment variables

### Step 2: Initialize Terraform

```bash
cd terraform

# Initialize Terraform (download providers)
terraform init

# Validate configuration
terraform validate

# Preview changes
terraform plan
```

### Step 3: Create Infrastructure

```bash
# Apply configuration
terraform apply

# Type 'yes' when prompted
```

This creates:
- ✅ Artifact Registry repository for Docker images
- ✅ Secret Manager secrets (placeholders)
- ✅ Cloud Run service (waiting for first deployment)
- ✅ IAM roles and service accounts

### Step 4: Set Secret Values

Terraform creates the secrets but doesn't store the actual values. Set them manually:

```bash
# Set DATABASE_URL (from Neon)
echo -n "postgresql://user:pass@host-pooler.neon.tech/db?sslmode=require" | \
  gcloud secrets versions add DATABASE_URL --data-file=-

# Set FIREBASE_PRIVATE_KEY
cat firebase-private-key.txt | \
  gcloud secrets versions add FIREBASE_PRIVATE_KEY --data-file=-

# Set GEMINI_API_KEY (optional)
echo -n "your-gemini-api-key" | \
  gcloud secrets versions add GEMINI_API_KEY --data-file=-

# Set POLYGON_API_KEY (optional)
echo -n "your-polygon-api-key" | \
  gcloud secrets versions add POLYGON_API_KEY --data-file=-

# Set Langfuse keys (optional)
echo -n "pk-lf-..." | \
  gcloud secrets versions add LANGFUSE_PUBLIC_KEY --data-file=-
echo -n "sk-lf-..." | \
  gcloud secrets versions add LANGFUSE_SECRET_KEY --data-file=-
```

### Step 5: Build and Push Docker Image

```bash
# Authenticate Docker with Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev

# Get repository URL from Terraform output
terraform output artifact_registry_repository
# Example: us-central1-docker.pkg.dev/retire-plan-prod/retire-plan

# Build and tag image
docker build -t us-central1-docker.pkg.dev/retire-plan-prod/retire-plan/retire-plan:latest ..

# Push to Artifact Registry
docker push us-central1-docker.pkg.dev/retire-plan-prod/retire-plan/retire-plan:latest

# Or use Cloud Build (faster for large images)
cd ..
gcloud builds submit --tag us-central1-docker.pkg.dev/retire-plan-prod/retire-plan/retire-plan:latest
```

### Step 6: Update terraform.tfvars with Image URL

```bash
# Edit terraform.tfvars
nano terraform.tfvars

# Update cloud_run_image to your pushed image
# cloud_run_image = "us-central1-docker.pkg.dev/retire-plan-prod/retire-plan/retire-plan:latest"
```

### Step 7: Deploy Application

```bash
# Apply with new image
terraform apply

# Terraform will update Cloud Run with the new image
```

### Step 8: Verify Deployment

```bash
# Get service URL
terraform output cloud_run_url

# Test the deployment
curl $(terraform output -raw cloud_run_url)

# View logs
gcloud run services logs read retire-plan --region us-central1
```

## 🔄 Updating the Application

### Update Code and Redeploy

```bash
# 1. Build new image with updated code
docker build -t us-central1-docker.pkg.dev/retire-plan-prod/retire-plan/retire-plan:v1.1.0 .
docker push us-central1-docker.pkg.dev/retire-plan-prod/retire-plan/retire-plan:v1.1.0

# 2. Update terraform.tfvars
# cloud_run_image = "....:v1.1.0"

# 3. Apply changes
terraform apply
```

### Update Environment Variables

```bash
# 1. Update public_env_vars in terraform.tfvars
# 2. Apply changes
terraform apply

# For secrets, update via gcloud
echo -n "new-secret-value" | gcloud secrets versions add SECRET_NAME --data-file=-
```

## 🏗️ Infrastructure Modules

### Artifact Registry Module

**Purpose:** Stores Docker images

**Resources:**
- `google_artifact_registry_repository.docker` - Docker repository
- IAM bindings for Cloud Build

**Outputs:**
- `repository_url` - URL for docker push/pull

### Secret Manager Module

**Purpose:** Stores sensitive configuration

**Resources:**
- `google_secret_manager_secret.secrets` - Secret placeholders

**Important:** Secret values are NOT stored in Terraform state for security

### Cloud Run Module

**Purpose:** Runs the Next.js application

**Resources:**
- `google_cloud_run_v2_service.main` - Cloud Run service
- `google_service_account.cloud_run` - Service account
- IAM bindings for secrets access

**Configuration:**
- Memory: 512Mi (configurable)
- CPU: 1 vCPU (configurable)
- Scaling: 0-10 instances (configurable)
- Timeout: 300s

## 🌍 Environments

Prod runs from this directory with `terraform.tfvars`:

```bash
cp terraform.tfvars.example terraform.tfvars
# Fill in project_id, image URIs, public_env_vars, build_substitutions

terraform init
terraform plan     # always read the plan before applying
terraform apply
```

For an additional environment, keep the same root module and vary the inputs:

```bash
terraform init -backend-config="prefix=terraform/state/dev" -reconfigure
terraform apply -var-file=dev.tfvars
```

## 🔐 State Management

State lives in GCS, already configured in `main.tf`:

```hcl
backend "gcs" {
  bucket = "retire-plan-tfstate-gen-lang-client-0372385774"
  prefix = "terraform/state/prod"
}
```

The bucket has versioning and uniform bucket-level access enabled. `terraform
init` wires this up automatically — there is no local state file to protect.

**⚠️** Never commit `terraform.tfvars` or plan files. Both are gitignored; a
plan file embeds state and can carry resource attribute values.

Uncomment the backend block in `main.tf`:

```hcl
backend "gcs" {
  bucket = "retire-plan-terraform-state"
  prefix = "terraform/state"
}
```

Then migrate:

```bash
terraform init -migrate-state
```

## 📊 Terraform Commands Cheat Sheet

```bash
# Initialize
terraform init

# Validate configuration
terraform validate

# Format code
terraform fmt -recursive

# Plan changes
terraform plan

# Apply changes
terraform apply

# Apply without confirmation
terraform apply -auto-approve

# Destroy infrastructure
terraform destroy

# Show current state
terraform show

# List resources
terraform state list

# View outputs
terraform output

# Refresh state
terraform refresh

# Import existing resource
terraform import google_cloud_run_v2_service.main projects/PROJECT/locations/REGION/services/SERVICE
```

## 🔧 Troubleshooting

### "Error 403: Permission denied"

**Fix:** Enable required APIs

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

### "Image not found" when deploying

**Fix:** Build and push image first

```bash
# Check terraform outputs for repository URL
terraform output artifact_registry_repository

# Build and push
docker build -t <repository-url>/retire-plan:latest .
docker push <repository-url>/retire-plan:latest
```

### "Secret not found" errors

**Fix:** Set secret values

```bash
# List secrets
gcloud secrets list

# Add secret version
echo -n "value" | gcloud secrets versions add SECRET_NAME --data-file=-
```

### Cloud Run service not starting

**Fix:** Check logs

```bash
# View logs
gcloud run services logs read retire-plan --region us-central1

# Common issues:
# - Missing DATABASE_URL secret
# - Invalid Firebase credentials
# - Port not set to 3000
```

## 💰 Cost Optimization

### Development

```hcl
min_instances = 0      # Scale to zero when idle
max_instances = 3      # Limit concurrent instances
memory_limit  = "512Mi" # Minimal memory
```

### Production

```hcl
min_instances = 1       # Keep 1 warm for performance
max_instances = 20      # Handle traffic spikes
memory_limit  = "1Gi"   # More memory for better performance
```

## 🔒 Security Best Practices

1. ✅ **Never commit `terraform.tfvars`** - Contains sensitive data
2. ✅ **Use Secret Manager** - Don't put secrets in Terraform
3. ✅ **Remote state with encryption** - Use GCS backend
4. ✅ **Least privilege IAM** - Modules use minimal permissions
5. ✅ **Review Terraform plans** - Always check before apply

## 📚 Additional Resources

- [Terraform GCP Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Secret Manager Best Practices](https://cloud.google.com/secret-manager/docs/best-practices)
- [Artifact Registry Guide](https://cloud.google.com/artifact-registry/docs)

## 🆘 Support

For issues:
1. Check Terraform output for errors
2. Review GCP logs in Cloud Console
3. Verify secret values are set correctly
4. Ensure billing is enabled on GCP project
