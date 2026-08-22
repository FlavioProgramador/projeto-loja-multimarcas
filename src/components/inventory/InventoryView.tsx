import React, { useState } from 'react';
import { Search, Plus, ArrowUp, Edit2, Trash2, Boxes } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { Product } from '../../types';
import { formatMoeda, totalEstoque, getStatusEstoque } from '../../lib/utils';
import { StatusBadge } from '../ui/StatusBadge';
import { NewProductModal } from './NewProductModal';
import { StockEntryModal } from './StockEntryModal';
import { EditProductModal } from './EditProductModal';

export const InventoryView: React.FC = () => {
  const { products, deleteProduct } = useStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const filtered = products.filter(
    p =>
      p.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.marca.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.categoria.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDelete = (id: number, name: string) => {
    if (window.confirm(`⚠️ Tem certeza que deseja remover o produto "${name}" permanentemente?`)) {
      deleteProduct(id);
    }
  };

  return (
    <div className="module-fade">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Estoque & Produtos</h1>
          <p className="page-subtitle">Controle de inventário, variações de grade, custos e movimentação física.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-outline" onClick={() => setIsEntryModalOpen(true)}>
            <ArrowUp size={16} /> Entrada Estoque
          </button>
          <button className="btn" onClick={() => setIsNewModalOpen(true)}>
            <Plus size={16} /> Novo Produto
          </button>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="table-wrap">
        <div className="table-header-bar">
          <div style={{ position: 'relative', width: '100%', maxWidth: '380px' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)'
              }}
            />
            <input
              placeholder="Buscar por nome, marca ou categoria..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '36px', fontSize: '13px' }}
            />
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
            {filtered.length} {filtered.length === 1 ? 'produto encontrado' : 'produtos encontrados'}
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Produto / Grade</th>
              <th>Marca</th>
              <th>Categoria</th>
              <th>Preço de Venda</th>
              <th>Qtd Total</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                  Nenhum produto cadastrado ou correspondente à busca.
                </td>
              </tr>
            ) : (
              filtered.map(p => {
                const total = totalEstoque(p);
                const status = getStatusEstoque(total);

                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.nome}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {p.skus.map(s => `${s.tamanho}/${s.cor} (${s.qtd})`).join(' • ')}
                      </div>
                    </td>
                    <td>
                      <span className="badge-status neutral">{p.marca}</span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{p.categoria}</td>
                    <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {formatMoeda(p.preco)}
                    </td>
                    <td>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '14px' }}>{total} un</strong>
                    </td>
                    <td>
                      <StatusBadge status={status} />
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => setEditingProduct(p)}
                        title="Editar produto"
                        style={{ marginRight: '6px', padding: '5px 8px' }}
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        className="btn-remove"
                        onClick={() => handleDelete(p.id, p.nome)}
                        title="Remover produto"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <NewProductModal isOpen={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} />
      <StockEntryModal isOpen={isEntryModalOpen} onClose={() => setIsEntryModalOpen(false)} />
      <EditProductModal
        isOpen={!!editingProduct}
        onClose={() => setEditingProduct(null)}
        product={editingProduct}
      />
    </div>
  );
};
