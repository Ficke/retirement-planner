# Security

Current security posture, plus the audit history that produced it.

---

## Current posture

### Authentication and authorization

Firebase Auth, verified server-side via the Admin SDK (`lib/firebase/server-auth.ts`).

| Endpoint | Auth | Notes |
|---|---|---|
| `/api/accounts`, `/api/accounts/[id]` | Required | Every handler re-checks `account.user_id === user.id` before reading or writing — a valid token for user A cannot touch user B's account by ID |
| `/api/profile` | Required | Scoped to `user.id` |
| `/api/auth/sync-user` | Token required | Verifies the bearer token before creating the user row |
| `/api/simulation/monte-carlo`, `/api/simulation/batch` | **None, by design** | See below |
| `/healthz` | None | Returns the string `ok`, no I/O |

The app is fully usable signed out. In LOCAL data mode nothing is written
server-side at all, so there is no data to protect for anonymous users.

### The unauthenticated simulation endpoints

`/api/simulation/*` is deliberately public: anonymous users can opt into cloud
compute. That makes it the main abuse surface, since every request fans out to
CPU-bound work on the Rust service. Mitigations in `lib/simulation-request.ts`:

- Per-IP rate limit: 60 requests / 60s
- `paths` ≤ 5,000 per simulation
- ≤ 40 scenarios per batch, ≤ 40,000 total paths per batch
- ≤ 20 accounts per plan
- Plan bounds (ages, rates, horizon) enforced by the shared domain schema

Nothing from these request bodies is persisted. Plans sent for cloud compute are
processed in memory and discarded.

**Known limitation:** the rate limiter is in-process (`lib/rate-limit.ts`), so
each Cloud Run instance keeps its own counters. At `max_instances = 10` the
effective ceiling is up to 10× the nominal limit, and counters reset when
instances recycle. Adequate for the current threat model — the clamps above
bound the cost of any single request — but a shared store (Redis/Upstash) is the
upgrade if abuse ever materializes.

### Data handling

- All SQL uses parameterized queries; no string interpolation anywhere in `services/server/database.ts`
- Zod validates every request body before it reaches the database or the Rust service
- The Rust service holds no credentials, opens no database connection, and is not publicly invokable — only the web service account has `roles/run.invoker` on it

### Secrets

Managed in GCP Secret Manager, never in git and never in Terraform state
(Terraform creates the secret containers; values are added out of band).

Only two are mounted into Cloud Run: `DATABASE_URL` and `FIREBASE_PRIVATE_KEY`.
The `GEMINI_API_KEY` / `POLYGON_API_KEY` / `LANGFUSE_*` mounts were removed
along with the features that used them.

Firebase *client* config (`NEXT_PUBLIC_FIREBASE_*`) is intentionally public and
baked into the JS bundle. It is not a secret; security comes from Firebase Auth
rules and the authorized-domains list.

### Transport and headers

Cloud Run terminates TLS and never serves plain HTTP. Response headers are set
in `apps/web/next.config.ts`:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

---

## Open items

- **No Content-Security-Policy.** Next.js injects inline bootstrap scripts, so a
  useful policy needs nonce plumbing rather than a static header. Not started.
- **Rate limiting is per-instance** (see above).
- **No Firebase App Check**, no enforced email verification, no MFA.
- **No audit logging** of account create/delete or auth events.
- **No Cloud Armor / WAF** in front of Cloud Run.
- **Neon backups** are on the provider's default retention; no tested restore
  procedure.

None of these block the current deployment; they are the next tier of hardening
if the app takes on more users or more sensitive data.

---

## Audit history

### 2025-10-24 — pre-production review

Found and fixed a set of critical issues before the GCP migration.

**Deleted — unauthenticated endpoints exposing user data:**

- `/api/auth/debug` — dumped all user emails, Firebase UIDs, and DB records
- `/api/auth/migrate-users` — listed users without Firebase accounts
- `/api/database` — exposed connection strings and DB statistics
- `/api/auth/transfer-accounts` — let *anyone* move accounts between users
- `/api/auth/sync-firebase-users` — bulk user sync with no auth

**Hardened:**

- Added Firebase auth to the OCR endpoint and moved its rate limiting from
  IP-based to user-based
- Added client-side auth guards to the app and auth pages

**Confirmed sound:** parameterized SQL, per-user data filtering, server-side JWT
verification, `.env.local` correctly gitignored, Zod input validation.

### Since that audit

- The OCR feature was removed entirely, taking `/api/ocr`, the Gemini
  dependency, and the `ocr_feedback` table with it. The audit findings about
  that endpoint are historical only.
- Public simulation endpoints were added, with the gating described above.
- Security headers — an open item in the original audit — are now implemented.
- Legacy tables from retired architectures (holdings, transactions, sessions,
  verification tokens) are dropped by migration 11.

---

## Reporting

This is a personal project. Open an issue at
https://github.com/Ficke/retirement-planner/issues, or for anything sensitive,
contact the repository owner directly rather than filing publicly.
