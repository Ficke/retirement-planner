import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, recoverFromRetiredChunks } from '@/lib/chunk-recovery';

const reload = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  reload.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function preloadErrorFires() {
  window.dispatchEvent(new Event('vite:preloadError'));
}

describe('recovery from a retired chunk', () => {
  it('reloads onto the current build when a chunk no longer resolves', () => {
    recoverFromRetiredChunks();

    preloadErrorFires();

    expect(reload).toHaveBeenCalledOnce();
  });

  // A reload that fixes a stale chunk succeeds immediately, so a second failure
  // right behind it means the build is broken and reloading again would spin.
  it('does not reload a second time inside the window', () => {
    recoverFromRetiredChunks();

    preloadErrorFires();
    preloadErrorFires();
    preloadErrorFires();

    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads again for a later deploy, once the window has passed', () => {
    vi.useFakeTimers();
    recoverFromRetiredChunks();

    preloadErrorFires();
    vi.advanceTimersByTime(61_000);
    preloadErrorFires();

    expect(reload).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  // Without somewhere to record the attempt, a second failure cannot be told
  // from the first, so the manual reload in the error boundary takes over.
  it('leaves the reload to the user when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    recoverFromRetiredChunks();

    preloadErrorFires();

    expect(reload).not.toHaveBeenCalled();
  });
});

describe('isChunkLoadError', () => {
  it('recognizes the browsers’ dynamic-import failures', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://adamficke.dev/assets/accounts-x.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
    ]) {
      expect(isChunkLoadError(new Error(message)), message).toBe(true);
    }
  });

  it('leaves ordinary application errors alone', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
