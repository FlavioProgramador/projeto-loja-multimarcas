import React, { useState, useEffect } from 'react';
import { Edit2, Plus, X, Boxes } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';
import { Product, ProductSku } from '../../types';

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
}

export const EditProductModal: React.FC<EditProductModalProps> = ({ isOpen, onClose, product }) => {
  const { updateProduct } = useStore();

  const [nome, setNome] = useState('');
  const [marca, setMarca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [preco, setPreco] = useState('');
  const [skus, setSkus] = useState<ProductSku[]>([]);

  useEffect(() => {
    if (product) {
      setNome(product.nome);
      setMarca(product.marca);
      setCategoria(product.categoria);
      setPreco(product.preco.toString());
      setSkus(product.skus.map(s => ({ ...s })));
    }
  }, [product]);

  if (!product) return null;

  const handleAddSku = () => {
    setSkus(prev => [...prev, { tamanho: 'M', cor: 'Padrão', qtd: 0 }]);
  };

  const handleRemoveSku = (index: number) => {
    if (skus.length <= 1) {
      alert('Mantenha pelo menos uma variação cadastrada.');
      return;
    }
    setSkus(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSkuChange = (index: number, field: keyof ProductSku, val: string | number) => {
    setSkus(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const handleSave = () => {
    const numPreco = parseFloat(preco);
    if (!nome.trim() || !marca.trim() || !categoria.trim() || isNaN(numPreco) || numPreco <= 0) {
      alert('Preencha todos os campos obrigatórios.');
      return;
    }

    if (skus.length === 0) {
      alert('Adicione pelo menos uma variação.');
      return;
    }

    updateProduct(product.id, {
      nome: nome.trim(),
      marca: marca.trim(),
      categoria: categoria.trim(),
      preco: numPreco,
      skus: skus.map(s => ({
        tamanho: s.tamanho.trim() || 'Único',
        cor: s.cor.trim() || 'Padrão',
        qtd: Number(s.qtd) || 0
      }))
    });

    onClose();
    alert('Produto atualizado com sucesso!');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Edit2 size={18} style={{ color: 'var(--primary)' }} />
          <span>Editar Produto #{product.id}</span>
        </div>
      }
      maxWidth="540px"
    >
      <div className="form-group">
        <label>Nome do Produto *</label>
        <input value={nome} onChange={e => setNome(e.target.value)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="form-group">
          <label>Marca *</label>
          <input value={marca} onChange={e => setMarca(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Categoria *</label>
          <input value={categoria} onChange={e => setCategoria(e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label>Preço de Venda (R$) *</label>
        <input
          type="number"
          step="0.01"
          value={preco}
          onChange={e => setPreco(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>Variações de Estoque (SKU)</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
          {skus.map((s, idx) => (
            <div key={idx} className="sku-row">
              <input
                placeholder="Tamanho"
                value={s.tamanho}
                onChange={e => handleSkuChange(idx, 'tamanho', e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                placeholder="Cor"
                value={s.cor}
                onChange={e => handleSkuChange(idx, 'cor', e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                placeholder="Qtd"
                value={s.qtd}
                onChange={e => handleSkuChange(idx, 'qtd', parseInt(e.target.value) || 0)}
                style={{ width: '68px', fontFamily: 'var(--font-mono)' }}
              />
              <button
                type="button"
                className="btn-remove"
                onClick={() => handleRemoveSku(idx)}
                title="Remover variação"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={handleAddSku}
          style={{ marginTop: '10px' }}
        >
          <Plus size={13} /> Adicionar Variação
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
        <button type="button" className="btn" onClick={handleSave} style={{ flex: 1 }}>
          Salvar Alterações
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
};
