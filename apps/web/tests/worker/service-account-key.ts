/** A throwaway RSA key in the PKCS#8 PEM form a service-account JSON carries. */
export async function serviceAccountKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKeyPem: string;
}> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;

  const der = (await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer;
  const body = btoa(String.fromCharCode(...new Uint8Array(der))).replace(/(.{64})/g, '$1\n');
  return {
    publicKey: pair.publicKey,
    privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
  };
}
