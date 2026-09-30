/**
 * Generates an idempotency key without requiring crypto.randomUUID().
 *
 * randomUUID() is only exposed in secure browser contexts in some environments.
 * getRandomValues() remains available in the HTTP/LAN scenario used during local
 * CoreSys testing, so we use it to build an RFC 4122 v4 UUID as a fallback.
 */
export function generateIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  }

  // Last-resort compatibility path. The key is used for idempotency, not as a secret.
  return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
