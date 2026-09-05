#!/bin/sh
# Smoke check. Usage: scripts/smoke-check.sh <service-url>
#
# Two callers, two different guarantees. In the pipeline this runs against a
# candidate revision's tag URL before any traffic is promoted to it, so a
# revision that fails here is never reachable by users. In CI it runs against a
# local docker-compose stack. Pass a service's normal URL to check whatever is
# currently live.
#
# It exercises the one path that matters and that no probe can reach: a real
# simulation, end to end. Cloud Run's liveness probe only proves the container
# is up, which says nothing about whether the app can compute.
#
# A 200 always means the Hono server, the API route, the network hop to the
# Rust service, and the wire contract between the two adapters all work. Against
# a deployed revision it additionally covers ingress and the web service's Cloud
# Run IAM token; against compose it cannot, because that token is minted only
# for https targets and enforced by Cloud Run rather than by the Rust service
# itself. Each failure mode reports distinctly: 400 wire-contract mismatch,
# 502 Rust error, 503 unreachable, 504 timeout.
#
# It targets the deploy-only /api/internal/ path so this origin check remains
# separate from the public simulation API. The path is reachable only by going
# straight to the origin with ORIGIN_SECRET; the edge proxy refuses to forward
# it.
#
# Do not check '/'. It is a client-rendered shell that returns 200 whether or
# not the app can compute anything. Do not check '/healthz' through the public
# URL either: Google Front End reserves that exact path on *.run.app and
# answers it with its own 404 before the request reaches the container.
set -eu

SERVICE_URL="${1:?usage: smoke-check.sh <service-url>}"
ATTEMPTS="${SMOKE_ATTEMPTS:-5}"
ENDPOINT="$SERVICE_URL/api/internal/simulation-probe"

SMOKE_SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=scripts/smoke-payload.sh
. "$SMOKE_SCRIPT_DIR/smoke-payload.sh"

attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  BODY_FILE=$(mktemp)
  set -- -s -o "$BODY_FILE" -w '%{http_code}' \
    -X POST -H 'content-type: application/json' \
    --data "$PAYLOAD" --max-time 60
  if [ -n "${ORIGIN_SECRET:-}" ]; then
    set -- "$@" -H "x-retire-plan-origin-secret: $ORIGIN_SECRET"
  fi
  STATUS=$(curl "$@" "$ENDPOINT" || echo 000)

  if [ "$STATUS" = "200" ]; then
    # Structural, not numeric: assert the engine answered with a result, and
    # leave the actual figures to the cross-target contract tests.
    if grep -q '"successProbability"' "$BODY_FILE" \
      && grep -q '"yearlyProjections"' "$BODY_FILE"; then
      echo "Smoke check passed: simulation served end to end."
      rm -f "$BODY_FILE"
      exit 0
    fi
    echo "200 but the body is not a SimulationResult:"
    head -c 400 "$BODY_FILE"; echo
    rm -f "$BODY_FILE"
    exit 1
  fi

  # A rejected request or a broken dependency will not fix itself; only a cold
  # start or a still-rolling revision is worth waiting on.
  case "$STATUS" in
    401|403) echo "Origin rejected the probe (HTTP $STATUS) — check ORIGIN_SECRET:"
             head -c 400 "$BODY_FILE"; echo; rm -f "$BODY_FILE"; exit 1 ;;
    404)     echo "Probe endpoint not found (HTTP $STATUS) — is this URL behind the edge proxy?"
             head -c 400 "$BODY_FILE"; echo; rm -f "$BODY_FILE"; exit 1 ;;
    400|413) echo "Wire contract rejected by the app (HTTP $STATUS):"
             head -c 400 "$BODY_FILE"; echo; rm -f "$BODY_FILE"; exit 1 ;;
  esac

  echo "Attempt $attempt/$ATTEMPTS returned HTTP $STATUS; retrying in 5s"
  head -c 200 "$BODY_FILE"; echo
  rm -f "$BODY_FILE"
  attempt=$((attempt + 1))
  [ "$attempt" -le "$ATTEMPTS" ] && sleep 5
done

echo "Smoke check failed: no successful simulation after $ATTEMPTS attempts (last HTTP $STATUS)."
echo "  502 Rust returned an error · 503 cannot reach Rust · 504 timeout · 000 no response"
exit 1
