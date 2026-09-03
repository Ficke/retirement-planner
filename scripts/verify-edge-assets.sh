#!/bin/sh
# Verify a deployed edge build. Usage: scripts/verify-edge-assets.sh <base-url> [client-dir]
#
# This covers the one Phase 1 failure mode that produces no error signal.
# not_found_handling: single-page-application answers a missing asset with the
# HTML shell at status 200, so a partial or mismatched upload looks healthy to
# any check that only asserts 2xx: the browser gets text/html where it expects a
# module, and the page goes blank with nothing in the logs.
#
# Every file in the local client build must therefore come back with its own
# content type, not the shell's. Checking the build output rather than parsing
# the shell also reaches assets the HTML never names, the Wasm module included.
#
# It deliberately needs no credentials. The end-to-end simulation path needs
# them, and is covered by scripts/smoke-check-edge.sh.
#
# Assets propagate asynchronously after wrangler returns, so a miss is retried
# for a bounded window before it counts. Without that, running straight after a
# deploy reports a failure that fixes itself seconds later.
set -eu

ATTEMPTS="${VERIFY_ATTEMPTS:-8}"
RETRY_DELAY="${VERIFY_RETRY_DELAY:-5}"

BASE_URL="${1:?usage: verify-edge-assets.sh <base-url> [client-dir]}"
CLIENT_DIR="${2:-apps/web/dist/client}"
BASE_URL="${BASE_URL%/}"

[ -d "$CLIENT_DIR/assets" ] || { echo "No build output at $CLIENT_DIR/assets"; exit 1; }

fail() { echo "FAIL: $*"; exit 1; }

header() {
  # $1 url, $2 header name. Prints the last value, lowercased.
  curl -sS -I --max-time 30 "$1" \
    | tr -d '\r' \
    | awk -v want="$(echo "$2" | tr '[:upper:]' '[:lower:]')" \
        'BEGIN { IGNORECASE = 1 } tolower($1) == want ":" { $1 = ""; sub(/^ /, ""); v = $0 } END { print tolower(v) }'
}

status() { curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$1" || echo 000; }

# Poll until the URL serves something other than a miss, or the window closes.
# Prints the final status.
settled_status() {
  attempt=1
  while :; do
    code=$(status "$1")
    case "$code" in
      200) echo "$code"; return ;;
    esac
    [ "$attempt" -ge "$ATTEMPTS" ] && { echo "$code"; return; }
    attempt=$((attempt + 1))
    sleep "$RETRY_DELAY"
  done
}

echo "Verifying $BASE_URL against $CLIENT_DIR"

shell_status=$(settled_status "$BASE_URL/")
[ "$shell_status" = "200" ] || fail "shell returned HTTP $shell_status"
shell_type=$(header "$BASE_URL/" content-type)
case "$shell_type" in
  text/html*) ;;
  *) fail "shell content-type is '$shell_type', expected text/html" ;;
esac

for required in x-content-type-options content-security-policy x-frame-options; do
  value=$(header "$BASE_URL/" "$required")
  [ -n "$value" ] || fail "shell is missing the $required header"
done

checked=0
for asset in "$CLIENT_DIR"/assets/*; do
  [ -f "$asset" ] || continue
  path="/assets/$(basename "$asset")"
  url="$BASE_URL$path"

  asset_status=$(settled_status "$url")
  [ "$asset_status" = "200" ] || fail "$path returned HTTP $asset_status after $ATTEMPTS attempts"

  type=$(header "$url" content-type)
  case "$type" in
    text/html*) fail "$path served the SPA shell — the deployed asset manifest does not match this build" ;;
  esac

  case "$path" in
    *.js)   case "$type" in *javascript*) ;; *) fail "$path content-type is '$type'" ;; esac ;;
    *.css)  case "$type" in *text/css*) ;;    *) fail "$path content-type is '$type'" ;; esac ;;
    *.wasm) case "$type" in *application/wasm*) ;; *) fail "$path content-type is '$type'" ;; esac ;;
  esac

  cache=$(header "$url" cache-control)
  case "$cache" in
    *immutable*) ;;
    *) fail "$path cache-control is '$cache', expected immutable" ;;
  esac

  checked=$((checked + 1))
done

[ "$checked" -gt 0 ] || fail "no assets found in $CLIENT_DIR/assets"
echo "Edge verification passed: shell plus $checked assets served with correct types and caching."
