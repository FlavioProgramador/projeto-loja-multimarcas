import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, UserPlus, UsersRound } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { CustomersService, type CustomerDirectoryStats } from '../../services/customers.service';
import type { Customer } from '../../types';
import { CustomerDetails } from './CustomerDetails';
import { CustomerDeleteModal } from './CustomerDeleteModal';
import { CustomerFilters } from './CustomerFilters';
import { CustomerForm, type CustomerFormData } from './CustomerForm';
import { CustomerList } from './CustomerList';
import { CustomerStats } from './CustomerStats';

const PAGE_SIZE = 20;
const EMPTY_STATS:CustomerDirectoryStats={
  totalCustomers:0,
  activeCustomers:0,
  customersWithCredit:0,
  totalPurchases:0,
  totalRevenue:0,
  creditBalance:0,
};

export const CustomersView: React.FC = () => {
  const { activeStoreId, addCustomer, updateCustomer, deleteCustomer } = useStore();
  const [customers,setCustomers]=useState<Customer[]>([]);
  const [stats,setStats]=useState<CustomerDirectoryStats>(EMPTY_STATS);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(1);
  const [loading,setLoading]=useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'with-credit' | 'without-credit'>('all');
  const [sort, setSort] = useState<'name' | 'spending' | 'purchases' | 'recent'>('name');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [detailError,setDetailError]=useState<string|null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPage=useCallback(async()=>{
    if(!activeStoreId){
      setCustomers([]);
      setStats(EMPTY_STATS);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try{
      const result=await CustomersService.getDirectoryPage({
        storeId:activeStoreId,
        page,
        pageSize:PAGE_SIZE,
        search,
        creditFilter:status,
        sort,
      });
      setCustomers(result.rows);
      setStats(result.stats);
      setTotal(result.total);
      const lastPage=Math.max(1,Math.ceil(result.total/PAGE_SIZE));
      if(page>lastPage) setPage(lastPage);
    }catch(error){
      setFormError(error instanceof Error?error.message:'Não foi possível carregar os clientes.');
    }finally{
      setLoading(false);
    }
  },[activeStoreId,page,search,status,sort]);

  useEffect(()=>{setPage(1);},[activeStoreId,search,status,sort]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void loadPage();},search.trim()?250:0);
    return ()=>window.clearTimeout(timer);
  },[loadPage,search]);

  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));

  const openCreate = () => {
    setIsCreateOpen(true);
    setSelectedCustomer(null);
    setEditingCustomer(null);
    setFormError(null);
  };

  const openEdit = (customer: Customer) => {
    setIsCreateOpen(false);
    setEditingCustomer(customer);
    setSelectedCustomer(null);
    setFormError(null);
  };

  const openDetails=async(customer:Customer)=>{
    setSelectedCustomer(customer);
    setDetailLoading(true);
    setDetailError(null);
    if(!activeStoreId||!customer.uuid){
      setDetailLoading(false);
      return;
    }
    try{
      const detail=await CustomersService.getDetail(activeStoreId,customer.uuid);
      setSelectedCustomer(detail);
    }catch(error){
      setDetailError(error instanceof Error?error.message:'Não foi possível carregar o histórico do cliente.');
    }finally{
      setDetailLoading(false);
    }
  };

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const handleSubmit = async (data: CustomerFormData) => {
    setSaving(true);
    setFormError(null);
    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer.uuid || editingCustomer.id, data);
      } else {
        await addCustomer(data);
      }
      await loadPage();
      showNotice(editingCustomer ? 'Cliente atualizado com sucesso.' : 'Cliente cadastrado com sucesso.');
      setIsCreateOpen(false);
      setEditingCustomer(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível salvar o cliente.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingCustomer) return;
    setDeleting(true);
    setFormError(null);
    try {
      await deleteCustomer(deletingCustomer.uuid || deletingCustomer.id);
      await loadPage();
      showNotice('Cliente arquivado com sucesso. Histórico preservado.');
      setDeletingCustomer(null);
      setSelectedCustomer(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível arquivar o cliente.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="module-fade customers-module">
      {notice && <div className="customer-notice" role="status">{notice}</div>}
      <div className="customers-page-head">
        <div>
          <div className="breadcrumb-overline">CADASTROS / CLIENTES</div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">Relacionamento, compras, crédito e histórico centralizados na loja ativa.</p>
        </div>
        <div className="customers-head-actions">
          <button className="btn btn-outline btn-sm" onClick={() => void loadPage()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''}/> Sincronizar
          </button>
          <button className="btn" onClick={openCreate}><UserPlus size={15}/> Novo cliente</button>
        </div>
      </div>
      <CustomerStats totalCustomers={stats.totalCustomers} activeCustomers={stats.activeCustomers}
        customersWithCredit={stats.customersWithCredit} totalPurchases={stats.totalPurchases}
        totalRevenue={stats.totalRevenue} creditBalance={stats.creditBalance} />
      <section className="card customers-list-card">
        <div className="customers-list-heading">
          <div><strong><UsersRound size={16}/> Base de clientes</strong><span>Consulta paginada no Supabase da loja ativa</span></div>
        </div>
        <CustomerFilters search={search} onSearchChange={setSearch} status={status}
          onStatusChange={setStatus} sort={sort} onSortChange={setSort}
          resultCount={total} totalCount={stats.totalCustomers} />
        <CustomerList customers={customers} onView={customer=>void openDetails(customer)}
          onEdit={openEdit} onDelete={setDeletingCustomer}/>
        {total>0&&<div className="customers-pagination-footer">
          <span>
            Exibindo {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE,total)} de {total}
          </span>
          <div className="customers-pagination" aria-label="Paginação de clientes">
            <button
              disabled={page===1||loading}
              onClick={()=>setPage(value=>Math.max(1,value-1))}
              aria-label="Página anterior"
            >
              <ChevronLeft size={16}/>
            </button>
            <strong>{page} / {pages}</strong>
            <button
              disabled={page===pages||loading}
              onClick={()=>setPage(value=>Math.min(pages,value+1))}
              aria-label="Próxima página"
            >
              <ChevronRight size={16}/>
            </button>
          </div>
        </div>}
      </section>
      <CustomerDetails customer={selectedCustomer} loading={detailLoading} error={detailError}
        onClose={() => {setSelectedCustomer(null);setDetailError(null);}} onEdit={openEdit}/>
      <CustomerForm isOpen={isCreateOpen || !!editingCustomer} customer={editingCustomer} saving={saving}
        error={formError} onClose={() => { setIsCreateOpen(false); setEditingCustomer(null); setFormError(null); }}
        onSubmit={handleSubmit}/>
      <CustomerDeleteModal customer={deletingCustomer} deleting={deleting} error={formError}
        onClose={() => { setDeletingCustomer(null); setFormError(null); }} onConfirm={handleDelete}/>
    </div>
  );
};
