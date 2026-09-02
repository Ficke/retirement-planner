# Deployment Guide

RetirePlan runs on Google Cloud Run as **two services**:

| Service | What it is | Reachability |
|---|---|---|
| `retire-plan` | Vite SPA + Hono API | Public (`allUsers` invoker), protected by the edge origin secret |
| `rust-simulation-service` | Monte Carlo engine (Warp + Rayon) | Private — invokable only by the web service account |

The web service proxies `/api/simulation/*` to the Rust service using a Cloud
Run ID token (`lib/rust-service-client.ts`). The local Wasm adapter runs the
same Rust engine for on-device computation.

**Terraform is the source of truth for infrastructure.** Cloud Build owns image
rollout and candidate promotion. See `terraform/README.md` for the ownership
boundary and production workflow.

---

## Prerequisites

1. **gcloud CLI** — [install](https://cloud.google.com/sdk/docs/install), then `gcloud auth login`
2. **Terraform** ≥ 1.5
3. **Neon PostgreSQL** database — connection string for `DATABASE_URL`
4. **Firebase project** — for authentication

Prod project: `gen-lang-client-0372385774`, region `us-central1`.

---

## Environment variables

Production uses the following runtime and build-time configuration.

### Runtime — web service

| Variable | Purpose | Source |
|---|---|---|
| `DATABASE_URL` | Neon connection string | Secret Manager |
| `FIREBASE_PROJECT_ID` | Firebase token issuer/audience | `public_env_vars` |
| `ORIGIN_SECRET` | Authenticates requests from Cloudflare | Secret Manager |
| `SIGNUP_INVITE_CODES` | Comma-separated signup gate | Secret Manager |
| `RUST_SERVICE_URL` | Rust service base URL | Set by Terraform from the module output |
| `NODE_ENV` | `production` | Set by Terraform |

The three Secret Manager entries are fetched at container start. Keeping the
mounted set focused limits cold-start work and access permissions.

### Build-time — baked into the client bundle

`VITE_FIREBASE_*` must exist when `vite build` runs, not just at
container start. They travel as Kaniko `--build-arg` values from Cloud Build
substitutions (`build_substitutions` in tfvars → `cloudbuild.yaml` → `Dockerfile`).

Firebase client config is intentionally public; it is not a secret. Security
comes from Firebase Auth rules and authorized domains.

### Runtime — Rust service

| Variable | Purpose | Source |
|---|---|---|
| `PORT` | HTTP listener, default `8081` | Cloud Run |
| `SIMULATION_THREADS` | Rayon worker count, set to `8` | Terraform |

The Rust identity carries the compute service's Cloud Run permissions.

---

## First-time setup

### 1. Create the secrets

Terraform creates the secret containers. Secret values enter Secret Manager
through an out-of-band operator workflow:

```bash
echo -n "postgresql://…@…neon.tech/…?sslmode=require" | \
  gcloud secrets versions add DATABASE_URL --data-file=-

openssl rand -base64 48 | tr -d '\n' | \
  gcloud secrets versions add ORIGIN_SECRET --data-file=-

echo -n "comma-separated-invite-codes" | \
  gcloud secrets versions add SIGNUP_INVITE_CODES --data-file=-
```

Create the containers with Terraform before adding their first versions.

### 2. Review production inputs

`terraform/production.tfvars` versions the production project, service shape,
public Firebase client configuration, and Secret Manager references. Secret
values remain in Secret Manager.

### 3. Apply

```bash
terraform -chdir=terraform init
terraform -chdir=terraform plan -var-file=production.tfvars -out=production.tfplan
terraform -chdir=terraform show production.tfplan
terraform -chdir=terraform apply production.tfplan
```

This creates both Cloud Run services, both service accounts, the Artifact
Registry repo, the secrets, the `run.invoker` binding that lets the web service
call the Rust service, and the Cloud Build trigger.

### 4. Verify

```bash
export ORIGIN_SECRET="$(gcloud secrets versions access latest --secret ORIGIN_SECRET)"
./scripts/smoke-check.sh "$(gcloud run services describe retire-plan \
  --region us-central1 --format 'value(status.url)')"
```

During an origin-secret rotation, read the version referenced by
`terraform/production.tfvars` instead of `latest`.

This is the same check Cloud Build runs. It posts a real simulation, so a pass
means ingress, the Hono server, the API route, the web service's IAM token,
the hop to the Rust service, and the wire contract between the two adapters all
work. Failures are distinguishable: `400` wire-contract mismatch, `502` Rust
error, `503` cannot reach Rust, `504` timeout.

The simulation smoke check is the production readiness signal. Cloud Run uses
`/healthz` for container-level liveness, while the public check verifies the
complete authenticated request path and computation contract.

---

## Ongoing deploys

Production deploys are explicit. After the release commit is on `main`, create
and push an annotated tag named `deploy-YYYYMMDDTHHMMSSZ-<short-sha>`:

```bash
git switch main
git pull --ff-only
deploy_tag="deploy-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=8 HEAD)"
git tag -a "$deploy_tag" -m "Production deploy $deploy_tag"
git push origin "$deploy_tag"
```

The Terraform-managed trigger matches `deploy-*` and runs `cloudbuild.yaml`:

1. Build both images with Kaniko, in parallel, with layer caching
2. Deploy the Rust service with `--no-traffic`, tagged `candidate`
3. Promote Rust to 100%
4. Deploy the web service with `--no-traffic`, tagged `candidate`, with
   `RUST_SERVICE_URL` set on the same revision
5. `scripts/smoke-check.sh` against the **candidate tag URL** — a real
   simulation, end to end, with no user traffic on it
6. Promote the web service to 100%, only if step 5 passed

Traffic moves after the check, not before it. A web revision that cannot serve
is never reachable by users, and a failed build leaves the previous revision
serving. Rust is promoted before the web candidate is tested because only the
web service's SA holds `run.invoker` on it, so Cloud Build cannot call a Rust
revision directly; deploying it `--no-traffic` first still keeps a container
that will not start from ever taking traffic. A new Rust revision serving the
previous web bundle is the rolling-deploy case the schema shim exists for.

Steps 2 and 4 select the image and service identity. Terraform manages CPU,
memory, concurrency, scaling, and probes; its Cloud Run module preserves the
commit-addressed image selected by Cloud Build.

To change infrastructure — sizing, scaling, probes, env vars, secrets — edit
Terraform, review a saved plan, and apply it manually.

---

## Local verification

Run the two services the way production does:

```bash
docker compose up --build
# web    → http://localhost:3000
# rust   → http://localhost:8081/healthz
```

`docker-compose.yml` reads `DATABASE_URL` and the Firebase values from your
shell. Set `RUST_SERVICE_URL` to exercise the server path, or select local
calculation to exercise Web Workers.

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
| Cloud Build | ~$0.003/build-minute, only on a deploy tag |
| GCS Terraform state | < $0.01 |
| **Total (excluding Neon)** | **< $5** |

---

## Security posture

- Secret values live in Secret Manager.
- The Rust service accepts authenticated calls from the web service account.
- `/api/simulation/*` at the edge requires a verified Firebase identity that
  also has a row in the application `users` table, and meters both a request
  and a weighted path budget on that identity. The Cloud Run copy of those
  routes remains unauthenticated and per-IP limited; it is the rollback target
  and is reachable only with `ORIGIN_SECRET`. Both clamp path count, batch
  size, and horizon — see `lib/simulation-request.ts`
- The Worker reaches the private Rust service with an OIDC token it mints from
  the `edge-invoker` service-account key. Bootstrap and rotation are in
  `docs/architecture/edge-compute-plan.md`
- Security headers are set in `apps/web/src/server/app.ts`
- All SQL uses parameterized queries

See `SECURITY.md` for the audit history and open items.

---

## Remaining work

- **Distroless Rust runtime image** — smaller pull, faster cold start.
- **Region migration** `us-central1` → `us-west1`.

The distroless image still needs local startup and TLS verification. A region
change requires new Artifact Registry and Cloud Run resources, traffic
verification, and explicit retirement of the `us-central1` resources.
