import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !mpAccessToken) {
      console.error("create-mp-pix misconfigured: required environment is missing");
      return jsonResponse({ error: "Serviço PIX temporariamente indisponível." }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Autenticação obrigatória." }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);
    }

    const body = await req.json();
    const {
      storeId,
      cartItems,
      customerId,
      customerName,
      customerCpf,
      discountValue,
      discountPercent,
      idempotencyKey: bodyIdempotencyKey,
    } = body ?? {};

    const requestedIdempotencyKey =
      req.headers.get("x-idempotency-key") || bodyIdempotencyKey;
    const idempotencyKey =
      typeof requestedIdempotencyKey === "string"
        ? requestedIdempotencyKey.trim()
        : "";

    if (!idempotencyKey) {
      return jsonResponse(
        { error: "A chave de idempotência é obrigatória para criar um PIX." },
        400,
      );
    }

    if (typeof storeId !== "string" || !storeId.trim()) {
      return jsonResponse({ error: "Loja ativa é obrigatória." }, 400);
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return jsonResponse({ error: "Carrinho vazio." }, 400);
    }

    const { data: saleResult, error: saleError } = await supabase.rpc(
      "create_mp_pix_sale",
      {
        p_store_id: storeId,
        p_customer_id: customerId ?? null,
        p_customer_name: customerName ?? "Cliente não identificado",
        p_customer_cpf: customerCpf ?? "Não informado",
        p_items: cartItems,
        p_discount_value: discountValue ?? 0,
        p_discount_percent: discountPercent ?? 0,
        p_idempotency_key: idempotencyKey,
      },
    );

    if (saleError) throw saleError;
    if (!saleResult?.success || !saleResult.sale_id) {
      throw new Error(saleResult?.message || "Falha ao criar venda PIX.");
    }

    const { sale_id, sale_number, total } = saleResult;
    const providerIdempotencyKey = `pix-${idempotencyKey}`;
    const notificationUrl = `${supabaseUrl}/functions/v1/mp-webhook`;

    const cleanCpf = typeof customerCpf === "string"
      ? customerCpf.replace(/\D/g, "")
      : "";
    const identification =
      cleanCpf.length === 11 ? { type: "CPF", number: cleanCpf } : undefined;

    const mpPayload = {
      transaction_amount: Number(total),
      description: `Venda ${sale_number} - CoreSys`,
      payment_method_id: "pix",
      payer: {
        email: "financeiro@coresys.com.br",
        first_name: customerName || "Cliente",
        ...(identification ? { identification } : {}),
      },
      external_reference: sale_id,
      notification_url: notificationUrl,
    };

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": providerIdempotencyKey,
      },
      body: JSON.stringify(mpPayload),
    });

    const mpData = await mpResponse.json().catch(() => ({}));

    if (!mpResponse.ok) {
      console.error("Mercado Pago error:", mpResponse.status, mpData);
      const { error: cancelRpcError } = await serviceSupabase.rpc(
        "cancel_mp_pix_sale",
        { p_sale_id: sale_id },
      );

      if (cancelRpcError) {
        console.error("Rollback PIX failed:", cancelRpcError);
        return jsonResponse(
          { error: "Falha ao criar o PIX e ao desfazer a reserva. Acione o suporte." },
          502,
        );
      }

      return jsonResponse(
        { error: mpData?.message || mpData?.error || "Mercado Pago recusou o pagamento." },
        400,
      );
    }

    if (!mpData?.id) {
      console.error("Mercado Pago returned no payment id:", mpData);
      await serviceSupabase.rpc("cancel_mp_pix_sale", { p_sale_id: sale_id });
      return jsonResponse({ error: "Mercado Pago não retornou um pagamento válido." }, 502);
    }

    const { error: paymentUpdateError } = await serviceSupabase
      .from("payments")
      .update({
        provider: "MERCADO_PAGO",
        provider_transaction_id: String(mpData.id),
      })
      .eq("sale_id", sale_id)
      .eq("method", "PIX");

    if (paymentUpdateError) {
      console.error("Failed to link Mercado Pago payment:", paymentUpdateError);
      return jsonResponse(
        { error: "PIX criado, mas o vínculo do pagamento falhou. Acione o suporte." },
        502,
      );
    }

    return jsonResponse({
      success: true,
      sale_id,
      sale_number,
      qr_code_base64:
        mpData.point_of_interaction?.transaction_data?.qr_code_base64 ?? null,
      qr_code:
        mpData.point_of_interaction?.transaction_data?.qr_code ?? null,
      mp_payment_id: mpData.id,
    });
  } catch (error) {
    console.error("create-mp-pix error:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro inesperado ao criar PIX." },
      400,
    );
  }
});