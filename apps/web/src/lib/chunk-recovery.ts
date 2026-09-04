const RELOAD_MARKER = 'retire-plan:chunk-reload';

// A reload that fixes a retired chunk lands within seconds, so a second failure
// inside this window means the build itself is broken, not stale. Reloading
// again would spin.
const RELOAD_WINDOW_MS = 60_000;

/**
 * Recover a tab whose lazy chunks were retired by a deploy.
 *
 * Each deploy replaces the asset manifest, and Workers Assets scopes that
 * manifest to the Worker version, so chunks from the previous build stop
 * resolving the moment a new one goes live. A tab open across a deploy asks for
 * one on its next lazy route and the import rejects. Retrying the same URL can
 * never succeed — only loading the new `index.html` can — so the recovery is a
 * reload rather than a retry.
 */
export function recoverFromRetiredChunks(): void {
  window.addEventListener('vite:preloadError', () => {
    if (claimReload()) window.location.reload();
  });
}

/**
 * True at most once per window. False when a reload was already tried, and when
 * storage is unavailable — without somewhere to record the attempt, a second
 * failure is indistinguishable from the first, and the error boundary's manual
 * reload is the safe path.
 */
function claimReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_MARKER)) || 0;
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_MARKER, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** A failed dynamic import, which no amount of re-rendering can retry. */
export function isChunkLoadError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i.test(
    error.message,
  );
}
