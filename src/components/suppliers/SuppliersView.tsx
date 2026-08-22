import React, { useState } from 'react';
import { Truck, Plus, Search } from 'lucide-react';
import { useStore } from '../../contexts/StoreContext';
import { NewSupplierModal } from './NewSupplierModal';

export const SuppliersView: React.FC = () => {
  const { suppliers } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  const filtered = suppliers.filter(
    s =>
      s.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.cnpj.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.contato.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="module-fade">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestão de Fornecedores</h1>
          <p className="page-subtitle">Cadastro e controle de fornecedores de mercadorias, tecidos e insumos.</p>
        </div>
        <button className="btn" onClick={() => setIsNewModalOpen(true)}>
          <Plus size={16} /> Novo Fornecedor
        </button>
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
              placeholder="Buscar por razão social, CNPJ ou contato..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '36px', fontSize: '13px' }}
            />
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
            {filtered.length} {filtered.length === 1 ? 'fornecedor cadastrado' : 'fornecedores cadastrados'}
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Razão Social / Nome Fantasia</th>
              <th>CNPJ</th>
              <th>Contato</th>
              <th>E-mail Comercial</th>
              <th>Localização</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                  Nenhum fornecedor cadastrado ou correspondente à busca.
                </td>
              </tr>
            ) : (
              filtered.map(f => (
                <tr key={f.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{f.nome}</div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{f.cnpj}</td>
                  <td>{f.contato || '—'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{f.email || '—'}</td>
                  <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{f.endereco || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <NewSupplierModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
      />
    </div>
  );
};
