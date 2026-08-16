#!/bin/sh
# Post-deploy smoke check. Usage: scripts/smoke-check.sh <service-url>
#
# Exercises the one path that matters and that no probe can reach: a real
# simulation, end to end. Cloud Run's liveness probe already proves the
# container is up, and `gcloud run deploy` only returns once the revision
# serves traffic — so re-checking either of those proves nothing new.
#
# A 200 here means ingress, the Next.js server, the API route, the web
# service's Cloud Run IAM token, the network hop to the Rust service, and the
# wire contract between the two engines all work. Each failure mode reports
# distinctly: 400 wire-contract mismatch, 502 Rust error, 503 unreachable,
# 504 timeout.
#
# Do not check '/'. It is a client-rendered shell that returns 200 whether or
# not the app can compute anything. Do not check '/healthz' through the public
# URL either: Google Front End reserves that exact path on *.run.app and
# answers it with its own 404 before the request reaches the container.
set -eu

SERVICE_URL="${1:?usage: smoke-check.sh <service-url>}"
ATTEMPTS="${SMOKE_ATTEMPTS:-5}"
ENDPOINT="$SERVICE_URL/api/simulation/monte-carlo"

# Pinned to the current plan schema on purpose: when the wire contract moves
# and this is not updated, the check goes red instead of shipping a web build
# the engine cannot read.
PAYLOAD='{"plan":{"schemaVersion":3,"profile":{"birthDate":"1991-01-01","state":"CA","filingStatus":"Single","retirementAge":65,"currentSalary":100000,"salaryGrowthRate":0.01,"currentSpending":50000,"workingSpendingGrowthRate":0,"retirementSpending":50000,"retirementSpendingGrowthRate":0,"lifeExpectancy":90,"asOfDate":"2026-01-01"},"accounts":[{"type":"Taxable","balance":100000,"assetWeights":{"stocks":0.6,"bonds":0.4}}],"socialSecurity":{"enabled":true,"claimAge":67,"manualOverride":false},"assumptions":{"simulationModel":"historical","taxableGainRatio":0.5,"hsaEligible":false,"useBackdoorRoth":false}},"config":{"paths":100,"seed":42}}'

attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  BODY_FILE=$(mktemp)
  STATUS=$(curl -s -o "$BODY_FILE" -w '%{http_code}' \
    -X POST -H 'content-type: application/json' \
    --data "$PAYLOAD" --max-time 60 "$ENDPOINT" || echo 000)

  if [ "$STATUS" = "200" ]; then
    # Structural, not numeric: assert the engine answered with a result, and
    # leave the actual figures to the cross-engine contract tests.
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
