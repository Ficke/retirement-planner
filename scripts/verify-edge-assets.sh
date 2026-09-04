#!/bin/sh
# Verify a deployed edge build. Usage: scripts/verify-edge-assets.sh <base-url> [client-dir]
#
# Every file in the local client build must come back from the deployment with
# its own content type. Checking the build output rather than parsing the shell
# reaches assets the HTML never names, the Wasm module included.
#
# It deliberately needs no credentials. The end-to-end simulation path needs
# them, and is covered by scripts/smoke-check-edge.sh.
#
# Assets propagate asynchronously after wrangler returns, so a miss is retried
# for a bounded window before it counts. Without that, running straight after a
# deploy reports a failure that fixes itself seconds later.
#
# An asset miss is a 404: the Worker answers an unlisted /assets/ path itself
# rather than letting the SPA fallback return the shell at 200
# (docs/architecture/asset-routing-plan.md). While the fallback still covered
# asset paths, an unpropagated asset and an absent one were the same 200, this
# window never engaged, and deploy-2026-09-04.1 failed on a healthy build.
#
# A colo that has not picked up the new version yet is still answering from the
# old one, so during a deploy a miss can be either shape -- a 404 from a version
# that has the fix, or the shell from one that does not. Both mean "not this
# build yet", so both are waited out. Only the state after the window closes is
# a verdict.
set -eu

ATTEMPTS="${VERIFY_ATTEMPTS:-8}"
RETRY_DELAY="${VERIFY_RETRY_DELAY:-5}"

BASE_URL="${1:?usage: verify-edge-assets.sh <base-url> [client-dir]}"
CLIENT_DIR="${2:-apps/web/dist/client}"
BASE_URL="${BASE_URL%/}"

[ -d "$CLIENT_DIR/assets" ] || { echo "No build output at $CLIENT_DIR/assets"; exit 1; }

# Two verdicts, because they call for different responses. `fail` means the
# check could not reach a conclusion about this build -- no local build output,
# the site unreachable, the new version never observed rolling out. `broken`
# means the deployment is serving this build and this build is wrong. Only the
# second justifies reverting: the deploy workflow rolls back on exit 2 alone,
# and a rollback on "could not verify" is what reverted two healthy deploys.
fail() { echo "FAIL: $*"; exit 1; }
broken() { echo "BROKEN: $*"; exit 2; }

# One request, kept whole. Every assertion about an asset reads from the same
# response: asking again is a second request, and during a rollout the two can
# land on different Worker versions and disagree.
fetch() { curl -sS -I --max-time 30 "$1" | tr -d '\r' || true; }

# $1 response, $2 header name. Prints the last value, lowercased.
value_of() {
  printf '%s\n' "$1" \
    | awk -v want="$(echo "$2" | tr '[:upper:]' '[:lower:]')" \
        'tolower($1) == want ":" { $1 = ""; sub(/^ /, ""); v = $0 } END { print tolower(v) }'
}

status_of() {
  code=$(printf '%s\n' "$1" | awk '/^HTTP\// { c = $2 } END { print c }')
  [ -n "$code" ] || code=000
  echo "$code"
}

header() { value_of "$(fetch "$1")" "$2"; }

status() { status_of "$(fetch "$1")"; }

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

# The same, for an asset, where a 200 carrying the shell is also a miss. Prints
# the whole response that settled it, so the content type and caching asserted
# below are the ones this reply actually carried.
settled_asset() {
  attempt=1
  while :; do
    response=$(fetch "$1")
    if [ "$(status_of "$response")" = "200" ]; then
      case "$(value_of "$response" content-type)" in
        text/html*) ;;
        *) printf '%s\n' "$response"; return ;;
      esac
    fi
    [ "$attempt" -ge "$ATTEMPTS" ] && { printf '%s\n' "$response"; return; }
    attempt=$((attempt + 1))
    sleep "$RETRY_DELAY"
  done
}

echo "Verifying $BASE_URL against $CLIENT_DIR"

shell_status=$(settled_status "$BASE_URL/")
[ "$shell_status" = "200" ] || fail "shell returned HTTP $shell_status"

# Wait until this colo is serving this build before asserting anything about it.
# A rollout is asynchronous: until the new version arrives, the shell and its
# assets still come from the old one, and every assertion below would be about a
# build that is not under test. That is what failed deploy-2026-09-04.1 and .2.
# The shell naming this build's entry chunk is the signal that it has arrived,
# and it is a positive signal rather than the absence of a negative one.
[ -f "$CLIENT_DIR/index.html" ] || fail "no $CLIENT_DIR/index.html to identify this build by"
entry=$(grep -oE '/assets/[A-Za-z0-9._-]+\.js' "$CLIENT_DIR/index.html" | head -1)
[ -n "$entry" ] || fail "no entry chunk named in $CLIENT_DIR/index.html"

attempt=1
while :; do
  case "$(curl -sS --max-time 30 "$BASE_URL/" || true)" in
    *"$entry"*) break ;;
  esac
  [ "$attempt" -ge "$ATTEMPTS" ] && fail "after $ATTEMPTS attempts $BASE_URL still does not serve this build (no $entry in the shell)"
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY"
done
echo "Deployment is serving this build ($entry)"

# Everything from here is an assertion about the build now known to be serving,
# so every failure below is a verdict on it.
shell_type=$(header "$BASE_URL/" content-type)
case "$shell_type" in
  text/html*) ;;
  *) broken "shell content-type is '$shell_type', expected text/html" ;;
esac

for required in x-content-type-options content-security-policy x-frame-options; do
  value=$(header "$BASE_URL/" "$required")
  [ -n "$value" ] || broken "shell is missing the $required header"
done

checked=0
for asset in "$CLIENT_DIR"/assets/*; do
  [ -f "$asset" ] || continue
  path="/assets/$(basename "$asset")"
  url="$BASE_URL$path"

  response=$(settled_asset "$url")
  asset_status=$(status_of "$response")
  # `fetch` swallows curl's own errors, which surface as status 000. That is a
  # network problem between the runner and the edge, not a verdict on the build.
  [ "$asset_status" = "000" ] && fail "$path could not be reached after $ATTEMPTS attempts"
  [ "$asset_status" = "200" ] || broken "$path returned HTTP $asset_status after $ATTEMPTS attempts"

  type=$(value_of "$response" content-type)
  case "$type" in
    text/html*) broken "$path still served the SPA shell after $ATTEMPTS attempts — asset paths are falling back to the shell instead of 404ing" ;;
  esac

  case "$path" in
    *.js)   case "$type" in *javascript*) ;; *) broken "$path content-type is '$type'" ;; esac ;;
    *.css)  case "$type" in *text/css*) ;;    *) broken "$path content-type is '$type'" ;; esac ;;
    *.wasm) case "$type" in *application/wasm*) ;; *) broken "$path content-type is '$type'" ;; esac ;;
  esac

  cache=$(value_of "$response" cache-control)
  case "$cache" in
    *immutable*) ;;
    *) broken "$path cache-control is '$cache', expected immutable" ;;
  esac

  checked=$((checked + 1))
done

[ "$checked" -gt 0 ] || fail "no assets found in $CLIENT_DIR/assets"
echo "Edge verification passed: shell plus $checked assets served with correct types and caching."
