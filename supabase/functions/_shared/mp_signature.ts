// Lógica de verificação de assinatura do webhook do Mercado Pago.
// Extraída para módulo puro para permitir testes unitários (Deno test).

export interface ParsedSignature {
  ts: string;
  v1: string;
  timestamp: number;
}

/**
 * Faz o parse do header `x-signature` do Mercado Pago.
 * Formato esperado: "ts=1700000000,v1=abcdef..."
 * Retorna null quando o header está ausente ou malformado.
 */
export function parseSignatureHeader(xSignature: string | null): ParsedSignature | null {
  if (!xSignature) return null;

  const ts = xSignature
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.startsWith('ts='))
    ?.slice(3) ?? '';

  const v1 = xSignature
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.startsWith('v1='))
    ?.slice(3) ?? '';

  const timestamp = Number(ts);

  if (!ts || !v1 || !Number.isFinite(timestamp)) return null;
  return { ts, v1, timestamp };
}

/** Verifica se o timestamp está dentro da tolerância (proteção contra replay antigo). */
export function isTimestampFresh(
  timestamp: number,
  maxAgeSeconds = 600,
  now: number = Date.now(),
): boolean {
  return Math.abs(Math.floor(now / 1000) - timestamp) <= maxAgeSeconds;
}

/**
 * Verifica a assinatura HMAC-SHA256 do webhook.
 * Manifest: `id:{dataId};request-id:{requestId};ts:{ts};`
 */
export async function verifySignature(params: {
  secret: string;
  dataId: string | number;
  requestId: string;
  signature: ParsedSignature;
}): Promise<boolean> {
  const { secret, dataId, requestId, signature } = params;
  const normalizedDataId = String(dataId).toLowerCase();
  const manifest = `id:${normalizedDataId};request-id:${requestId};ts:${signature.ts};`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const hex = signature.v1.match(/.{1,2}/g);
  const signatureBytes = new Uint8Array(hex?.map((byte) => parseInt(byte, 16)) ?? []);

  return signatureBytes.length === 32 &&
    await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(manifest));
}
