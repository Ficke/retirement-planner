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
| `/api/auth/sync-user` | Token required | Verifies the bearer token, and requires a valid invite code before creating a user row. See below |
| `/api/simulation/monte-carlo`, `/api/simulation/batch` | Firebase ID token | See below |
| `/api/internal/simulation-probe` | Origin secret only | Deploy-time proof the revision can compute. Unreachable publicly: the edge proxy refuses to forward `/api/internal/`, and the origin demands `ORIGIN_SECRET`. See below |
| `/healthz` | None | Returns the string `ok`, no I/O. Reachable from inside Cloud Run only — GFE intercepts the path externally |

The app is fully usable signed out. In LOCAL data mode nothing is written
server-side at all, so there is no data to protect for anonymous users.

### Invite-only signup

The Firebase web API key ships in the client bundle, so anyone holding it can
mint an account against Firebase directly — a check in the signup form would be
decoration. `/api/auth/sync-user` is the only writer of the `users` table, so
that is where signup is closed: creating a row requires a code from
`SIGNUP_INVITE_CODES` (comma-separated, compared timing-safely in
`lib/invite-code.ts`), while updating an existing row does not, leaving sign-in
untouched. No codes configured closes signup in every environment.

Attempts that need a code are rate-limited to 10/hour per IP, so a valid
Firebase token cannot be used to enumerate codes. When the server rejects an
account the signup form deletes the Firebase user, so a rejected signup leaves
no credential that can sign in to nothing.

### The simulation endpoints

`/api/simulation/*` fans every request out to CPU-bound work on the Rust
service, which makes it the main abuse surface. Signing in is the first gate:
anonymous sessions run the Web Worker engine instead, and the client decides
that up front rather than eating a 401. Mitigations in
`lib/simulation-request.ts`:

- Per-account rate limit: 60 requests / 60s
- `paths` ≤ 5,000 per simulation
- ≤ 40 scenarios per batch, ≤ 40,000 total paths per batch
- ≤ 20 accounts per plan
- Plan bounds (ages, rates, horizon) enforced by the shared domain schema

Nothing from these request bodies is persisted. Plans sent for cloud compute are
processed in memory and discarded.

Since accounts are invite-only (`lib/invite-code.ts`), the caller set is bounded
by codes you hand out rather than by who finds the URL.

### The deploy probe

The pipeline smoke-checks a candidate revision before promoting traffic to it,
and holds no user credentials, so it cannot use the routes above. It posts to
`/api/internal/simulation-probe`, which skips auth but validates and clamps the
payload exactly as the public routes do — it is not an unmetered engine.

Two independent controls keep it off the public internet, and it is only safe
while **both** hold:

1. The edge proxy answers `/api/internal/` with 404 and never forwards it, so
   nothing reaching the Worker can touch it.
2. Going straight at the Cloud Run URL requires `ORIGIN_SECRET`, which the
   middleware demands and only the Worker and the pipeline hold.

Removing either one exposes an unauthenticated path to the Rust service.

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
