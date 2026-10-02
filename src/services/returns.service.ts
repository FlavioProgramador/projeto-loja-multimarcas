import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { ReturnItem, ReturnRecord } from '../types';

interface ReturnRpcResult {
  success?: boolean;
  message?: string;
  return_id?: string;
  return_number?: string;
  total?: number | string;
}

interface ReturnRow {
  id:string;
  return_number:string;
  original_sale_id:string|null;
  customer_id:string|null;
  customer_name:string;
  customer_cpf:string|null;
  resolution_type:'credito_cliente'|'vale_troca'|'estorno_dinheiro';
  status:'CONCLUIDO'|'CANCELADO';
  total_amount:number|string;
  observations:string|null;
  expires_at:string|null;
  created_at:string;
  return_items?:Array<{
    product_id:string|null;
    product_variant_id:string|null;
    product_name:string;
    size:string;
    color:string;
    unit_price:number|string;
    quantity:number|string;
    reason:string;
  }>;
}

export interface ReturnsSummary {
  occurrences:number;
  totalPieces:number;
  totalCredits:number;
  customerCreditBalance:number;
  customersWithCredit:number;
}

export interface ReturnsPage {
  rows:ReturnRecord[];
  total:number;
  summary:ReturnsSummary;
}

const EMPTY_SUMMARY:ReturnsSummary={
  occurrences:0,
  totalPieces:0,
  totalCredits:0,
  customerCreditBalance:0,
  customersWithCredit:0,
};

const toNumber=(value:unknown):number=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:0;
};

const toReturnRecord=(row:ReturnRow,index:number):ReturnRecord=>({
  id:index+1,
  uuid:row.id,
  codigo:row.return_number,
  data:(row.created_at||'').slice(0,10),
  vendaOriginalId:row.original_sale_id||undefined,
  clienteNome:row.customer_name,
  clienteCpf:row.customer_cpf||'Não informado',
  itens:(row.return_items||[]).map(item=>({
    produtoId:0,
    productUuid:item.product_id||undefined,
    variantId:item.product_variant_id||undefined,
    nome:item.product_name,
    tamanho:item.size,
    cor:item.color,
    precoUnitario:toNumber(item.unit_price),
    qtd:toNumber(item.quantity),
    motivo:item.reason,
  })),
  valorTotal:toNumber(row.total_amount),
  tipoResolucao:row.resolution_type,
  status:row.status,
  dataValidade:row.expires_at||undefined,
  observacoes:row.observations||undefined,
});

function isMissingReturnsPageRpc(error:{code?:string;message?:string}):boolean{
  const message=error.message||'';
  return error.code==='PGRST202'
    || (message.includes('Could not find the function') && message.includes('get_returns_page'));
}

function legacySummary(rows:ReturnRecord[]):ReturnsSummary{
  return {
    occurrences:rows.length,
    totalPieces:rows.reduce(
      (sum,row)=>sum+row.itens.reduce((inner,item)=>inner+item.qtd,0),
      0,
    ),
    totalCredits:rows.reduce((sum,row)=>sum+row.valorTotal,0),
    customerCreditBalance:0,
    customersWithCredit:0,
  };
}

export const ReturnsService = {
  async getPage(params:{
    storeId:string;
    page?:number;
    pageSize?:number;
    search?:string;
    resolutionType?:'all'|'credito_cliente'|'vale_troca'|'estorno_dinheiro';
  }):Promise<ReturnsPage>{
    if(!isSupabaseConfigured||!params.storeId){
      return {rows:[],total:0,summary:EMPTY_SUMMARY};
    }

    const page=Math.max(1,params.page||1);
    const pageSize=Math.min(100,Math.max(1,params.pageSize||15));
    const offset=(page-1)*pageSize;

    const {data,error}=await supabase.rpc('get_returns_page',{
      p_store_id:params.storeId,
      p_search:params.search?.trim()||null,
      p_resolution_type:params.resolutionType||'all',
      p_limit:pageSize,
      p_offset:offset,
    });

    if(!error){
      const payload=(data||{}) as {
        rows?:ReturnRow[];
        total?:number|string;
        summary?:Partial<Record<keyof ReturnsSummary,number|string>>;
      };
      return {
        rows:(payload.rows||[]).map(toReturnRecord),
        total:toNumber(payload.total),
        summary:{
          occurrences:toNumber(payload.summary?.occurrences),
          totalPieces:toNumber(payload.summary?.totalPieces),
          totalCredits:toNumber(payload.summary?.totalCredits),
          customerCreditBalance:toNumber(payload.summary?.customerCreditBalance),
          customersWithCredit:toNumber(payload.summary?.customersWithCredit),
        },
      };
    }

    if(!isMissingReturnsPageRpc(error)) throw error;

    const all=await this.getAll(params.storeId);
    const term=params.search?.trim().toLowerCase()||'';
    const filtered=all.filter(row=>{
      const searchMatch=!term||[
        row.codigo,
        row.clienteNome,
        row.clienteCpf,
        row.vendaOriginalId||'',
      ].some(value=>value.toLowerCase().includes(term));
      const typeMatch=!params.resolutionType||params.resolutionType==='all'
        || row.tipoResolucao===params.resolutionType;
      return searchMatch&&typeMatch;
    });

    const {data:creditRows,error:creditError}=await supabase
      .from('customer_credit_movements')
      .select('customer_id,type,amount')
      .eq('store_id',params.storeId);
    if(creditError) throw creditError;

    const balances=new Map<string,number>();
    for(const movement of creditRows||[]){
      const current=balances.get(movement.customer_id)||0;
      const amount=toNumber(movement.amount);
      balances.set(
        movement.customer_id,
        current+(movement.type==='CREDIT'?amount:-amount),
      );
    }
    const baseSummary=legacySummary(all);
    const positiveBalances=[...balances.values()].map(value=>Math.max(0,value));

    return {
      rows:filtered.slice(offset,offset+pageSize),
      total:filtered.length,
      summary:{
        ...baseSummary,
        customerCreditBalance:positiveBalances.reduce((sum,value)=>sum+value,0),
        customersWithCredit:positiveBalances.filter(value=>value>0).length,
      },
    };
  },

  async getAll(storeId?: string): Promise<ReturnRecord[]> {
    if (!isSupabaseConfigured || !storeId) return [];

    const { data, error } = await supabase
      .from('returns')
      .select(`
        id,
        return_number,
        original_sale_id,
        customer_id,
        customer_name,
        customer_cpf,
        resolution_type,
        status,
        total_amount,
        observations,
        expires_at,
        created_at,
        return_items (
          product_id,
          product_variant_id,
          product_name,
          size,
          color,
          unit_price,
          quantity,
          reason
        )
      `)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return ((data||[]) as unknown as ReturnRow[]).map(toReturnRecord);
  },

  async processReturn(params: {
    storeId: string;
    originalSaleId: string;
    customerId?: string;
    customerName?: string;
    customerCpf?: string;
    items: ReturnItem[];
    resolutionType: 'credito_cliente' | 'vale_troca' | 'estorno_dinheiro';
    observations?: string;
  }): Promise<{ success: boolean; message: string; returnRecord: ReturnRecord }> {
    if (!isSupabaseConfigured) {
      return { success: false, message: 'Supabase não configurado.', returnRecord: {} as ReturnRecord };
    }

    const { data, error } = await supabase.rpc('process_return', {
      p_store_id: params.storeId,
      p_original_sale_id: params.originalSaleId,
      p_customer_id: params.customerId || null,
      p_customer_name: params.customerName || null,
      p_customer_cpf: params.customerCpf || null,
      p_items: params.items.map(item => ({
        variant_id: item.variantId || null,
        quantity: item.qtd,
        product_name: item.nome,
        size: item.tamanho,
        color: item.cor,
        reason: item.motivo,
      })),
      p_resolution_type: params.resolutionType,
      p_observations: params.observations || null,
    });

    if (error) throw error;

    const result = data as ReturnRpcResult;
    if (result.success !== true || !result.return_id) {
      return {
        success: false,
        message: result.message || 'A devolução não foi confirmada pelo servidor.',
        returnRecord: {} as ReturnRecord,
      };
    }

    const returnRecord:ReturnRecord = {
      id: 0,
      uuid: result.return_id,
      codigo: result.return_number || 'DEV',
      data: new Date().toISOString().slice(0, 10),
      vendaOriginalId: params.originalSaleId,
      clienteNome: params.customerName || 'Consumidor Final',
      clienteCpf: params.customerCpf || 'Não informado',
      itens: params.items,
      valorTotal: Number(result.total) || 0,
      tipoResolucao: params.resolutionType,
      status: 'CONCLUIDO',
      observacoes: params.observations,
    };

    return {
      success: true,
      message: result.message || 'Devolução processada com sucesso.',
      returnRecord,
    };
  },
};
