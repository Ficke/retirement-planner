import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isRegisteredAccount } from '@/worker/application-user';

const REQUEST_URL = 'https://adamficke.dev/api/simulation/monte-carlo';

let uidCounter = 0;
const nextUid = () => `firebase-uid-${(uidCounter += 1)}`;

const lookUp = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isRegisteredAccount', () => {
  it('answers from the database when nothing is cached', async () => {
    lookUp.mockResolvedValue(true);

    await expect(isRegisteredAccount(nextUid(), REQUEST_URL, lookUp)).resolves.toBe(true);
    expect(lookUp).toHaveBeenCalledOnce();
  });

  // The simulation path opens no database connection of its own, and a plan
  // refresh sends two requests; without this each would pay a Hyperdrive query
  // for an answer that cannot have changed.
  it('answers a repeat within the window from the colo cache', async () => {
    const uid = nextUid();
    lookUp.mockResolvedValue(true);

    await isRegisteredAccount(uid, REQUEST_URL, lookUp);
    await expect(isRegisteredAccount(uid, REQUEST_URL, lookUp)).resolves.toBe(true);

    expect(lookUp).toHaveBeenCalledOnce();
  });

  it('reports a verified identity that has no account here', async () => {
    lookUp.mockResolvedValue(false);

    await expect(isRegisteredAccount(nextUid(), REQUEST_URL, lookUp)).resolves.toBe(false);
  });

  // A miss is rare, and caching it would lock a new account out of cloud
  // compute for the whole window after it signs up.
  it('does not cache a missing account', async () => {
    const uid = nextUid();
    lookUp.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(isRegisteredAccount(uid, REQUEST_URL, lookUp)).resolves.toBe(false);
    await expect(isRegisteredAccount(uid, REQUEST_URL, lookUp)).resolves.toBe(true);
    expect(lookUp).toHaveBeenCalledTimes(2);
  });

  it('keeps answering after a cache failure', async () => {
    const uid = nextUid();
    lookUp.mockResolvedValue(true);
    vi.spyOn(caches.default, 'match').mockRejectedValue(new Error('cache unavailable'));
    vi.spyOn(caches.default, 'put').mockRejectedValue(new Error('cache unavailable'));

    await expect(isRegisteredAccount(uid, REQUEST_URL, lookUp)).resolves.toBe(true);
    vi.restoreAllMocks();
  });
});
