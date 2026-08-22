import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''; // Usamos Service Key para bypass RLS no webhook
    const mpAccessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // O Webhook do Mercado Pago envia query params: id e topic, OU envia no body { action: 'payment.created', data: { id: '...' } }
    const url = new URL(req.url);
    const paymentId = url.searchParams.get('data.id') || url.searchParams.get('id');
    const topic = url.searchParams.get('type') || url.searchParams.get('topic');
    
    let body;
    try { body = await req.json(); } catch(e) {}

    const id = paymentId || (body && body.data && body.data.id);
    
    if (!id) {
       return new Response("No ID provided", { status: 200 });
    }

    // Buscar os detalhes do pagamento no Mercado Pago para garantir segurança (verificar se foi aprovado mesmo)
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: {
        'Authorization': `Bearer ${mpAccessToken}`
      }
    });

    if (!mpResponse.ok) {
       return new Response("Failed to fetch payment from MP", { status: 400 });
    }

    const paymentInfo = await mpResponse.json();
    const status = paymentInfo.status; // 'approved', 'pending', 'rejected', 'cancelled'
    const externalReference = paymentInfo.external_reference; // Nosso sale_id

    if (!externalReference) {
       return new Response("No external_reference found", { status: 200 });
    }

    if (status === 'approved') {
       // Aprovar Venda
       const { error } = await supabase.rpc('approve_mp_pix_sale', {
         p_sale_id: externalReference,
         p_provider_transaction_id: id.toString()
       });
       if (error) {
         console.error('Error approving sale:', error);
         throw error;
       }
    } 
    // Em produção poderíamos lidar com "cancelled" e "rejected" para desfazer a venda e voltar estoque.

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 });

  } catch (error: any) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
});
