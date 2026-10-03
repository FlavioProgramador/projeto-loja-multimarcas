import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { Customer } from '../types';

export interface CustomerDirectoryStats {
  totalCustomers: number;
  activeCustomers: number;
  customersWithCredit: number;
  totalPurchases: number;
  totalRevenue: number;
  creditBalance: number;
}

export interface CustomerDirectoryPage {
  rows: Customer[];
  total: number;
  stats: CustomerDirectoryStats;
}

type CustomerDirectorySort = 'name' | 'spending' | 'purchases' | 'recent';
type CustomerCreditFilter = 'all' | 'with-credit' | 'without-credit';

interface DirectoryRow {
  id: string;
  name: string;
  cpf: string | null;
  rg: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  birth_date: string | null;
  total_purchases: number | string;
  total_spent: number | string;
  last_purchase_at: string | null;
  credit_balance: number | string;
}

const EMPTY_STATS: CustomerDirectoryStats = {
  totalCustomers: 0,
  activeCustomers: 0,
  customersWithCredit: 0,
  totalPurchases: 0,
  totalRevenue: 0,
  creditBalance: 0,
};

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toDirectoryCustomer = (row: DirectoryRow, index: number): Customer => ({
  id: index + 1,
  uuid: row.id,
  nome: row.name,
  cpf: row.cpf || 'Não informado',
  rg: row.rg || '',
  telefone: row.phone || '',
  email: row.email || '',
  endereco: row.address || '',
  dataNascimento: row.birth_date || '',
  saldoCredito: Math.max(0, toNumber(row.credit_balance)),
  totalCompras: toNumber(row.total_purchases),
  totalGasto: toNumber(row.total_spent),
  ultimaCompra: row.last_purchase_at?.slice(0, 10) || '',
  detalhesCarregados: false,
  historico: [],
  movimentacoesCredito: [],
});

function isMissingRpc(error: { code?: string; message?: string }, name: string): boolean {
  const message = error.message || '';
  return error.code === 'PGRST202'
    || (message.includes('Could not find the function') && message.includes(name));
}

async function getLegacyAll(storeId: string): Promise<Customer[]> {
  const [customersResult, salesResult, creditResult, returnsResult] = await Promise.all([
    supabase
      .from('customers')
      .select('id,name,cpf,rg,phone,email,address,birth_date')
      .eq('is_active', true)
      .eq('store_id', storeId)
      .order('name', { ascending: true }),
    supabase
      .from('sales')
      .select(`
        id,
        sale_number,
        customer_id,
        customer_cpf,
        total,
        created_at,
        payments (
          method,
          installments,
          status,
          created_at
        ),
        sale_items (
          product_name,
          quantity
        )
      `)
      .eq('store_id', storeId)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false }),
    supabase
      .from('customer_credit_movements')
      .select('id,customer_id,type,amount,description,created_at,reference_id')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false }),
    supabase
      .from('returns')
      .select('original_sale_id,status')
      .eq('store_id', storeId)
      .eq('status', 'CONCLUIDO'),
  ]);

  if (customersResult.error) throw customersResult.error;
  if (salesResult.error) throw salesResult.error;
  if (creditResult.error) throw creditResult.error;
  if (returnsResult.error) throw returnsResult.error;

  const normalizedCpf = (value?: string | null) =>
    (value || '').replace(/\D/g, '');

  const sales = salesResult.data || [];
  const creditMovements = creditResult.data || [];
  const returnedSaleIds = new Set(
    (returnsResult.data || [])
      .map((record: any) => record.original_sale_id)
      .filter(Boolean),
  );

  return (customersResult.data || []).map((customer: any, index: number) => {
    const customerCpf = normalizedCpf(customer.cpf);
    const customerSales = sales.filter((sale: any) =>
      sale.customer_id === customer.id
      || (
        !sale.customer_id
        && customerCpf
        && normalizedCpf(sale.customer_cpf) === customerCpf
      )
    );

    const historico = customerSales.map((sale: any) => {
      const payment = [...(sale.payments || [])]
        .filter((item: any) => item.status !== 'CANCELLED')
        .sort((a: any, b: any) => {
          if (a.status === 'APPROVED' && b.status !== 'APPROVED') return -1;
          if (b.status === 'APPROVED' && a.status !== 'APPROVED') return 1;
          return String(b.created_at || '').localeCompare(String(a.created_at || ''));
        })[0];

      return {
        vendaId: sale.sale_number,
        uuid: sale.id,
        valor: toNumber(sale.total),
        data: (sale.created_at || '').slice(0, 10),
        status: returnedSaleIds.has(sale.id) ? 'DEVOLUCAO' as const : 'CONCLUIDA' as const,
        formaPagamento: payment?.method || undefined,
        parcelas: Math.max(1, toNumber(payment?.installments) || 1),
        statusPagamento: payment?.status || undefined,
        itens: (sale.sale_items || [])
          .map((item: any) => `${item.product_name} x${item.quantity}`)
          .join(', ') || 'Venda PDV',
      };
    });

    const customerCredits = creditMovements
      .filter((movement: any) => movement.customer_id === customer.id)
      .map((movement: any, movementIndex: number) => ({
        id: movementIndex + 1,
        tipo: movement.type === 'CREDIT' ? 'entrada' as const : 'saida' as const,
        valor: toNumber(movement.amount),
        descricao: movement.description,
        data: (movement.created_at || '').slice(0, 10),
        referenciaId: movement.reference_id || undefined,
      }));

    const creditBalance = customerCredits.reduce(
      (total: number, movement: any) =>
        total + (movement.tipo === 'entrada' ? movement.valor : -movement.valor),
      0,
    );
    const totalSpent = historico.reduce(
      (total: number, sale: any) => total + sale.valor,
      0,
    );
    const lastPurchase = historico.reduce(
      (latest: string, sale: any) => sale.data > latest ? sale.data : latest,
      '',
    );

    return {
      id: index + 1,
      uuid: customer.id,
      nome: customer.name,
      cpf: customer.cpf || 'Não informado',
      rg: customer.rg || '',
      telefone: customer.phone || '',
      email: customer.email || '',
      endereco: customer.address || '',
      dataNascimento: customer.birth_date || '',
      saldoCredito: Math.max(0, creditBalance),
      totalCompras: historico.length,
      totalGasto: totalSpent,
      ultimaCompra: lastPurchase,
      detalhesCarregados: true,
      movimentacoesCredito: customerCredits,
      historico,
    };
  });
}

function legacyStats(customers: Customer[]): CustomerDirectoryStats {
  return {
    totalCustomers: customers.length,
    activeCustomers: customers.length,
    customersWithCredit: customers.filter(customer => (customer.saldoCredito || 0) > 0).length,
    totalPurchases: customers.reduce(
      (sum, customer) => sum + (customer.totalCompras ?? customer.historico.length),
      0,
    ),
    totalRevenue: customers.reduce(
      (sum, customer) => sum + (customer.totalGasto ?? customer.historico.reduce((inner, sale) => inner + sale.valor, 0)),
      0,
    ),
    creditBalance: customers.reduce((sum, customer) => sum + (customer.saldoCredito || 0), 0),
  };
}

export const CustomersService = {
  async getDirectoryPage(params: {
    storeId: string;
    page?: number;
    pageSize?: number;
    search?: string;
    creditFilter?: CustomerCreditFilter;
    sort?: CustomerDirectorySort;
  }): Promise<CustomerDirectoryPage> {
    if (!isSupabaseConfigured || !params.storeId) {
      return { rows: [], total: 0, stats: EMPTY_STATS };
    }

    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const { data, error } = await supabase.rpc('get_customer_directory_page', {
      p_store_id: params.storeId,
      p_search: params.search?.trim() || null,
      p_credit_filter: params.creditFilter || 'all',
      p_sort: params.sort || 'name',
      p_limit: pageSize,
      p_offset: offset,
    });

    if (!error) {
      const payload = (data || {}) as {
        rows?: DirectoryRow[];
        total?: number | string;
        stats?: Partial<Record<keyof CustomerDirectoryStats, number | string>>;
      };
      return {
        rows: (payload.rows || []).map(toDirectoryCustomer),
        total: toNumber(payload.total),
        stats: {
          totalCustomers: toNumber(payload.stats?.totalCustomers),
          activeCustomers: toNumber(payload.stats?.activeCustomers),
          customersWithCredit: toNumber(payload.stats?.customersWithCredit),
          totalPurchases: toNumber(payload.stats?.totalPurchases),
          totalRevenue: toNumber(payload.stats?.totalRevenue),
          creditBalance: toNumber(payload.stats?.creditBalance),
        },
      };
    }

    if (!isMissingRpc(error, 'get_customer_directory_page')) throw error;

    const customers = await getLegacyAll(params.storeId);
    const stats = legacyStats(customers);
    const term = params.search?.trim().toLocaleLowerCase('pt-BR') || '';
    const filtered = customers.filter(customer => {
      const searchMatch = !term || [
        customer.nome,
        customer.cpf,
        customer.telefone,
        customer.email,
      ].some(value => value.toLocaleLowerCase('pt-BR').includes(term));
      const credit = customer.saldoCredito || 0;
      const creditMatch = !params.creditFilter || params.creditFilter === 'all'
        || (params.creditFilter === 'with-credit' && credit > 0)
        || (params.creditFilter === 'without-credit' && credit <= 0);
      return searchMatch && creditMatch;
    });
    const sort = params.sort || 'name';
    filtered.sort((a, b) => {
      if (sort === 'spending') return (b.totalGasto || 0) - (a.totalGasto || 0);
      if (sort === 'purchases') return (b.totalCompras || 0) - (a.totalCompras || 0);
      if (sort === 'recent') return (b.ultimaCompra || '').localeCompare(a.ultimaCompra || '');
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });

    return {
      rows: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      stats,
    };
  },

  async search(storeId: string, search: string, limit = 8): Promise<Customer[]> {
    if (!isSupabaseConfigured || !storeId || !search.trim()) return [];

    const normalized = search.trim().replace(/[(),]/g, ' ');
    const pattern = `%${normalized}%`;
    const { data, error } = await supabase
      .from('customers')
      .select(`
        id,
        name,
        cpf,
        rg,
        phone,
        email,
        address,
        birth_date,
        customer_credit_movements (
          type,
          amount
        )
      `)
      .eq('store_id', storeId)
      .eq('is_active', true)
      .or(`name.ilike.${pattern},cpf.ilike.${pattern},phone.ilike.${pattern}`)
      .order('name', { ascending: true })
      .limit(Math.min(20, Math.max(1, limit)));

    if (error) throw error;

    return (data || []).map((row: any, index: number) => {
      const creditBalance = (row.customer_credit_movements || []).reduce(
        (total: number, movement: any) =>
          total + (movement.type === 'CREDIT' ? toNumber(movement.amount) : -toNumber(movement.amount)),
        0,
      );

      return {
        id: index + 1,
        uuid: row.id,
        nome: row.name,
        cpf: row.cpf || 'Não informado',
        rg: row.rg || '',
        telefone: row.phone || '',
        email: row.email || '',
        endereco: row.address || '',
        dataNascimento: row.birth_date || '',
        saldoCredito: Math.max(0, creditBalance),
        detalhesCarregados: false,
        historico: [],
        movimentacoesCredito: [],
      };
    });
  },

  async getDetail(storeId: string, customerId: string): Promise<Customer> {
    if (!isSupabaseConfigured || !storeId || !customerId) {
      throw new Error('Cliente ou loja inválidos.');
    }

    const { data, error } = await supabase.rpc('get_customer_detail', {
      p_store_id: storeId,
      p_customer_id: customerId,
    });

    if (!error) {
      const payload = data as any;
      const history = (payload?.history || []).map((sale: any) => ({
        vendaId: sale.sale_number,
        uuid: sale.sale_id,
        valor: toNumber(sale.total),
        data: (sale.created_at || '').slice(0, 10),
        status: sale.status === 'DEVOLUCAO' ? 'DEVOLUCAO' as const : 'CONCLUIDA' as const,
        formaPagamento: sale.payment_method || undefined,
        parcelas: Math.max(1, toNumber(sale.payment_installments) || 1),
        statusPagamento: sale.payment_status || undefined,
        itens: sale.items || 'Venda PDV',
      }));
      const creditMovements = (payload?.credit_movements || []).map((movement: any, index: number) => ({
        id: index + 1,
        tipo: movement.type === 'CREDIT' ? 'entrada' as const : 'saida' as const,
        valor: toNumber(movement.amount),
        descricao: movement.description,
        data: (movement.created_at || '').slice(0, 10),
        referenciaId: movement.reference_id || undefined,
      }));

      return {
        id: 0,
        uuid: payload.id,
        nome: payload.name,
        cpf: payload.cpf || 'Não informado',
        rg: payload.rg || '',
        telefone: payload.phone || '',
        email: payload.email || '',
        endereco: payload.address || '',
        dataNascimento: payload.birth_date || '',
        saldoCredito: Math.max(0, toNumber(payload.credit_balance)),
        totalCompras: history.length,
        totalGasto: history.reduce((sum: number, sale: any) => sum + sale.valor, 0),
        ultimaCompra: history[0]?.data || '',
        detalhesCarregados: true,
        historico: history,
        movimentacoesCredito: creditMovements,
      };
    }

    if (!isMissingRpc(error, 'get_customer_detail')) throw error;

    const customers = await getLegacyAll(storeId);
    const customer = customers.find(item => item.uuid === customerId);
    if (!customer) throw new Error('Cliente não encontrado nesta loja.');
    return customer;
  },

  async getAll(storeId?: string): Promise<Customer[]> {
    if (!storeId) return [];
    const result = await this.getDirectoryPage({
      storeId,
      page: 1,
      pageSize: 100,
      sort: 'name',
      creditFilter: 'all',
    });
    return result.rows;
  },

  async create(customer: {
    nome: string;
    cpf?: string;
    rg?: string;
    telefone?: string;
    email?: string;
    endereco?: string;
    dataNascimento?: string;
  }, storeId?: string): Promise<any> {
    if (!isSupabaseConfigured) return null;
    if (!storeId) {
      throw new Error('store_id é obrigatório para cadastrar cliente no Supabase.');
    }

    const { data, error } = await supabase
      .from('customers')
      .insert({
        store_id: storeId,
        name: customer.nome.trim(),
        cpf: customer.cpf?.trim() || null,
        rg: customer.rg?.trim() || null,
        phone: customer.telefone?.trim() || null,
        email: customer.email?.trim() || null,
        address: customer.endereco?.trim() || null,
        birth_date: customer.dataNascimento || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(uuid: string, customer: Partial<{
    nome: string;
    cpf: string;
    rg: string;
    telefone: string;
    email: string;
    endereco: string;
    dataNascimento: string;
  }>): Promise<void> {
    if (!isSupabaseConfigured) return;

    const payload = {
      ...(customer.nome !== undefined && { name: customer.nome.trim() }),
      ...(customer.cpf !== undefined && { cpf: customer.cpf.trim() || null }),
      ...(customer.rg !== undefined && { rg: customer.rg.trim() || null }),
      ...(customer.telefone !== undefined && { phone: customer.telefone.trim() || null }),
      ...(customer.email !== undefined && { email: customer.email.trim() || null }),
      ...(customer.endereco !== undefined && { address: customer.endereco.trim() || null }),
      ...(customer.dataNascimento !== undefined && { birth_date: customer.dataNascimento || null }),
    };

    const { error } = await supabase.from('customers').update(payload).eq('id', uuid);
    if (error) throw error;
  },

  async remove(uuid: string): Promise<void> {
    if (!isSupabaseConfigured) return;

    const { error } = await supabase
      .from('customers')
      .update({ is_active: false })
      .eq('id', uuid);

    if (error) throw error;
  },
};
