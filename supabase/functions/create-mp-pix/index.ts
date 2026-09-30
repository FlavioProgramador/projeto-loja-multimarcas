import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Auth is enforced by the Edge gateway (verify_jwt=true).
// This handler only uses the caller's JWT for user-scoped RPC authorization.
function corsHeaders(origin: string | null) {
  const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN');
  if (!allowedOrigin) {
    return {
      'Access-Control-Allow-Origin': 'null',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key',
      'Vary': 'Origin'
    };
  }
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key',
    'Vary': 'Origin'
  };
}

function errorResponse(message: string, status: number, origin: string | null) {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    status
  });
}

serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin), status: 204 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const mpAccessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !mpAccessToken) {
      console.error('MP PIX function misconfigured: required environment variables are missing');
      return errorResponse('Serviço de pagamento temporariamente indisponível.', 500, origin);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Não autenticado.', 401, origin);
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return errorResponse('Requisição inválida.', 400, origin);
    }

    const {
      storeId,
      cartItems,
      customerId,
      customerName,
      customerCpf,
      discountValue,
      discountPercent
    } = body as Record<string, any>;

    if (typeof storeId !== 'string' || !Array.isArray(cartItems) || cartItems.length === 0) {
      return errorResponse('Dados da venda inválidos.', 400, origin);
    }

    const requestedIdempotencyKey = req.headers.get('x-idempotency-key') || body.idempotencyKey;
    const idempotencyKey =
      typeof requestedIdempotencyKey === 'string' ? requestedIdempotencyKey.trim() : '';

    if (!idempotencyKey || idempotencyKey.length > 200) {
      return errorResponse('Chave de idempotência inválida.', 400, origin);
    }

    const { data: saleResult, error: saleError } = await userSupabase.rpc('create_mp_pix_sale', {
      p_store_id: storeId,
      p_customer_id: customerId ?? null,
      p_customer_name: customerName ?? 'Cliente não identificado',
      p_customer_cpf: customerCpf ?? 'Não informado',
      p_items: cartItems,
      p_discount_value: discountValue ?? 0,
      p_discount_percent: discountPercent ?? 0,
      p_idempotency_key: idempotencyKey
    });

    if (saleError) {
      console.error('create_mp_pix_sale failed:', saleError.code, saleError.message);
      const code = String(saleError.code ?? '');
      const status =
        code === '42501' || /permiss|acesso negado|autoriz/i.test(saleError.message)
          ? 403
          : /autentic/i.test(saleError.message)
            ? 401
            : 400;
      return errorResponse(status === 403 ? 'Acesso negado à loja.' : 'Não foi possível criar a cobrança.', status, origin);
    }

    if (!saleResult?.success) {
      return errorResponse('Não foi possível criar a cobrança.', 400, origin);
    }

    const { sale_id, sale_number, total } = saleResult;
    if (!sale_id) {
      console.error('create_mp_pix_sale returned no sale id');
      return errorResponse('Serviço de pagamento temporariamente indisponível.', 500, origin);
    }

    const providerIdempotencyKey = `pix-${idempotencyKey}`;
    const notificationUrl = `${supabaseUrl}/functions/v1/mp-webhook`;

    let identification = {};
    if (typeof customerCpf === 'string') {
      const cleanCpf = customerCpf.replace(/\D/g, '');
      if (cleanCpf.length === 11) identification = { type: 'CPF', number: cleanCpf };
    }

    const payerName = typeof customerName === 'string' ? customerName.trim() : '';
    const payerFirstName = (payerName || 'Cliente').split(/\s+/)[0].slice(0, 50) || 'Cliente';
    const mpPayload = {
      transaction_amount: Number(total),
      description: `Venda ${sale_number} - CoreSys`.slice(0, 255),
      payment_method_id: 'pix',
      payer: {
        email: 'financeiro@coresys.com.br',
        first_name: payerFirstName,
        ...(Object.keys(identification).length > 0 ? { identification } : {})
      },
      external_reference: String(sale_id),
      notification_url: notificationUrl
    };

    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mpAccessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': providerIdempotencyKey
      },
      body: JSON.stringify(mpPayload)
    });
    const mpData = await mpResponse.json().catch(() => null);

    if (!mpResponse.ok) {
      console.error('Mercado Pago request rejected:', mpResponse.status, JSON.stringify(mpData ?? {}));
      const { data: cancelResult, error: cancelRpcError } = await serviceSupabase.rpc('cancel_mp_pix_sale', { p_sale_id: sale_id });
      if (cancelRpcError || cancelResult?.success !== true) {
        console.error('Rollback after Mercado Pago rejection failed:', cancelRpcError?.code ?? 'unknown');
        return errorResponse('O provedor recusou o pagamento e o pedido não pôde ser revertido automaticamente.', 500, origin);
      }
      const providerMessage =
        mpData?.cause?.[0]?.description ?? mpData?.message ?? mpData?.error ?? 'O provedor de pagamento recusou a cobrança.';
      return errorResponse(providerMessage, 400, origin);
    }

    const { error: paymentUpdateError } = await serviceSupabase
      .from('payments')
      .update({
        provider: 'MERCADO_PAGO',
        provider_transaction_id: String(mpData.id)
      })
      .eq('sale_id', sale_id)
      .eq('method', 'PIX');

    if (paymentUpdateError) {
      console.error('Failed to link Mercado Pago payment:', paymentUpdateError.code);
      return errorResponse('Pagamento criado, mas a confirmação interna falhou. O suporte deve verificar a venda.', 500, origin);
    }

    return new Response(JSON.stringify({
      success: true,
      sale_id,
      sale_number,
      qr_code_base64: mpData.point_of_interaction?.transaction_data?.qr_code_base64,
      qr_code: mpData.point_of_interaction?.transaction_data?.qr_code,
      mp_payment_id: mpData.id
    }), {
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error: unknown) {
    console.error('create-mp-pix unexpected error:', error instanceof Error ? error.name : 'unknown');
    return errorResponse('Não foi possível concluir a solicitação.', 500, origin);
  }
});
