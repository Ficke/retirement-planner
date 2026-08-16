# Deployment Guide

RetirePlan runs on Google Cloud Run as **two services**:

| Service | What it is | Reachability |
|---|---|---|
| `retire-plan` | Next.js app + API routes | Public (`allUsers` invoker) |
| `rust-simulation-service` | Monte Carlo engine (Warp + Rayon) | Private — invokable only by the web service account |

The web service proxies `/api/simulation/*` to the Rust service using a Cloud
Run ID token (`lib/rust-service-client.ts`). If the Rust service is unreachable,
the browser falls back to the client-side Web Worker, so a Rust outage degrades
performance rather than breaking the app.

**Terraform is the source of truth for infrastructure.** Cloud Build only builds
images and rolls them out — it does not define service shape. See
`terraform/README.md` for the module layout.

---

## Prerequisites

1. **gcloud CLI** — [install](https://cloud.google.com/sdk/docs/install), then `gcloud auth login`
2. **Terraform** ≥ 1.5
3. **Neon PostgreSQL** database — connection string for `DATABASE_URL`
4. **Firebase project** — for authentication

Prod project: `gen-lang-client-0372385774`, region `us-central1`.

---

## Environment variables

The app reads exactly these. Anything else you find referenced in older docs or
git history belongs to removed features.

### Runtime — web service

| Variable | Purpose | Source |
|---|---|---|
| `DATABASE_URL` | Neon connection string | Secret Manager |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin SDK key | Secret Manager |
| `FIREBASE_PROJECT_ID` | Firebase Admin SDK | `public_env_vars` |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin SDK | `public_env_vars` |
| `RUST_SERVICE_URL` | Rust service base URL | Set by Terraform from the module output |
| `NODE_ENV` | `production` | Set by Terraform |

Only the two Secret Manager entries are fetched at container start, so they are
the only ones on the cold-start path. Keep it that way — every secret added to
`secret_env_vars` costs cold-start latency.

### Build-time — baked into the client bundle

`NEXT_PUBLIC_FIREBASE_*` must exist when `next build` runs, not just at
container start. They travel as Kaniko `--build-arg` values from Cloud Build
substitutions (`build_substitutions` in tfvars → `cloudbuild.yaml` → `Dockerfile`).

Firebase client config is intentionally public; it is not a secret. Security
comes from Firebase Auth rules and authorized domains.

### Runtime — Rust service

`PORT` only, defaulted to 8081. It holds no credentials and touches no database.

---

## First-time setup

### 1. Create the secrets

Terraform creates the secret *containers*; values are never stored in Terraform
state and must be added out of band:

```bash
echo -n "postgresql://…@…neon.tech/…?sslmode=require" | \
  gcloud secrets versions add DATABASE_URL --data-file=-

cat firebase-private-key.txt | \
  gcloud secrets versions add FIREBASE_PRIVATE_KEY --data-file=-
```

If the secrets do not exist yet, run `terraform apply` first — or swap
`versions add` for `create`.

### 2. Fill in tfvars

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # gitignored
```

Set `project_id`, the two image URIs, `public_env_vars`, and
`build_substitutions`. Keep a copy in a password manager — it is not in git.

### 3. Apply

```bash
terraform init      # wires up the GCS backend
terraform plan      # read this before applying, every time
terraform apply
```

This creates both Cloud Run services, both service accounts, the Artifact
Registry repo, the secrets, the `run.invoker` binding that lets the web service
call the Rust service, and the Cloud Build trigger.

### 4. Verify

```bash
scripts/smoke-check.sh "$(gcloud run services describe retire-plan \
  --region us-central1 --format 'value(status.url)')"
```

This is the same check Cloud Build runs. It posts a real simulation, so a pass
means ingress, the Next.js server, the API route, the web service's IAM token,
the hop to the Rust service, and the wire contract between the two engines all
work. Failures are distinguishable: `400` wire-contract mismatch, `502` Rust
error, `503` cannot reach Rust, `504` timeout.

Two paths not to check. `/` is a client-rendered shell that returns 200 whether
or not the app can compute anything. `/healthz` cannot be probed through the
public URL at all — Google Front End reserves that exact path on `*.run.app`
and answers it with its own 404 before the request reaches the container. It
still works where Cloud Run uses it, since liveness probes hit the container
directly, and it works locally against the container port.

---

## Ongoing deploys

Push to `main`. The Cloud Build trigger runs `cloudbuild.yaml`:

1. Build both images with Kaniko, in parallel, with layer caching
2. Deploy the Rust service (image only)
3. Point the web service's `RUST_SERVICE_URL` at it
4. Deploy the web service (image only)
5. `scripts/smoke-check.sh` — runs a real simulation end to end

Steps 2 and 4 pass `--image` and identity flags but **no sizing flags**.
`gcloud run deploy` preserves settings it is not told about, which is what keeps
Cloud Build from reverting the CPU, memory, concurrency, and probe configuration
Terraform applied. Do not add `--cpu`/`--memory` back to `cloudbuild.yaml`; change
`terraform/variables.tf` and `terraform apply` instead.

To change infrastructure — sizing, scaling, probes, env vars, secrets — edit
Terraform and apply. Applies are currently run manually; see "Remaining work".

---

## Local verification

Run the two services the way production does:

```bash
docker compose up --build
# web    → http://localhost:3000
# rust   → http://localhost:8081/healthz
```

`docker-compose.yml` reads `DATABASE_URL` and the Firebase values from your
shell. Without `RUST_SERVICE_URL` the app still works — it just exercises the
Web Worker fallback instead of the server path.

For day-to-day development see `DEVELOPMENT.md`.

---

## Troubleshooting

**Build fails**

```bash
gcloud builds list --limit 5
gcloud builds log <BUILD_ID>
```

Typecheck and build errors reproduce locally with `pnpm typecheck && pnpm build`.
CI runs the same commands on every PR, so a red build here usually means the PR
gate was skipped.

**Revision will not start**

```bash
gcloud run services logs read retire-plan --region us-central1 --limit 100
```

Most common cause is a secret mounted in `secret_env_vars` that has no version
in Secret Manager — Cloud Run cannot start the container and the revision fails
health checks. Either add a version or remove the mount.

**Simulations are slow or falling back to the client**

The engine badge on the Plan page shows which engine served the result.
Falling back means the web service could not reach the Rust service. Check:

```bash
gcloud run services describe rust-simulation-service --region us-central1
gcloud run services get-iam-policy rust-simulation-service --region us-central1
```

The web service account needs `roles/run.invoker` on the Rust service —
Terraform manages this binding (`google_cloud_run_v2_service_iam_member.web_invokes_rust`).

**Database connection errors**

Neon suspends idle databases; the pool is configured with a 10s connection
timeout to absorb wakeup. Persistent failures usually mean a stale
`DATABASE_URL` — rotate the secret and redeploy.

---

## Cost

Both services scale to zero (`min_instances = 0`) with `cpu_idle = true`, so
there is no charge between sessions.

| Item | Monthly |
|---|---|
| Cloud Run request-seconds | < $1 |
| Artifact Registry storage | ~$0.50 |
| Secret Manager | negligible |
| Cloud Build | ~$0.003/build-minute, only on push |
| GCS Terraform state | < $0.01 |
| **Total (excluding Neon)** | **< $5** |

---

## Security posture

- Secrets live in Secret Manager, never in git or Terraform state
- The Rust service is not publicly invokable; only the web service account can call it
- `/api/simulation/*` is deliberately unauthenticated (anonymous users may opt
  into cloud compute) and therefore rate-limited per IP and clamped on path
  count, batch size, and horizon — see `lib/simulation-request.ts`
- Security headers are set in `apps/web/next.config.ts`
- All SQL uses parameterized queries

See `SECURITY.md` for the audit history and open items.

---

## Remaining work

- **Cloud Build still deploys with `gcloud run deploy`.** Switching it to
  `terraform apply` makes every deploy go through one path. It needs the Cloud
  Build service account granted `run.admin`, `iam.serviceAccountUser`,
  `secretmanager.admin`, `artifactregistry.admin`, and `storage.objectAdmin` on
  the state bucket first.
- **Distroless Rust runtime image** — smaller pull, faster cold start.
- **Region migration** `us-central1` → `us-west1`.

Tracked with rationale and rollout order in `DEPLOYMENT_OPTIMIZATIONS.md`.
