/**
 * The Rust service could not be reached or authenticated to.
 *
 * Its own module because the two clients that raise it — Cloud Run's, built on
 * google-auth-library, and the Worker's, built on WebCrypto — cannot import
 * each other, and the routes that map it onto a 503 must not pull in either.
 */
export class RustServiceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RustServiceUnavailableError';
  }
}
