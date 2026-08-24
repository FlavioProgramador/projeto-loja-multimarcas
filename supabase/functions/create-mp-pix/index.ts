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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const mpAccessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');

    if (!mpAccessToken) {
      throw new Error('MERCADOPAGO_ACCESS_TOKEN is missing in edge function env vars');
    }

    // Initialize Supabase client with the user's Auth token from the request
    const authHeader = req.headers.get('Authorization');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader || '' } }
    });

    const { cartItems, customerId, customerName, customerCpf, discountValue, discountPercent } = await req.json();

    // 1. Call RPC to create the pending sale
    const { data: saleResult, error: saleError } = await supabase.rpc('create_mp_pix_sale', {
      p_customer_id: customerId,
      p_customer_name: customerName,
      p_customer_cpf: customerCpf,
      p_items: cartItems,
      p_discount_value: discountValue,
      p_discount_percent: discountPercent
    });

    if (saleError) {
      console.error('RPC Error:', saleError);
      throw saleError;
    }
    if (!saleResult || !saleResult.success) throw new Error('Falha ao criar venda pendente');

    const { sale_id, sale_number, total } = saleResult;

    // 2. Call Mercado Pago API to generate PIX
    const idempotencyKey = crypto.randomUUID();
    const notificationUrl = `${supabaseUrl}/functions/v1/mp-webhook`;

    // Only set CPF if it has 11 digits
    let identification = {};
    if (customerCpf) {
      const cleanCpf = customerCpf.replace(/\D/g, '');
      if (cleanCpf.length === 11) {
        identification = { type: 'CPF', number: cleanCpf };
      }
    }

    const mpPayload = {
      transaction_amount: Number(total),
      description: `Venda ${sale_number} - Vestra ERP`,
      payment_method_id: 'pix',
      payer: {
        email: 'financeiro@vestra.com.br', // Fallback email
        first_name: customerName || 'Cliente',
        ...(Object.keys(identification).length > 0 ? { identification } : {})
      },
      external_reference: sale_id, // Store our internal sale ID
      notification_url: notificationUrl
    };

    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mpAccessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(mpPayload)
    });

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Mercado Pago Error:', mpData);
      
      // Se falhou no MP, idealmente cancelaríamos a venda no DB, mas para simplificar vamos apenas retornar erro
      throw new Error(`Erro Mercado Pago: ${mpData.message || mpData.error}`);
    }

    // 3. Update payment with MP provider ID
    await supabase
      .from('payments')
      .update({ provider_transaction_id: mpData.id.toString() })
      .eq('sale_id', sale_id);

    return new Response(
      JSON.stringify({
        success: true,
        sale_id,
        sale_number,
        qr_code_base64: mpData.point_of_interaction?.transaction_data?.qr_code_base64,
        qr_code: mpData.point_of_interaction?.transaction_data?.qr_code,
        mp_payment_id: mpData.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
