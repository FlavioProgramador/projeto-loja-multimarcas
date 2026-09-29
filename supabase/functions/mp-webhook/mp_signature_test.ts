// Testes unitários da verificação de assinatura do webhook do Mercado Pago.
// Executar com: deno test --allow-all supabase/functions

import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  isTimestampFresh,
  parseSignatureHeader,
  verifySignature,
} from "../_shared/mp_signature.ts";

async function sign(secret: string, manifest: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(manifest)));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("parseSignatureHeader: extrai ts e v1 de header válido", () => {
  const parsed = parseSignatureHeader("ts=1700000000,v1=abcdef0123");
  assertEquals(parsed, { ts: "1700000000", v1: "abcdef0123", timestamp: 1700000000 });
});

Deno.test("parseSignatureHeader: tolera espaços e ordem invertida", () => {
  const parsed = parseSignatureHeader(" v1=abcdef , ts=1700000000 ");
  assertEquals(parsed?.ts, "1700000000");
  assertEquals(parsed?.v1, "abcdef");
});

Deno.test("parseSignatureHeader: rejeita headers ausentes/malformados", () => {
  assertEquals(parseSignatureHeader(null), null);
  assertEquals(parseSignatureHeader(""), null);
  assertEquals(parseSignatureHeader("v1=abcdef"), null);
  assertEquals(parseSignatureHeader("ts=abc,v1=def"), null);
});

Deno.test("isTimestampFresh: aceita timestamp dentro da tolerância", () => {
  const now = 1_700_000_000_000;
  assert(isTimestampFresh(1_700_000_000, 600, now));
  assert(isTimestampFresh(1_700_000_000 - 599, 600, now));
  assert(!isTimestampFresh(1_700_000_000 - 601, 600, now));
});

Deno.test("verifySignature: aceita assinatura HMAC-SHA256 legítima", async () => {
  const secret = "webhook-secret";
  const ts = "1700000000";
  const manifest = `id:pay_123;request-id:req-1;ts:${ts};`;
  const v1 = await sign(secret, manifest);

  const ok = await verifySignature({
    secret,
    dataId: "PAY_123", // normalização para lowercase
    requestId: "req-1",
    signature: { ts, v1, timestamp: Number(ts) },
  });

  assert(ok);
});

Deno.test("verifySignature: rejeita assinatura adulterada ou de outro segredo", async () => {
  const ts = "1700000000";
  const manifest = `id:pay_123;request-id:req-1;ts:${ts};`;
  const v1 = await sign("webhook-secret", manifest);

  const segredoErrado = await verifySignature({
    secret: "outro-secret",
    dataId: "pay_123",
    requestId: "req-1",
    signature: { ts, v1, timestamp: Number(ts) },
  });
  assertEquals(segredoErrado, false);

  const requestIdAdulterado = await verifySignature({
    secret: "webhook-secret",
    dataId: "pay_123",
    requestId: "req-999",
    signature: { ts, v1, timestamp: Number(ts) },
  });
  assertEquals(requestIdAdulterado, false);
});

Deno.test("verifySignature: rejeita v1 com tamanho inválido", async () => {
  const ok = await verifySignature({
    secret: "s",
    dataId: "1",
    requestId: "r",
    signature: { ts: "1", v1: "abcd", timestamp: 1 },
  });
  assertEquals(ok, false);
});
