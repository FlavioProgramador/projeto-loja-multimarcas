import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey || !mpAccessToken) {
    console.error("PIX reconciliation worker is misconfigured");
    return json({ error: "worker_unavailable" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: candidates, error: candidateError } = await supabase.rpc(
    "list_stale_pix_reconciliation_candidates",
    { p_older_than_minutes: 60 },
  );

  if (candidateError) {
    console.error("Failed to load PIX reconciliation candidates", candidateError.code);
    return json({ error: "candidate_lookup_failed" }, 503);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const candidate of candidates ?? []) {
    const saleId = String(candidate.sale_id);
    const providerId = candidate.provider_transaction_id;

    if (!providerId) {
      results.push({ sale_id: saleId, action: "skipped", reason: "missing_provider_transaction_id" });
      continue;
    }

    try {
      const providerResponse = await fetch(
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(providerId))}`,
        { headers: { Authorization: `Bearer ${mpAccessToken}` } },
      );

      if (!providerResponse.ok) {
        console.error("Mercado Pago lookup failed", providerResponse.status);
        results.push({ sale_id: saleId, action: "retry", reason: "provider_lookup_failed" });
        continue;
      }

      const payment = await providerResponse.json();
      const status = payment?.status;

      if (status === "approved") {
        const { error } = await supabase.rpc("approve_mp_pix_sale", {
          p_sale_id: saleId,
          p_provider_transaction_id: String(providerId),
        });
        if (error) throw error;
        results.push({ sale_id: saleId, action: "approved" });
      } else if (["cancelled", "rejected", "expired"].includes(status)) {
        const { error } = await supabase.rpc("cancel_mp_pix_sale", { p_sale_id: saleId });
        if (error) throw error;
        results.push({ sale_id: saleId, action: "cancelled", provider_status: status });
      } else {
        results.push({ sale_id: saleId, action: "unchanged", provider_status: status ?? "unknown" });
      }
    } catch (error) {
      console.error("PIX reconciliation candidate failed", error instanceof Error ? error.name : "unknown");
      results.push({ sale_id: saleId, action: "retry", reason: "processing_failed" });
    }
  }

  return json({ processed: results.length, results });
});
