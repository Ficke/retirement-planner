/**
 * Bounded revocation delay on a cached membership answer. Short enough that a
 * removed account loses cloud compute promptly, long enough that a plan refresh
 * — a headline simulation and a sensitivity batch — costs one query, not two.
 */
const MEMBERSHIP_TTL_SECONDS = 60;

function cacheKey(requestUrl: string, uid: string): Request {
  const key = new URL('/__edge/application-user', requestUrl);
  key.searchParams.set('uid', uid);
  return new Request(key, { method: 'GET' });
}

/**
 * Whether a verified Firebase identity also has a row in this app's `users`
 * table, answered from the colo cache when it can be.
 *
 * A Firebase identity alone is not membership: Firebase's public signup API
 * creates one without passing this app's invite check. Only confirmed
 * membership is cached — a miss is rare, and caching it would lock a new
 * account out of cloud compute for the window after it signs up.
 */
export async function isRegisteredAccount(
  uid: string,
  requestUrl: string,
  lookUp: () => Promise<boolean>,
): Promise<boolean> {
  const key = cacheKey(requestUrl, uid);
  const cached = await caches.default.match(key).catch(() => undefined);
  if (cached) return true;

  const registered = await lookUp();
  if (registered) {
    await caches.default
      .put(key, new Response('', { headers: { 'Cache-Control': `max-age=${MEMBERSHIP_TTL_SECONDS}` } }))
      .catch(() => undefined);
  }
  return registered;
}
