#!/bin/sh
# Edge smoke check. Usage: scripts/smoke-check-edge.sh <site-url>
#
# Proves the one path nothing else covers: browser -> Worker -> minted OIDC
# token -> private Rust service -> wire contract, against the deployed Worker.
# The asset verification that runs beside it proves the shell and its assets
# resolve, which says nothing about whether the app can compute.
#
# Unlike the origin smoke check, this one authenticates. The public simulation
# routes require a verified Firebase identity that also has a row in the
# application users table, so this needs a dedicated smoke account. It stores no
# plan data: simulation inputs are transient.
#
# Required in the environment:
#   FIREBASE_API_KEY       the web API key, for the password sign-in endpoint;
#                          the VITE_FIREBASE_API_KEY repository variable, and
#                          public by design — it ships in the client bundle
#   SMOKE_USER_EMAIL       the smoke account, a repository secret
#   SMOKE_USER_PASSWORD    its password, a repository secret
#
# Neither the credentials nor the minted token are ever printed. Response bodies
# are, so nothing that carries a token is echoed.
#
# Each failure mode reports distinctly: 401 the token was refused, 403 the
# account is not registered here, 429 a quota, 502 Rust returned an error,
# 503 the Worker could not reach or authenticate to Rust, 504 timeout.
set -eu

SITE_URL="${1:?usage: smoke-check-edge.sh <site-url>}"
ATTEMPTS="${SMOKE_ATTEMPTS:-5}"
ENDPOINT="$SITE_URL/api/simulation/monte-carlo"

: "${FIREBASE_API_KEY:?FIREBASE_API_KEY is required}"
: "${SMOKE_USER_EMAIL:?SMOKE_USER_EMAIL is required}"
: "${SMOKE_USER_PASSWORD:?SMOKE_USER_PASSWORD is required}"

SMOKE_SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=scripts/smoke-payload.sh
. "$SMOKE_SCRIPT_DIR/smoke-payload.sh"

# Backslash first, then quote: reversing the two would escape the escapes. A
# credential containing a newline is not supported, which sed makes structural.
json_string() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/^/"/' -e 's/$/"/'
}

# The sign-in body arrives on stdin so the password never appears in argv.
SIGN_IN=$(
  printf '{"email":%s,"password":%s,"returnSecureToken":true}' \
    "$(json_string "$SMOKE_USER_EMAIL")" \
    "$(json_string "$SMOKE_USER_PASSWORD")" \
  | curl -s --max-time 30 -H 'content-type: application/json' --data @- \
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$FIREBASE_API_KEY"
)

ID_TOKEN=$(printf '%s' "$SIGN_IN" | sed -n 's/.*"idToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if [ -z "$ID_TOKEN" ]; then
  # The failure body carries no credential, but it can echo the email.
  echo "Could not sign the smoke account in; Firebase returned no ID token."
  printf '%s' "$SIGN_IN" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/  reason: \1/p'
  exit 1
fi

attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  BODY_FILE=$(mktemp)
  STATUS=$(curl -s -o "$BODY_FILE" -w '%{http_code}' \
    -X POST -H 'content-type: application/json' \
    -H "authorization: Bearer $ID_TOKEN" \
    --data "$PAYLOAD" --max-time 60 "$ENDPOINT" || echo 000)

  if [ "$STATUS" = "200" ]; then
    # Structural, not numeric: assert the engine answered with a result, and
    # leave the actual figures to the cross-target contract tests.
    if grep -q '"successProbability"' "$BODY_FILE" \
      && grep -q '"yearlyProjections"' "$BODY_FILE"; then
      echo "Edge smoke check passed: authenticated simulation served end to end."
      rm -f "$BODY_FILE"
      exit 0
    fi
    echo "200 but the body is not a SimulationResult:"
    head -c 400 "$BODY_FILE"; echo
    rm -f "$BODY_FILE"
    exit 1
  fi

  # A refused identity or a rejected payload will not fix itself; only a cold
  # isolate or a still-propagating deployment is worth waiting on.
  case "$STATUS" in
    401) echo "The Worker refused the smoke account's ID token (HTTP 401)."
         head -c 400 "$BODY_FILE"; echo; rm -f "$BODY_FILE"; exit 1 ;;
    403) echo "The smoke account has no row in the application users table (HTTP 403)."
         head -c 400 "$BODY_FILE"; echo; rm -f "$BODY_FILE"; exit 1 ;;
    400|413) echo "Wire contract rejected by the Worker (HTTP $STATUS):"
         head -c 400 "$BODY_FILE"; echo; rm -f "$BODY_FILE"; exit 1 ;;
    502) if grep -q 'newer than supported version' "$BODY_FILE"; then
           echo "The Rust service has not caught up to plan schema $PLAN_SCHEMA_VERSION yet."
           echo "  This Worker deploys from a tag push while Cloud Build builds the engine"
           echo "  from the same tag, and the Worker wins that race on a schema bump."
           echo "  Clients fall back to the local engine meanwhile. Re-run once Cloud Build"
           echo "  has promoted the new Rust revision; if it already has, this is real."
           head -c 400 "$BODY_FILE"; echo
         fi ;;
  esac

  echo "Attempt $attempt/$ATTEMPTS returned HTTP $STATUS; retrying in 5s"
  head -c 200 "$BODY_FILE"; echo
  rm -f "$BODY_FILE"
  attempt=$((attempt + 1))
  [ "$attempt" -le "$ATTEMPTS" ] && sleep 5
done

echo "Edge smoke check failed: no successful simulation after $ATTEMPTS attempts (last HTTP $STATUS)."
echo "  429 quota · 502 Rust returned an error · 503 Rust unreachable or unauthenticated · 504 timeout · 000 no response"
exit 1
