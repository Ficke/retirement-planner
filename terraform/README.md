# Terraform operations

This root module manages RetirePlan's production infrastructure in Google
Cloud project `gen-lang-client-0372385774`, region `us-central1`.

Terraform owns service configuration, scaling, probes, identities, IAM,
secrets, Artifact Registry, and the Cloud Build trigger. Cloud Build owns
application images and revision promotion. This division keeps infrastructure
changes separate from application deployments.

## Managed resources

```text
terraform/
  main.tf                         Production resource graph
  variables.tf                    Input contracts and defaults
  production.tfvars              Versioned production inputs
  outputs.tf                      Operational outputs
  modules/artifact-registry/      Container repository and writer access
  modules/cloud-run/              Web and simulation services
  modules/secrets/                Secret Manager containers
```

The module manages two Cloud Run services:

| Service | Role | Access |
|---|---|---|
| `retire-plan` | Vite SPA and Hono API | Public through the authenticated edge proxy |
| `rust-simulation-service` | Rust Monte Carlo engine | Web service account |

The Rust service runs with 8 vCPU, 4 GiB of memory, concurrency 1, and
`SIMULATION_THREADS=8`.

## Production workflow

Requirements:

- Terraform 1.5 or newer
- Google Cloud application-default credentials
- Permission to read and update the production GCS state
- Permission to manage the resources declared by this module

Initialize the provider and the GCS backend:

```bash
terraform -chdir=terraform init
```

Format and validate the configuration:

```bash
terraform -chdir=terraform fmt -check -recursive
terraform -chdir=terraform validate
```

Create a saved production plan:

```bash
terraform -chdir=terraform plan \
  -var-file=production.tfvars \
  -out=production.tfplan

terraform -chdir=terraform show production.tfplan
```

Apply the reviewed plan:

```bash
terraform -chdir=terraform apply production.tfplan
```

Plan files embed state data and remain local. Remove them after the apply.

## State and provider versions

Production state lives in the versioned GCS backend declared in `main.tf`:

```hcl
backend "gcs" {
  bucket = "retire-plan-tfstate-gen-lang-client-0372385774"
  prefix = "terraform/state/prod"
}
```

The repository's `.terraform.lock.hcl` records the provider build used by CI
and production operators. Provider upgrades belong in dedicated pull requests
with a reviewed production plan.

`production.tfvars` contains public client configuration, resource settings,
and Secret Manager references. Secret values live in Google Cloud Secret
Manager.

## Secrets and rotation

The web service mounts three secrets as environment variables:

| Secret | Production version | Consumer |
|---|---:|---|
| `DATABASE_URL` | 1 | PostgreSQL client |
| `ORIGIN_SECRET` | 1 | Cloudflare/pipeline origin authentication |
| `SIGNUP_INVITE_CODES` | 1 | Signup gate |

Immutable version references give every instance in a Cloud Run revision the
same configuration. Rotate a secret by adding a version, updating
`production.tfvars`, reviewing the plan, applying it, and running the
production smoke check.

Terraform creates secret containers. Add values with the Google Cloud CLI:

```bash
gcloud secrets versions add DATABASE_URL --data-file=database-url.txt
gcloud secrets versions add ORIGIN_SECRET --data-file=origin-secret.txt
gcloud secrets versions add SIGNUP_INVITE_CODES --data-file=invite-codes.txt
```

The Cloud Run module grants each service account access to the secrets mounted
by that service. The compute-only Rust identity has an empty secret set.

## Application images

Cloud Build deploys commit-addressed images, tests candidate revisions, and
promotes verified revisions. The Cloud Run module ignores image and revision
metadata changed by that workflow while continuing to manage CPU, memory,
scaling, probes, identities, and environment variables.

Image variables remain in `production.tfvars` to bootstrap a new service. Once
the service exists, Cloud Build selects each deployed image.

## Verification

Inspect Cloud Run after an infrastructure apply:

```bash
gcloud run services describe retire-plan \
  --project gen-lang-client-0372385774 \
  --region us-central1

gcloud run services describe rust-simulation-service \
  --project gen-lang-client-0372385774 \
  --region us-central1
```

Run the end-to-end production simulation check from the repository root:

```bash
./scripts/smoke-check.sh \
  https://retire-plan-lvs5yigt4a-uc.a.run.app
```

The smoke check exercises the public web service, authenticated web-to-Rust
hop, and simulation response contract.

## Additional environments

An additional environment needs its own variable file and GCS state prefix.
Initialize that backend explicitly before planning:

```bash
terraform -chdir=terraform init \
  -backend-config="prefix=terraform/state/dev" \
  -reconfigure

terraform -chdir=terraform plan -var-file=dev.tfvars
```

Keep environment-specific secret versions and service identities in that
environment's variable file.
