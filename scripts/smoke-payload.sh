# shellcheck shell=sh
# Shared smoke-check payload, sourced by both smoke checks.
#
# The plan schema version is read from the app's own constant rather than
# written here. Pinning it by hand was meant to go red when the wire contract
# moved, but it cannot: every version below the current one is accepted on
# purpose, so a rolling deploy can serve bundles built against the old one.
# A stale pin therefore keeps passing while testing a contract no client sends
# any more, which is how the origin check sat four bumps behind.
#
# Sets PAYLOAD and PLAN_SCHEMA_VERSION. Callers set SMOKE_SCRIPT_DIR first.

: "${SMOKE_SCRIPT_DIR:?SMOKE_SCRIPT_DIR must be set before sourcing}"

SMOKE_CONSTANTS="$SMOKE_SCRIPT_DIR/../apps/web/src/domain/constants.ts"
SMOKE_PLAN_FILE="$SMOKE_SCRIPT_DIR/smoke-plan.json"

PLAN_SCHEMA_VERSION="$(
  sed -n 's/^export const PLAN_SCHEMA_VERSION = \([0-9][0-9]*\);.*$/\1/p' \
    "$SMOKE_CONSTANTS" 2>/dev/null
)"
if [ -z "$PLAN_SCHEMA_VERSION" ]; then
  echo "Could not read PLAN_SCHEMA_VERSION from $SMOKE_CONSTANTS."
  echo "  The smoke payload is built from it, so there is nothing safe to send."
  exit 1
fi

PAYLOAD="$(
  tr -d '\n' < "$SMOKE_PLAN_FILE" \
    | sed "s/\"__PLAN_SCHEMA_VERSION__\"/$PLAN_SCHEMA_VERSION/"
)"
case "$PAYLOAD" in
  *__PLAN_SCHEMA_VERSION__*|'')
    echo "Could not build the smoke payload from $SMOKE_PLAN_FILE."
    exit 1
    ;;
esac
