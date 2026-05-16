# Deployment Optimizations

Plan for reducing cold-start latency and improving simulation performance on GCP, while keeping strict scale-to-zero economics. Delivered by migrating prod from `gcloud run deploy`-in-Cloud-Build to **Terraform as the source of truth**, then applying the perf changes through the module.

**Target profile:** US West Coast solo user, occasional sessions, `min_instances=0` everywhere.

---

## Current state (verified)

- Prod is deployed by `cloudbuild.yaml` calling `gcloud run deploy` directly with inline flags. The Terraform module in `terraform/` is written but **not applied** — no remote state, `terraform.tfvars` is gitignored, no resources are managed by TF today.
- Rust service: `--cpu 2 --memory 1Gi --min-instances 0 --max-instances 10 --timeout 120 --ingress internal`, concurrency default (80).
- Next.js service: deployed via `gcloud run deploy` with no resource flags (uses whatever the live service has). 6 secrets mounted at startup as env vars.
- Cloud Run module has `startup_cpu_boost = false` and probes hitting `/`.
- Region: `us-central1` everywhere.

---

## Summary of changes

| # | Change | Where | Expected impact |
|---|--------|-------|-----------------|
| 0 | **Adopt Terraform as source of truth** | New GCS state bucket, import existing prod resources, switch Cloud Build to `terraform apply` | Enables everything below as code review + `terraform plan` instead of YAML edits |
| 1 | Move to `us-west1` | TF vars + Artifact Registry | -40–60ms RTT per request, faster image pulls |
| 2 | `startup_cpu_boost = true` (both services) | `terraform/modules/cloud-run/main.tf` | ~40–60% faster cold start; billed only during boot |
| 3 | Rust: `container_concurrency = 1` | Cloud Run module (parameterized) | No CPU contention; full Rayon parallelism per request |
| 4 | Rust: bump to 4 vCPU / 2Gi | `environments/prod/terraform.tfvars` | ~2× faster sims at same vCPU-second cost |
| 5 | Slim Rust runtime image | `rust-simulation-service/Dockerfile` | Smaller image → faster pull → faster cold start |
| 6 | Lazy secret fetching in Next.js | Application code + module `secret_env_vars` | Drop 4 of 6 secrets from cold path |
| 7 | Real `/healthz` endpoints | Both services + probe paths in module | Reliable startup/liveness probes |

Expected end state:
- **Cold start:** ~3–6s today → ~1.5–2.5s
- **Warm latency:** dominated by sim compute; ~half of today with 4 vCPU
- **Cost:** still well under $5/mo for personal use (+$0 for Terraform state)

---

## Phase 0 — Terraform migration (prerequisite for everything else)

**Goal:** make `terraform/` the actual source of truth for prod, with no resource drift.

**Prod project (verified):** `gen-lang-client-0372385774` (display name "Retire"), region `us-central1`. All resources below use this project ID — the `retire-plan-prod` placeholder in `.example` tfvars is **not** the real project.

### 0.1 Remote state bucket

```bash
PROJECT=gen-lang-client-0372385774
BUCKET=retire-plan-tfstate-$PROJECT
gsutil mb -p $PROJECT -l us-central1 gs://$BUCKET
gsutil versioning set on gs://$BUCKET
gsutil ubla set on gs://$BUCKET   # uniform bucket-level access
```

Uncomment the `backend "gcs"` block in `terraform/main.tf`:

```hcl
backend "gcs" {
  bucket = "retire-plan-tfstate-gen-lang-client-0372385774"
  prefix = "terraform/state/prod"
}
```

Run `terraform init -migrate-state` (no state to migrate yet; this just wires up the backend).

### 0.2 Real `terraform.tfvars`

Copy `terraform/environments/prod/terraform.tfvars.example` → `terraform/environments/prod/terraform.tfvars` (stays gitignored). Fill in:
- `project_id`, image URIs
- `secret_env_vars` — **only `DATABASE_URL` and `FIREBASE_PRIVATE_KEY`** after Phase 6; for the initial import keep all 6 to match current prod
- `public_env_vars` — copy from `gcloud run services describe retire-plan --format=...`

Stash a copy of the filled tfvars in 1Password (or commit an encrypted version with `sops` later).

### 0.3 Import existing prod resources

For each resource currently in prod, `terraform import` it so TF adopts rather than recreates. Approximate list:

```bash
cd terraform
terraform init

# Cloud Run services
terraform import 'module.rust_simulation.google_cloud_run_v2_service.main' \
  projects/gen-lang-client-0372385774/locations/us-central1/services/rust-simulation-service
terraform import 'module.cloud_run.google_cloud_run_v2_service.main' \
  projects/gen-lang-client-0372385774/locations/us-central1/services/retire-plan

# Service accounts
terraform import 'module.rust_simulation.google_service_account.cloud_run' \
  projects/gen-lang-client-0372385774/serviceAccounts/rust-simulation-service-sa@gen-lang-client-0372385774.iam.gserviceaccount.com
terraform import 'module.cloud_run.google_service_account.cloud_run' \
  projects/gen-lang-client-0372385774/serviceAccounts/retire-plan-sa@gen-lang-client-0372385774.iam.gserviceaccount.com

# Artifact Registry
terraform import 'module.artifact_registry.google_artifact_registry_repository.main' \
  projects/gen-lang-client-0372385774/locations/us-central1/repositories/retire-plan

# Secrets (one per secret; values are not in state, only the resource shell)
for s in DATABASE_URL FIREBASE_PRIVATE_KEY GEMINI_API_KEY POLYGON_API_KEY LANGFUSE_PUBLIC_KEY LANGFUSE_SECRET_KEY; do
  terraform import "module.secrets.google_secret_manager_secret.secret[\"$s\"]" \
    projects/gen-lang-client-0372385774/secrets/$s
done

# Public-access IAM bindings (if applicable)
terraform import 'module.cloud_run.google_cloud_run_v2_service_iam_member.public_access[0]' \
  "projects/gen-lang-client-0372385774/locations/us-central1/services/retire-plan roles/run.invoker allUsers"
```

Exact addresses depend on module internals — adjust as needed when running.

### 0.4 Plan-clean dance

Run `terraform plan`. It **will** show a diff vs. live prod. Reconcile by editing `terraform.tfvars` (and the module if necessary) until `plan` reports `No changes`. Common reconciliations:
- Image tag (`:latest` vs current `:$COMMIT_SHA`) — set `cloud_run_image` to the current SHA
- Env vars Cloud Build set that the module doesn't know about
- Probe paths (`/` today) — keep module default at `/` for the import, switch to `/healthz` in Phase 7
- `startup_cpu_boost` — leave `false` for the import, flip in Phase 2

**Do not `apply` until plan is empty.** First non-trivial `apply` happens in Phase 2.

### 0.5 Cloud Build SA permissions

The Cloud Build service account needs to run `terraform apply`. Grant:
- `roles/run.admin`
- `roles/iam.serviceAccountUser`
- `roles/secretmanager.admin`
- `roles/artifactregistry.admin`
- `roles/storage.objectAdmin` on `gs://retire-plan-tfstate-gen-lang-client-0372385774`

### 0.6 Switch `cloudbuild.yaml` to TF

Replace the two `gcloud run deploy` steps with:

1. Build + push images (Kaniko steps stay as-is)
2. `terraform -chdir=terraform init`
3. `terraform -chdir=terraform apply -auto-approve -var-file=environments/prod/terraform.tfvars -var="cloud_run_image=...:${COMMIT_SHA}" -var="rust_service_image=...:${COMMIT_SHA}"`
4. Health check step stays

Keep the first few applies **manual** (run locally, not from Cloud Build) until you trust the plan. Switch CI to auto-apply only after a few clean rounds.

### 0.7 Optional: PR plan workflow

GitHub Actions workflow that runs `terraform plan` on PRs touching `terraform/**` and comments the plan output. Nice-to-have, not blocking.

---

## Phase 1 — apply improvements through Terraform

With state imported and `plan` clean, each improvement below is now a small TF edit + `terraform apply`.

### #2 — `startup_cpu_boost = true`

`terraform/modules/cloud-run/main.tf`, line ~51:

```hcl
startup_cpu_boost = true
```

(Or parameterize with a variable defaulting to `true`.)

### #3 — Rust `container_concurrency = 1`

Add a `container_concurrency` variable to the module (default 80) and wire it into the `template` block:

```hcl
template {
  max_instance_request_concurrency = var.container_concurrency
  ...
}
```

Set `container_concurrency = 1` for the `module "rust_simulation"` call in `main.tf`; leave Next.js at the default 80.

### #4 — Rust 4 vCPU / 2Gi

In `terraform/environments/prod/terraform.tfvars`:

```hcl
rust_cpu_limit    = "4"
rust_memory_limit = "2Gi"   # required floor at 4 vCPU
```

**Cost-neutral:** Cloud Run bills per vCPU-second during request handling. Rayon scales near-linearly, so doubling cores roughly halves wall-clock time — same total vCPU-seconds billed. With `cpu_idle=true` you pay nothing between requests.

### #5 — Slim Rust runtime image

`rust-simulation-service/Dockerfile`:

```dockerfile
FROM gcr.io/distroless/cc-debian12
WORKDIR /app
COPY --from=builder /app/target/release/simulation-server /app/simulation-server
ENV PORT=8081
EXPOSE 8081
CMD ["/app/simulation-server"]
```

Drop the `apt-get`/`ca-certificates` step. Verify locally with `docker run` that the binary starts and responds.

### #6 — Lazy secret fetching in Next.js

Today's mounts (web service):

- `DATABASE_URL` — keep eager ✓
- `FIREBASE_PRIVATE_KEY` — keep eager ✓
- `GEMINI_API_KEY` — only OCR endpoint → defer
- `POLYGON_API_KEY` — only market-data endpoint → defer
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` — observability → defer

Implementation:
1. Add `@google-cloud/secret-manager` to `apps/web`
2. Create `apps/web/src/lib/secrets.ts` with a `getSecret(name)` that caches in module scope
3. Update handlers (`api/ocr/*`, `api/market-data/*`, langfuse init) to call `await getSecret(...)` instead of reading `process.env.X`
4. Remove the four secrets from `secret_env_vars` in `terraform.tfvars`
5. Grant the web SA `roles/secretmanager.secretAccessor` (already granted by module)
6. `terraform apply`

### #7 — Real `/healthz` endpoints

**Rust** (`rust-simulation-service/src/main.rs`): add a `/healthz` route alongside the existing `/health`:

```rust
let healthz = warp::path("healthz")
    .and(warp::get())
    .map(|| warp::reply::with_status("ok", warp::http::StatusCode::OK));
```

**Next.js**: add `apps/web/src/app/healthz/route.ts`:

```ts
export const dynamic = 'force-dynamic';
export function GET() {
  return new Response('ok', { status: 200 });
}
```

**Module**: parameterize probe path (default `/healthz`); set both services to `/healthz`. Rust startup probe can stay TCP.

---

## Phase 2 — region migration (`us-central1` → `us-west1`)

Deferred. Recreate, not in-place — new Artifact Registry repo in `us-west1`, republish images, fresh Cloud Run services there. Plan to deploy fresh in `us-west1`, verify, then decommission `us-central1`. Easier once Terraform is the source of truth: clone the prod tfvars to a `us-west1.tfvars`, `terraform apply` with a different state prefix, cut traffic, destroy old.

---

## Cost expectations after changes

For "a few sessions a day" usage:

| Item | Monthly |
|------|---------|
| Cloud Run request-seconds | < $1 |
| Artifact Registry storage | ~$0.50 |
| Secret Manager | negligible |
| Cloud Build | only on push (~$0.003/build-minute) |
| GCS Terraform state | < $0.01 |
| **Total (excluding Neon)** | **< $5** |

`min_instances=1` was ruled out — would add ~$10–15/mo to keep one Rust instance warm, not worth it for this usage pattern.

---

## Rollout order

1. **Phase 0** — Terraform migration. State bucket → tfvars → import → plan-clean. Manual `apply` only after `plan` is empty.
2. **(low-risk)** #2, #3, #7 via TF — config-only module changes
3. **(low-risk)** #4 via TF — vCPU/memory bump
4. **(medium)** #5 — Dockerfile change; verify locally first, image rebuilds on next push
5. **(medium)** #6 — Next.js code change + secret-mount removal in tfvars
6. **(higher-risk)** Switch Cloud Build to `terraform apply` for ongoing deploys
7. **(later)** Phase 2 region migration

Measure cold-start before/after each step via Cloud Run "Time to first byte" or `curl -w "%{time_total}"` after the service idles 15+ minutes.
