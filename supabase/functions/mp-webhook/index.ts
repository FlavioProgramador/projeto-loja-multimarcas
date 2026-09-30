import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');

function corsHeaders() {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature, x-request-id',
    'Vary': 'Origin',
  };

  if (ALLOWED_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
  }

  return headers;
}

serve(async (req) => {
  const headers = corsHeaders();

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers, status: 204 });
  }

  try {
    const webhookSecret = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const mpAccessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');

    if (!webhookSecret || !mpAccessToken || !supabaseServiceKey) {
      console.error('MP webhook misconfigured: required secrets are missing');
      return new Response('Webhook misconfigured', { status: 500, headers });
    }

    const xSignature = req.headers.get('x-signature');
    const xRequestId = req.headers.get('x-request-id');

    if (!xSignature || !xRequestId) {
      return new Response('Missing signature headers', { status: 403, headers });
    }

    const url = new URL(req.url);
    const paymentId = url.searchParams.get('data.id') || url.searchParams.get('id');

    let body: Record<string, unknown> | null = null;
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch (_) {}

    const nestedData =
      body?.data && typeof body.data === 'object'
        ? body.data as Record<string, unknown>
        : null;

    const dataId = paymentId || (typeof nestedData?.id === 'string' ? nestedData.id : null);

    if (!dataId) {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    const ts = xSignature
      .split(',')
      .map(part => part.trim())
      .find(part => part.startsWith('ts='))
      ?.slice(3) || '';

    const v1 = xSignature
      .split(',')
      .map(part => part.trim())
      .find(part => part.startsWith('v1='))
      ?.slice(3) || '';

    const timestamp = Number(ts);

    if (!ts || !v1 || !Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 600) {
      return new Response('Invalid or expired webhook signature', { status: 403, headers });
    }

    const normalizedDataId = String(dataId).toLowerCase();
    const manifest = `id:${normalizedDataId};request-id:${xRequestId};ts:${ts};`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const hex = v1.match(/.{1,2}/g);
    const signatureBytes = new Uint8Array(hex?.map(byte => parseInt(byte, 16)) || []);
    const validSignature =
      signatureBytes.length === 32 &&
      await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(manifest));

    if (!validSignature) {
      return new Response('Invalid webhook signature', { status: 403, headers });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: claim, error: claimError } = await supabase.rpc('claim_mp_webhook_event', {
      p_request_id: xRequestId,
      p_provider_payment_id: String(dataId),
      p_signature_ts: timestamp
    });

    if (claimError) {
      console.error('Falha ao registrar evento de webhook:', claimError.code);
      return new Response(JSON.stringify({ error: 'Webhook processing unavailable' }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
        status: 503
      });
    }

    if (claim?.status === 'processed' || claim?.status === 'in_progress') {
      return new Response(JSON.stringify({ success: true, replayed: true }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${mpAccessToken}` }
    });

    if (!mpResponse.ok) {
      const providerError = await mpResponse.text();
      console.error('Falha ao consultar MP:', mpResponse.status, providerError.slice(0, 500));
      await supabase.rpc('fail_mp_webhook_event', {
        p_request_id: xRequestId,
        p_error: 'Provider payment lookup failed'
      });
      return new Response(JSON.stringify({ error: 'Failed to fetch payment' }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
        status: 502
      });
    }

    const paymentInfo = await mpResponse.json();
    const status = paymentInfo.status;
    const externalReference = paymentInfo.external_reference;

    if (!externalReference) {
      await supabase.rpc('complete_mp_webhook_event', { p_request_id: xRequestId });
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    if (status === 'approved') {
      const { error } = await supabase.rpc('approve_mp_pix_sale', {
        p_sale_id: externalReference,
        p_provider_transaction_id: String(dataId)
      });
      if (error) throw error;
    } else if (['cancelled', 'rejected', 'expired'].includes(status)) {
      const { error } = await supabase.rpc('cancel_mp_pix_sale', {
        p_sale_id: externalReference
      });
      if (error) throw error;
    }

    const { error: completeError } = await supabase.rpc('complete_mp_webhook_event', {
      p_request_id: xRequestId
    });
    if (completeError) throw completeError;

    return new Response(JSON.stringify({ success: true, status }), {
      headers: { ...headers, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error: unknown) {
    console.error('MP Webhook erro crítico:', error instanceof Error ? error.name : 'unknown');
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await supabase.rpc('fail_mp_webhook_event', {
          p_request_id: xRequestId,
          p_error: 'Webhook processing failed'
        });
      }
    } catch (markError) {
      console.error('Falha ao marcar webhook para retry:', markError instanceof Error ? markError.name : 'unknown');
    }

    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), {
      headers: { ...headers, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});