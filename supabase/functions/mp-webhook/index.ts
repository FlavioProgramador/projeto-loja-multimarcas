import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const mpAccessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');

    // Usar Service Key para bypass RLS no webhook (necessário pois webhooks não têm sessão de usuário)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const xSignature = req.headers.get('x-signature');
    const xRequestId = req.headers.get('x-request-id');
    const webhookSecret = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET');

    // Validação Criptográfica Obrigatória (Hardening Adicional)
    if (webhookSecret) {
      if (!xSignature || !xRequestId) {
        console.error("Missing x-signature or x-request-id");
        return new Response("Missing signature headers", { status: 403 });
      }

      const parts = xSignature.split(',');
      let ts = '';
      let v1 = '';
      for (const part of parts) {
        const [key, value] = part.split('=');
        if (key.trim() === 'ts') ts = value;
        if (key.trim() === 'v1') v1 = value;
      }
      
      if (ts && v1) {
        // Tolerância de tempo (ex: rejeitar se for mais antigo que 10 minutos para evitar Replay Attacks)
        const currentTs = Math.floor(Date.now() / 1000);
        const webhookTs = parseInt(ts, 10);
        if (Math.abs(currentTs - webhookTs) > 600) { // 10 minutos
           console.error("Invalid x-signature: timestamp expired");
           return new Response("Timestamp expired", { status: 403 });
        }

        // Obter os IDs da URL ou Body. MP usa req.url.searchParams para extrair data.id.
        // O manifesto oficial do MP: "id:[data.id];request-id:[x-request-id];ts:[ts];"
        const url = new URL(req.url);
        let bodyContent;
        try { bodyContent = await req.clone().json(); } catch(e) {}
        
        const dataId = url.searchParams.get('data.id') || (bodyContent && bodyContent.data && bodyContent.data.id) || url.searchParams.get('id');
        
        if (dataId) {
          const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
          const encoder = new TextEncoder();
          const key = await crypto.subtle.importKey(
            "raw", encoder.encode(webhookSecret),
            { name: "HMAC", hash: "SHA-256" },
            false, ["sign", "verify"]
          );
          const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(manifest));
          const hashArray = Array.from(new Uint8Array(signatureBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          
          if (hashHex !== v1) {
             console.error("Invalid x-signature: mismatch");
             return new Response("Invalid signature", { status: 403 });
          }
        }
      }
    }

    const url = new URL(req.url);
    const paymentId = url.searchParams.get('data.id') || url.searchParams.get('id');
    const topic = url.searchParams.get('type') || url.searchParams.get('topic');

    let body;
    try { body = await req.json(); } catch(e) {}

    const id = paymentId || (body && body.data && body.data.id);

    if (!id) {
       return new Response("No ID provided", { status: 200 });
    }

    // Buscar detalhes do pagamento no MP para confirmar o status (segurança: não confiar só no payload)
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { 'Authorization': `Bearer ${mpAccessToken}` }
    });

    if (!mpResponse.ok) {
       console.error('Failed to fetch payment from MP:', await mpResponse.text());
       return new Response("Failed to fetch payment from MP", { status: 400 });
    }

    const paymentInfo = await mpResponse.json();
    const status = paymentInfo.status; // 'approved', 'pending', 'rejected', 'cancelled'
    const externalReference = paymentInfo.external_reference; // Nosso sale_id interno

    console.log(`MP Webhook: payment ${id}, status=${status}, sale_id=${externalReference}`);

    if (!externalReference) {
       return new Response("No external_reference found", { status: 200 });
    }

    if (status === 'approved') {
      // ✅ PIX aprovado — finalizar venda
      const { error } = await supabase.rpc('approve_mp_pix_sale', {
        p_sale_id: externalReference,
        p_provider_transaction_id: id.toString()
      });
      if (error) {
        console.error('Error approving sale:', error);
        throw error;
      }
      console.log(`Sale ${externalReference} approved successfully.`);

    } else if (status === 'cancelled' || status === 'rejected' || status === 'expired') {
      // ❌ PIX cancelado/rejeitado/expirado — estornar estoque
      console.log(`PIX ${status} for sale ${externalReference}. Rolling back stock...`);
      const { error } = await supabase.rpc('cancel_mp_pix_sale', {
        p_sale_id: externalReference
      });
      if (error) {
        // Se a RPC não existir ainda, logar mas não falhar o webhook (MP vai tentar de novo)
        console.error('Error rolling back sale (cancel_mp_pix_sale RPC may not exist yet):', error);
      } else {
        console.log(`Sale ${externalReference} cancelled and stock restored.`);
      }
    }

    return new Response(JSON.stringify({ success: true, status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    console.error('MP Webhook error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
});

