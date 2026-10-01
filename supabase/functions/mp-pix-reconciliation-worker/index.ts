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

function isPastExpiration(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey || !mpAccessToken) {
    console.error("PIX reconciliation worker is misconfigured");
    return json({ error: "worker_unavailable" }, 500);
  }

  const workerToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!workerToken) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: authorized, error: authError } = await supabase.rpc("verify_pix_worker_token", {
    p_token: workerToken,
  });
  if (authError || authorized !== true) {
    console.warn("PIX worker authorization rejected");
    return json({ error: "unauthorized" }, 401);
  }

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
      const expiredByDeadline = status === "pending" && isPastExpiration(payment?.date_of_expiration);

      if (status === "approved") {
        const { error } = await supabase.rpc("approve_mp_pix_sale", {
          p_sale_id: saleId,
          p_provider_transaction_id: String(providerId),
        });
        if (error) throw error;
        results.push({ sale_id: saleId, action: "approved" });
      } else if (["cancelled", "rejected", "expired"].includes(status) || expiredByDeadline) {
        const { error } = await supabase.rpc("cancel_mp_pix_sale", { p_sale_id: saleId });
        if (error) throw error;
        results.push({
          sale_id: saleId,
          action: "cancelled",
          provider_status: expiredByDeadline ? "expired_deadline" : status,
        });
      } else {
        results.push({ sale_id: saleId, action: "unchanged", provider_status: status ?? "unknown" });
      }
    } catch (error) {
      console.error("PIX reconciliation candidate failed", error instanceof Error ? error.name : "unknown");
      results.push({ sale_id: saleId, action: "retry", reason: "processing_failed" });
    }
  }

  const summary = results.reduce(
    (acc, item) => {
      const action = String(item.action ?? "unknown");
      acc[action] = (acc[action] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log("PIX reconciliation summary", JSON.stringify({ processed: results.length, ...summary }));

  return json({ processed: results.length, results });
});
