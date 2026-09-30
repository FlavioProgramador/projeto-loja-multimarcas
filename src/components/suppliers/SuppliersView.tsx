import React, { useMemo, useState } from 'react';
import { Archive, Building2, Eye, Mail, MapPin, Pencil, Phone, Plus, RefreshCw, Search, Truck, UsersRound } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import type { Supplier } from '../../types';
import { SupplierDetails } from './SupplierDetails';
import { SupplierDeleteModal } from './SupplierDeleteModal';
import { SupplierForm, type SupplierFormData } from './SupplierForm';

type FilterStatus = 'all' | 'with-email' | 'with-phone';
type SortMode = 'name' | 'recent';

const normalize = (value: string) =>
  value.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').toLocaleLowerCase('pt-BR');

const initials = (value: string) =>
  value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'FO';

export const SuppliersView: React.FC = () => {
  const { suppliers, addSupplier, updateSupplier, deleteSupplier, refreshData, isLoading, activeStoreId } = useStore();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<FilterStatus>('all');
  const [sort, setSort] = useState<SortMode>('name');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filteredSuppliers = useMemo(() => {
    const term = normalize(search.trim());
    const result = suppliers.filter(supplier => {
      const values = [supplier.nome, supplier.cnpj, supplier.contato, supplier.email, supplier.endereco];
      const searchable = values.map(normalize).join(' ');
      const matchesSearch = !term || searchable.includes(term);
      const matchesStatus =
        status === 'all' ||
        (status === 'with-email' && Boolean(supplier.email)) ||
        (status === 'with-phone' && Boolean(supplier.contato));
      return matchesSearch && matchesStatus;
    });

    return [...result].sort((a, b) =>
      sort === 'recent' ? b.id - a.id : a.nome.localeCompare(b.nome, 'pt-BR')
    );
  }, [search, status, sort, suppliers]);

  const metrics = useMemo(() => ({
    total: suppliers.length,
    withEmail: suppliers.filter(s => Boolean(s.email)).length,
    withPhone: suppliers.filter(s => Boolean(s.contato)).length,
  }), [suppliers]);

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const openCreate = () => {
    setSelectedSupplier(null);
    setEditingSupplier(null);
    setError(null);
    setIsCreateOpen(true);
  };

  const openEdit = (supplier: Supplier) => {
    setSelectedSupplier(null);
    setEditingSupplier(supplier);
    setError(null);
    setIsCreateOpen(false);
  };

  const handleSubmit = async (data: SupplierFormData) => {
    setSaving(true);
    setError(null);
    try {
      if (editingSupplier) {
        await updateSupplier(editingSupplier.uuid || editingSupplier.id, data);
        notify('Fornecedor atualizado com sucesso.');
      } else {
        await addSupplier(data);
        notify('Fornecedor cadastrado com sucesso.');
      }
      setEditingSupplier(null);
      setIsCreateOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o fornecedor.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingSupplier) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSupplier(deletingSupplier.uuid || deletingSupplier.id);
      notify('Fornecedor arquivado com sucesso.');
      setDeletingSupplier(null);
      setSelectedSupplier(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível arquivar o fornecedor.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="module-fade suppliers-module">
      {notice && <div className="supplier-notice" role="status">{notice}</div>}
      <header className="suppliers-page-head">
        <div>
          <div className="breadcrumb-overline">CADASTROS / FORNECEDORES</div>
          <h1 className="page-title">Fornecedores</h1>
          <p className="page-subtitle">Cadastro, contatos e informações comerciais organizados para sua operação.</p>
        </div>
        <div className="suppliers-head-actions">
          <button className="btn btn-outline btn-sm" onClick={() => refreshData()} disabled={isLoading}>
            <RefreshCw size={14} className={isLoading ? 'spin' : ''} /> Sincronizar
          </button>
          <button className="btn" onClick={openCreate}><Plus size={15} /> Novo fornecedor</button>
        </div>
      </header>
      <section className="supplier-stat-grid" aria-label="Resumo de fornecedores">
        <article className="supplier-stat-card"><span className="supplier-stat-icon"><Truck size={18} /></span><div><small>Fornecedores</small><strong>{metrics.total}</strong><span>na base ativa</span></div></article>
        <article className="supplier-stat-card"><span className="supplier-stat-icon"><Mail size={18} /></span><div><small>Com e-mail</small><strong>{metrics.withEmail}</strong><span>contatos comerciais</span></div></article>
        <article className="supplier-stat-card"><span className="supplier-stat-icon"><Phone size={18} /></span><div><small>Com telefone</small><strong>{metrics.withPhone}</strong><span>contatos disponíveis</span></div></article>
        <article className="supplier-stat-card"><span className="supplier-stat-icon"><Building2 size={18} /></span><div><small>Contexto</small><strong>{activeStoreId ? 'Loja ativa' : 'Aguardando'}</strong><span>operação atual</span></div></article>
      </section>
      <section className="card suppliers-list-card">
        <div className="suppliers-list-heading">
          <div><strong><UsersRound size={16} /> Base de fornecedores</strong><span>Dados organizados para a operação da loja ativa.</span></div>
          <span className="suppliers-result-count">{filteredSuppliers.length} de {suppliers.length}</span>
        </div>
        <div className="suppliers-toolbar">
          <div className="supplier-search-field">
            <Search size={16} />
            <input aria-label="Buscar fornecedores" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por empresa, CNPJ, contato, e-mail ou endereço..." />
          </div>
          <div className="suppliers-toolbar-group">
            <select value={status} onChange={event => setStatus(event.target.value as FilterStatus)}>
              <option value="all">Todos os fornecedores</option>
              <option value="with-email">Com e-mail</option>
              <option value="with-phone">Com telefone</option>
            </select>
            <select value={sort} onChange={event => setSort(event.target.value as SortMode)}>
              <option value="name">Ordenar por nome</option>
              <option value="recent">Mais recentes</option>
            </select>
          </div>
        </div>
        <div className="suppliers-table-wrap">
          <table>
            <thead><tr><th>Fornecedor</th><th>Documento</th><th>Contato</th><th>Comunicação</th><th>Localização</th><th>Status</th><th style={{ textAlign: 'center' }}>Ações</th></tr></thead>
            <tbody>
              {filteredSuppliers.map(supplier => (
                <tr key={supplier.uuid || supplier.id} className="clickable-row" onClick={() => setSelectedSupplier(supplier)}>
                  <td><div className="supplier-primary"><span className="supplier-avatar">{initials(supplier.nome)}</span><span><strong>{supplier.nome}</strong><small>Fornecedor cadastrado</small></span></div></td>
                  <td><span className="supplier-document">{supplier.cnpj || 'Não informado'}</span></td>
                  <td><div className="supplier-contact"><strong>{supplier.contato || 'Não informado'}</strong></div></td>
                  <td><div className="supplier-contact"><span>{supplier.email || 'Sem e-mail'}</span>{supplier.email && <small><Mail size={12} /> Comercial</small>}</div></td>
                  <td><div className="supplier-location"><MapPin size={13} /><span>{supplier.endereco || 'Endereço não informado'}</span></div></td>
                  <td><span className="supplier-status-badge">Ativo</span></td>
                  <td><div className="supplier-row-actions">
                    <button className="icon-action" title="Visualizar fornecedor" aria-label="Visualizar fornecedor" onClick={event => { event.stopPropagation(); setSelectedSupplier(supplier); }}><Eye size={15} /></button>
                    <button className="icon-action" title="Editar fornecedor" aria-label="Editar fornecedor" onClick={event => { event.stopPropagation(); openEdit(supplier); }}><Pencil size={15} /></button>
                    <button className="icon-action danger" title="Arquivar fornecedor" aria-label="Arquivar fornecedor" onClick={event => { event.stopPropagation(); setDeletingSupplier(supplier); }}><Archive size={15} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredSuppliers.length && <div className="suppliers-empty"><Truck size={30} /><strong>Nenhum fornecedor encontrado</strong><span>Ajuste a busca ou cadastre um novo fornecedor.</span><button className="btn btn-sm" onClick={openCreate}><Plus size={14} /> Novo fornecedor</button></div>}
        </div>
      </section>
      <SupplierDetails supplier={selectedSupplier} onClose={() => setSelectedSupplier(null)} onEdit={openEdit} />
      <SupplierForm isOpen={isCreateOpen || !!editingSupplier} supplier={editingSupplier} saving={saving} error={error}
        onClose={() => { setIsCreateOpen(false); setEditingSupplier(null); setError(null); }} onSubmit={handleSubmit} />
      <SupplierDeleteModal supplier={deletingSupplier} deleting={deleting} error={error}
        onClose={() => { setDeletingSupplier(null); setError(null); }} onConfirm={handleDelete} />
    </div>
  );
};
