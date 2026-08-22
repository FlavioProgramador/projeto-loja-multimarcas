import React, { useState } from 'react';
import { PlusCircle, Plus, X, Boxes } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useStore } from '../../contexts/StoreContext';
import { ProductSku } from '../../types';

interface NewProductModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewProductModal: React.FC<NewProductModalProps> = ({ isOpen, onClose }) => {
  const { addProduct } = useStore();

  const [nome, setNome] = useState('');
  const [marca, setMarca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [preco, setPreco] = useState('');
  const [skus, setSkus] = useState<ProductSku[]>([
    { tamanho: 'P', cor: 'Preto', qtd: 10 }
  ]);

  const handleAddSkuRow = () => {
    setSkus(prev => [...prev, { tamanho: 'M', cor: 'Preto', qtd: 0 }]);
  };

  const handleRemoveSkuRow = (index: number) => {
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
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    if (skus.length === 0) {
      alert('Adicione pelo menos uma variação.');
      return;
    }

    addProduct({
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
    setNome('');
    setMarca('');
    setCategoria('');
    setPreco('');
    setSkus([{ tamanho: 'P', cor: 'Preto', qtd: 10 }]);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Boxes size={18} style={{ color: 'var(--primary)' }} />
          <span>Cadastrar Novo Produto</span>
        </div>
      }
      maxWidth="540px"
    >
      <div className="form-group">
        <label>Nome do Produto *</label>
        <input
          placeholder="Ex: Camiseta Oversized Minimal"
          value={nome}
          onChange={e => setNome(e.target.value)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="form-group">
          <label>Marca *</label>
          <input
            placeholder="Ex: Cyclone, Nike, Oakley..."
            value={marca}
            onChange={e => setMarca(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Categoria *</label>
          <input
            placeholder="Ex: Camisas, Calçados..."
            value={categoria}
            onChange={e => setCategoria(e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label>Preço de Venda (R$) *</label>
        <input
          type="number"
          step="0.01"
          placeholder="0.00"
          value={preco}
          onChange={e => setPreco(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>Grade de Variações (Tamanho / Cor / Estoque Inicial)</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
          {skus.map((sku, idx) => (
            <div key={idx} className="sku-row">
              <input
                placeholder="Tamanho"
                value={sku.tamanho}
                onChange={e => handleSkuChange(idx, 'tamanho', e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                placeholder="Cor"
                value={sku.cor}
                onChange={e => handleSkuChange(idx, 'cor', e.target.value)}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                placeholder="Qtd"
                value={sku.qtd}
                onChange={e => handleSkuChange(idx, 'qtd', parseInt(e.target.value) || 0)}
                style={{ width: '68px', fontFamily: 'var(--font-mono)' }}
              />
              <button
                type="button"
                className="btn-remove"
                onClick={() => handleRemoveSkuRow(idx)}
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
          onClick={handleAddSkuRow}
          style={{ marginTop: '10px' }}
        >
          <Plus size={13} /> Adicionar Variação
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
        <button type="button" className="btn" onClick={handleSave} style={{ flex: 1 }}>
          Salvar Produto
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
};
