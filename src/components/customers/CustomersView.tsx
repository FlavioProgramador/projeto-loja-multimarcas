import React, { useMemo, useState } from 'react';
import { RefreshCw, UserPlus, UsersRound } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import type { Customer } from '../../types';
import { CustomerDetails } from './CustomerDetails';
import { CustomerDeleteModal } from './CustomerDeleteModal';
import { CustomerFilters } from './CustomerFilters';
import { CustomerForm, type CustomerFormData } from './CustomerForm';
import { CustomerList } from './CustomerList';
import { CustomerStats } from './CustomerStats';

export const CustomersView: React.FC = () => {
  const { customers, addCustomer, updateCustomer, deleteCustomer, refreshData, isLoading } = useStore();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'with-credit' | 'without-credit'>('all');
  const [sort, setSort] = useState<'name' | 'spending' | 'purchases' | 'recent'>('name');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const metrics = useMemo(() => ({
    totalRevenue: customers.reduce((sum, c) => sum + c.historico.reduce((inner, s) => inner + s.valor, 0), 0),
    totalPurchases: customers.reduce((sum, c) => sum + c.historico.length, 0),
    creditBalance: customers.reduce((sum, c) => sum + (c.saldoCredito || 0), 0),
    customersWithCredit: customers.filter(c => (c.saldoCredito || 0) > 0).length,
    activeCustomers: customers.length,
  }), [customers]);

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    const result = customers.filter(customer => {
      const textMatch = !term
        || customer.nome.toLocaleLowerCase('pt-BR').includes(term)
        || customer.cpf.toLocaleLowerCase('pt-BR').includes(term)
        || customer.telefone.toLocaleLowerCase('pt-BR').includes(term)
        || customer.email.toLocaleLowerCase('pt-BR').includes(term);
      const credit = customer.saldoCredito || 0;
      const statusMatch = status === 'all' || (status === 'with-credit' && credit > 0) || (status === 'without-credit' && credit <= 0);
      return textMatch && statusMatch;
    });
    return [...result].sort((a, b) => {
      if (sort === 'spending') return b.historico.reduce((s, x) => s + x.valor, 0) - a.historico.reduce((s, x) => s + x.valor, 0);
      if (sort === 'purchases') return b.historico.length - a.historico.length;
      if (sort === 'recent') {
        const ad = a.historico.reduce((latest, sale) => sale.data > latest ? sale.data : latest, '');
        const bd = b.historico.reduce((latest, sale) => sale.data > latest ? sale.data : latest, '');
        return bd.localeCompare(ad);
      }
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
  }, [customers, search, sort, status]);

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

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const handleSubmit = async (data: CustomerFormData) => {
    setSaving(true);
    setFormError(null);
    try {
      if (editingCustomer) await updateCustomer(editingCustomer.id, data);
      else await addCustomer(data);
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
      await deleteCustomer(deletingCustomer.id);
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
          <button className="btn btn-outline btn-sm" onClick={() => refreshData()} disabled={isLoading}>
            <RefreshCw size={14} className={isLoading ? 'spin' : ''}/> Sincronizar
          </button>
          <button className="btn" onClick={openCreate}><UserPlus size={15}/> Novo cliente</button>
        </div>
      </div>
      <CustomerStats totalCustomers={customers.length} activeCustomers={metrics.activeCustomers}
        customersWithCredit={metrics.customersWithCredit} totalPurchases={metrics.totalPurchases}
        totalRevenue={metrics.totalRevenue} creditBalance={metrics.creditBalance} />
      <section className="card customers-list-card">
        <div className="customers-list-heading">
          <div><strong><UsersRound size={16}/> Base de clientes</strong><span>Dados lidos do Supabase da loja ativa</span></div>
        </div>
        <CustomerFilters search={search} onSearchChange={setSearch} status={status}
          onStatusChange={setStatus} sort={sort} onSortChange={setSort}
          resultCount={filteredCustomers.length} totalCount={customers.length} />
        <CustomerList customers={filteredCustomers} onView={setSelectedCustomer}
          onEdit={openEdit} onDelete={setDeletingCustomer}/>
      </section>
      <CustomerDetails customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} onEdit={openEdit}/>
      <CustomerForm isOpen={isCreateOpen || !!editingCustomer} customer={editingCustomer} saving={saving}
        error={formError} onClose={() => { setIsCreateOpen(false); setEditingCustomer(null); setFormError(null); }}
        onSubmit={handleSubmit}/>
      <CustomerDeleteModal customer={deletingCustomer} deleting={deleting} error={formError}
        onClose={() => { setDeletingCustomer(null); setFormError(null); }} onConfirm={handleDelete}/>
    </div>
  );
};